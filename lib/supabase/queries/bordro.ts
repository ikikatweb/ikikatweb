// Bordro Takibi sorguları — personel atama geçmişi + gün sayısı + transfer
import { createClient } from "@/lib/supabase/client";
import type { Personel, PersonelInsert, PersonelAtamaGecmisi, PersonelAtamaManuelGun } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

function bugun(): string {
  return new Date().toISOString().slice(0, 10);
}

function gunFarki(baslangic: string, bitis: string): number {
  const a = new Date(baslangic + "T00:00:00").getTime();
  const b = new Date(bitis + "T00:00:00").getTime();
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1);
}

// --- Personel CRUD ---

export async function getBordroPersoneller(): Promise<Personel[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("personel").select("*").order("ad_soyad");
  if (error) throw error;
  return (data ?? []) as Personel[];
}

export async function insertBordroPersonel(p: PersonelInsert): Promise<Personel> {
  const supabase = getSupabase();
  // Bordro üzerinden eklenen kayıtlar "taseron" işçi olarak işaretlenir.
  // Şantiye atamasını personel tablosunda BIRAKMA — sadece atama geçmişine yaz
  // (bordro bağımsızlığı için). Personeller listesinde "Atanmamış" görünebilir,
  // ama bordro kanban'ı atama geçmişinden okur.

  // TC + Ad Soyad tekillik kontrolü — aynı TC veya aynı ad ile kayıtlı personel varsa engelle
  if (p.tc_kimlik_no && p.tc_kimlik_no.trim()) {
    const { data: tcDup } = await supabase
      .from("personel")
      .select("id, ad_soyad, personel_tipi")
      .eq("tc_kimlik_no", p.tc_kimlik_no.trim())
      .limit(1);
    if (tcDup && tcDup.length > 0) {
      const mevcut = tcDup[0] as { ad_soyad: string; personel_tipi: string | null };
      const tipEtiket = mevcut.personel_tipi === "taseron" ? " (taşeron)" : "";
      throw new Error(
        `Bu TC Kimlik No (${p.tc_kimlik_no.trim()}) zaten "${mevcut.ad_soyad}"${tipEtiket} adıyla kayıtlı. ` +
        `Aynı personel sistemde yalnızca bir kez bulunabilir.`,
      );
    }
  }
  if (p.ad_soyad && p.ad_soyad.trim()) {
    const { data: adDup } = await supabase
      .from("personel")
      .select("id, tc_kimlik_no, personel_tipi")
      .eq("ad_soyad", p.ad_soyad.trim())
      .limit(1);
    if (adDup && adDup.length > 0) {
      const mevcut = adDup[0] as { tc_kimlik_no: string; personel_tipi: string | null };
      const tipEtiket = mevcut.personel_tipi === "taseron" ? " (taşeron)" : "";
      throw new Error(
        `Bu isimde ("${p.ad_soyad.trim()}")${tipEtiket} bir personel zaten kayıtlı (TC: ${mevcut.tc_kimlik_no}). ` +
        `Aynı personel sistemde yalnızca bir kez bulunabilir.`,
      );
    }
  }

  const istenenSantiyeId = p.santiye_id;
  const { data, error } = await supabase
    .from("personel")
    .insert({ ...p, santiye_id: null, personel_tipi: "taseron" })
    .select().single();
  if (error) throw error;
  if (istenenSantiyeId) {
    await supabase.from("personel_atama_gecmisi").insert({
      personel_id: (data as Personel).id,
      santiye_id: istenenSantiyeId,
      baslangic_tarihi: p.ise_giris_tarihi ?? bugun(),
      bitis_tarihi: null,
    });
  }
  return data as Personel;
}

// İşten çıkar — SADECE atama geçmişinde aktif atamayı kapat.
// Personel tablosu değişmez (durum/santiye_id) — bordro bağımsız.
export async function isenCikar(personelId: string, cikisTarihi?: string): Promise<void> {
  const supabase = getSupabase();
  const tarih = cikisTarihi || bugun();
  const { error } = await supabase
    .from("personel_atama_gecmisi")
    .update({ bitis_tarihi: tarih })
    .eq("personel_id", personelId)
    .is("bitis_tarihi", null);
  if (error) throw error;
}

// İşe geri al — SADECE yeni atama aç. Personel tablosu değişmez.
export async function iseGeriAl(personelId: string, santiyeId: string): Promise<void> {
  const supabase = getSupabase();
  const tarih = bugun();
  // Eğer yanlışlıkla aktif atama varsa onu da kapat (savunma)
  await supabase
    .from("personel_atama_gecmisi")
    .update({ bitis_tarihi: tarih })
    .eq("personel_id", personelId)
    .is("bitis_tarihi", null);
  const { error } = await supabase.from("personel_atama_gecmisi").insert({
    personel_id: personelId,
    santiye_id: santiyeId,
    baslangic_tarihi: tarih,
    bitis_tarihi: null,
  });
  if (error) throw error;
}

// Şantiye transferi — SADECE atama geçmişine yansır. Personel tablosu değişmez.
// Eski atama kapanır (bitis=transfer tarihi), yeni atama açılır.
export async function transferEt(personelId: string, yeniSantiyeId: string): Promise<void> {
  const supabase = getSupabase();
  const tarih = bugun();
  await supabase
    .from("personel_atama_gecmisi")
    .update({ bitis_tarihi: tarih })
    .eq("personel_id", personelId)
    .is("bitis_tarihi", null);
  const { error } = await supabase.from("personel_atama_gecmisi").insert({
    personel_id: personelId,
    santiye_id: yeniSantiyeId,
    baslangic_tarihi: tarih,
    bitis_tarihi: null,
  });
  if (error) throw error;
}

// --- Atama düzenleme / silme / ekleme (manuel gün girişi için) ---

export async function updateAtama(
  atamaId: string,
  updates: { baslangic_tarihi?: string; bitis_tarihi?: string | null },
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_atama_gecmisi")
    .update(updates)
    .eq("id", atamaId);
  if (error) throw error;
}

export async function deleteAtama(atamaId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("personel_atama_gecmisi").delete().eq("id", atamaId);
  if (error) throw error;
}

export async function insertAtama(
  personelId: string,
  santiyeId: string,
  baslangic: string,
  bitis: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_atama_gecmisi")
    .insert({
      personel_id: personelId,
      santiye_id: santiyeId,
      baslangic_tarihi: baslangic,
      bitis_tarihi: bitis,
    });
  if (error) throw error;
}

// --- Atama geçmişi & gün hesaplama ---

export async function getAtamaGecmisi(personelId: string): Promise<PersonelAtamaGecmisi[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_atama_gecmisi")
    .select("*")
    .eq("personel_id", personelId)
    .order("baslangic_tarihi", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PersonelAtamaGecmisi[];
}

// Tek seferde tüm atamaları çek — kanban için
export async function getAtamaGecmisiTumu(): Promise<PersonelAtamaGecmisi[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_atama_gecmisi")
    .select("*")
    .order("baslangic_tarihi", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PersonelAtamaGecmisi[];
}

// Personel başına şantiye → toplam gün haritası
export function gunHesapla(atamalar: PersonelAtamaGecmisi[]): Map<string, Map<string, number>> {
  // result[personelId][santiyeId] = toplamGün
  const result = new Map<string, Map<string, number>>();
  const today = bugun();
  for (const a of atamalar) {
    const bitis = a.bitis_tarihi ?? today;
    const gun = gunFarki(a.baslangic_tarihi, bitis);
    if (!result.has(a.personel_id)) result.set(a.personel_id, new Map());
    const inner = result.get(a.personel_id)!;
    inner.set(a.santiye_id, (inner.get(a.santiye_id) ?? 0) + gun);
  }
  return result;
}

// Aktif atamanın (bitis_tarihi=null) ay-bazlı sanal bitiş tarihi:
//  - Geçmiş ay: o ayın son günü (devam ediyor varsayımı)
//  - Bu ay: bugün (sadece şu ana kadar çalışılan günler)
//  - Gelecek ay: o ayın son günü (devam edeceği varsayımı)
function aktifBitisHam(ayBaslangic: string, ayBitis: string): string {
  const today = bugun();
  if (today >= ayBaslangic && today <= ayBitis) return today;
  return ayBitis;
}

// Belirli bir ay (YYYY-MM) içinde her personelin her şantiyede kaç gün olduğu.
// Atama dönemleri ayın sınırlarına clamplenir.
export function gunHesaplaAyBazli(
  atamalar: PersonelAtamaGecmisi[],
  ayStr: string,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const [yil, ay] = ayStr.split("-").map(Number);
  const ayBaslangic = `${yil}-${String(ay).padStart(2, "0")}-01`;
  const sonGun = new Date(yil, ay, 0).getDate();
  const ayBitis = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
  const aktifSanalBitis = aktifBitisHam(ayBaslangic, ayBitis);
  for (const a of atamalar) {
    const bitisHam = a.bitis_tarihi ?? aktifSanalBitis;
    // Çakışma kontrolü
    if (a.baslangic_tarihi > ayBitis) continue;
    if (bitisHam < ayBaslangic) continue;
    const clampBaslangic = a.baslangic_tarihi > ayBaslangic ? a.baslangic_tarihi : ayBaslangic;
    const clampBitis = bitisHam < ayBitis ? bitisHam : ayBitis;
    const gun = gunFarki(clampBaslangic, clampBitis);
    if (!result.has(a.personel_id)) result.set(a.personel_id, new Map());
    const inner = result.get(a.personel_id)!;
    inner.set(a.santiye_id, (inner.get(a.santiye_id) ?? 0) + gun);
  }
  return result;
}

// --- Günlük ücret (yıl bazlı) ---
export type GunlukUcret = { id: string; yil: number; ucret: number; created_at: string; updated_at: string };

export async function getGunlukUcretler(): Promise<GunlukUcret[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("bordro_gunluk_ucret").select("*").order("yil", { ascending: false });
  if (error) return [];
  return (data ?? []) as GunlukUcret[];
}

export async function setGunlukUcret(yil: number, ucret: number): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("bordro_gunluk_ucret")
    .upsert({ yil, ucret, updated_at: new Date().toISOString() }, { onConflict: "yil" });
  if (error) throw error;
}

export async function deleteGunlukUcret(yil: number): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("bordro_gunluk_ucret").delete().eq("yil", yil);
  if (error) throw error;
}

// --- Manuel gün override (tarihleri etkilemez, sadece görüntü/raporlama) ---

export async function getManuelGunler(): Promise<PersonelAtamaManuelGun[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("personel_atama_manuel_gun").select("*");
  if (error) {
    // Tablo henüz yoksa sessizce boş döndür
    return [];
  }
  return (data ?? []) as PersonelAtamaManuelGun[];
}

export async function setManuelGun(
  personelId: string, santiyeId: string, ay: string, gun: number,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_atama_manuel_gun")
    .upsert(
      { personel_id: personelId, santiye_id: santiyeId, ay, gun },
      { onConflict: "personel_id,santiye_id,ay" },
    );
  if (error) throw error;
}

export async function deleteManuelGun(
  personelId: string, santiyeId: string, ay: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_atama_manuel_gun")
    .delete()
    .eq("personel_id", personelId)
    .eq("santiye_id", santiyeId)
    .eq("ay", ay);
  if (error) throw error;
}

// --- Bilgi notu (personel × şantiye) ---
// Ay-bazlı DEĞİL — kullanıcı silmedikçe her ayda görünür (kalıcı not).
// DB column: icerik ('not' Postgres reserved keyword olduğu için icerik kullanıldı)
export type BilgiNotu = { id: string; personel_id: string; santiye_id: string; icerik: string | null };

export async function getBilgiNotlari(): Promise<BilgiNotu[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("personel_atama_bilgi_notu").select("*");
  if (error) return [];
  return (data ?? []) as BilgiNotu[];
}

export async function setBilgiNotu(personelId: string, santiyeId: string, icerik: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_atama_bilgi_notu")
    .upsert(
      { personel_id: personelId, santiye_id: santiyeId, icerik, updated_at: new Date().toISOString() },
      { onConflict: "personel_id,santiye_id" },
    );
  if (error) throw error;
}

export async function deleteBilgiNotu(personelId: string, santiyeId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_atama_bilgi_notu")
    .delete()
    .eq("personel_id", personelId)
    .eq("santiye_id", santiyeId);
  if (error) throw error;
}

// gunHesaplaAyBazli'nin override-aware versiyonu: manuel gün varsa onu uygular.
export function gunHesaplaAyBazliOverride(
  atamalar: PersonelAtamaGecmisi[],
  ayStr: string,
  overrideMap: Map<string, number>,  // key: `${personelId}:${santiyeId}`
): Map<string, Map<string, number>> {
  const dogal = gunHesaplaAyBazli(atamalar, ayStr);
  // Override'ları uygula — eğer doğal gün >0 veya override >0 ise overrideki değeri kullan
  for (const [key, gun] of overrideMap) {
    const [pId, sId] = key.split(":");
    if (!pId || !sId) continue;
    if (!dogal.has(pId)) dogal.set(pId, new Map());
    dogal.get(pId)!.set(sId, gun);
  }
  return dogal;
}

// Belirli bir ayın SON gününde personelin hangi şantiyede olduğunu döner.
// Pasif olanlar için: o ayın sonunda halen aktif atama var mı bak.
export function aySonuSantiyeMap(
  atamalar: PersonelAtamaGecmisi[],
  ayStr: string,
): Map<string, string> {
  const result = new Map<string, string>();
  const [yil, ay] = ayStr.split("-").map(Number);
  const sonGun = new Date(yil, ay, 0).getDate();
  const ayBitis = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
  // En son aktif atamayı bul: baslangic <= ayBitis AND (bitis IS NULL OR bitis >= ayBitis)
  // Aynı personel için baslangic_tarihi'ne göre büyük olanı seç (en güncel aktif).
  const personelAtamalari = new Map<string, PersonelAtamaGecmisi[]>();
  for (const a of atamalar) {
    if (a.baslangic_tarihi > ayBitis) continue;
    const bitisVal = a.bitis_tarihi ?? "9999-12-31";
    if (bitisVal < ayBitis) continue;
    if (!personelAtamalari.has(a.personel_id)) personelAtamalari.set(a.personel_id, []);
    personelAtamalari.get(a.personel_id)!.push(a);
  }
  for (const [pId, atamalar] of personelAtamalari) {
    atamalar.sort((a, b) => b.baslangic_tarihi.localeCompare(a.baslangic_tarihi));
    result.set(pId, atamalar[0].santiye_id);
  }
  return result;
}
