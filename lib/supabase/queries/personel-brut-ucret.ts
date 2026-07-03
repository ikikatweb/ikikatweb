// Personel Brüt Ücret Geçmişi sorguları
// Tıpkı arac_kira_bedeli mantığında: her değişiklik yeni satır olarak kaydedilir,
// belirli bir tarih/ay için geçerli ücret latest gecerli_tarih <= o tarih kuralıyla bulunur.
import { createClient } from "@/lib/supabase/client";
import type { PersonelBrutUcret, PersonelAtamaGecmisi } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Tüm personellerin brüt ücret geçmişini getir (bordro / iscilik-takibi sayfaları için)
export async function getTumPersonelBrutUcretler(): Promise<PersonelBrutUcret[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_brut_ucret")
    .select("*")
    .order("gecerli_tarih", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    // Tablo henüz yoksa sessizce boş dön (migration çalıştırılana kadar)
    return [];
  }
  return (data ?? []) as PersonelBrutUcret[];
}

// Tek personelin brüt ücret geçmişi
export async function getPersonelBrutUcretler(
  personelId: string,
): Promise<PersonelBrutUcret[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_brut_ucret")
    .select("*")
    .eq("personel_id", personelId)
    .order("gecerli_tarih", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as PersonelBrutUcret[];
}

// Yeni brüt ücret kaydı ekle (geçmişe yeni satır)
export async function insertPersonelBrutUcret(
  personelId: string,
  ucret: number,
  gecerliTarih: string,
  kullaniciId?: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const { data, error, status, statusText } = await supabase
    .from("personel_brut_ucret")
    .insert({
      personel_id: personelId,
      ucret,
      gecerli_tarih: gecerliTarih,
      created_by: kullaniciId ?? null,
    })
    .select();
  if (error) {
    // Supabase PostgrestError'i tüm alanlarıyla ayağa kaldıralım — boş objeye düşmesin.
    const props = Object.getOwnPropertyNames(error);
    const dump: Record<string, unknown> = {};
    for (const k of props) dump[k] = (error as unknown as Record<string, unknown>)[k];
    console.error(
      "[insertPersonelBrutUcret] Supabase hata:",
      { status, statusText, error, dump, message: error.message, code: error.code, details: error.details, hint: error.hint },
    );
    // Yeni Error oluştur — orijinal hata alanlarını kopyala.
    const wrapped = new Error(
      [error.message, error.details, error.hint].filter(Boolean).join(" — ")
        || `HTTP ${status} ${statusText}`
        || "Bilinmeyen Supabase hatası",
    ) as Error & { code?: string; details?: string; hint?: string; status?: number };
    wrapped.code = error.code;
    wrapped.details = error.details;
    wrapped.hint = error.hint;
    wrapped.status = status;
    throw wrapped;
  }
  // Insert başarılıysa data dönmeli (RLS engelliyorsa boş array dönebilir, hata vermeyebilir)
  if (!data || data.length === 0) {
    throw new Error(
      "Kayıt insert edildi gibi görünüyor ama satır dönmedi. Muhtemel neden: Row Level Security (RLS) erişimi engelliyor. " +
      "Supabase SQL editöründe çalıştırın: ALTER TABLE personel_brut_ucret DISABLE ROW LEVEL SECURITY;",
    );
  }
}

// Mevcut bir kaydı güncelle
export async function updatePersonelBrutUcret(
  id: string,
  ucret: number,
  gecerliTarih: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_brut_ucret")
    .update({ ucret, gecerli_tarih: gecerliTarih })
    .eq("id", id);
  if (error) throw error;
}

// Kaydı sil
export async function deletePersonelBrutUcret(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_brut_ucret")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Yardımcı: belirli bir personel × ay için geçerli brüt ücreti bul.
// ayStr: "YYYY-MM"
// Kural: gecerli_tarih <= ayın son günü olan en güncel kayıt.
// Eğer hiç kayıt yoksa veya hiçbiri ay sonuna kadar geçerli değilse 0 döner.
export function brutUcretForAy(
  history: PersonelBrutUcret[],
  personelId: string,
  ayStr: string,
): number {
  const [yil, ay] = ayStr.split("-").map(Number);
  const sonGun = new Date(yil, ay, 0).getDate();
  const limit = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
  let enUygun: PersonelBrutUcret | null = null;
  for (const h of history) {
    if (h.personel_id !== personelId) continue;
    if (h.gecerli_tarih > limit) continue;
    if (!enUygun || h.gecerli_tarih > enUygun.gecerli_tarih) {
      enUygun = h;
    }
  }
  return enUygun?.ucret ?? 0;
}

// Belirli bir GÜN için geçerli brüt ücret. Her kayıt [gecerli_tarih, sonrakinin bir gün öncesi] aralığında
// geçerlidir; son kayıt açık. Kural: gecerli_tarih <= gün olan en güncel kayıt. Yoksa 0.
// gunStr: "YYYY-MM-DD"
export function brutUcretForGun(
  history: PersonelBrutUcret[],
  personelId: string,
  gunStr: string,
): number {
  let enUygun: PersonelBrutUcret | null = null;
  for (const h of history) {
    if (h.personel_id !== personelId) continue;
    if (h.gecerli_tarih > gunStr) continue;
    if (!enUygun || h.gecerli_tarih > enUygun.gecerli_tarih) enUygun = h;
  }
  return enUygun?.ucret ?? 0;
}

// Bir personel-ayın brüt TUTARI, ay içindeki ücret değişimlerini GERÇEK çalışılan günlere göre böler.
// - gun: o ayda o personelin (SGK-normalize) toplam günü (ör. tam ay = 30). Değişim yoksa: gun × o ay ücreti.
// - Değişim VARSA: personelin o ayda ÇALIŞTIĞI günler (atama tarih aralıklarından) tek tek gezilir, her güne
//   o gün geçerli ücret uygulanır, sonuç SGK gün'üne ölçeklenir. Böylece "girilen tarihler arasında girilen
//   brüt ücret" uygulanır — çalışılmayan günlere pay verilmez (ör. 02–12.06 çalışan, tümü 2.941 döneminde).
// - atamalar+santiyeId verilmezse (ya da o ay atama yoksa) takvim-gün oranıyla yaklaşık böler (fallback).
// - fallbackUcret: o gün için brüt kaydı yoksa kullanılacak (yıllık günlük ücret). 0 ise 0.
export function aylikBrutTutar(
  history: PersonelBrutUcret[],
  personelId: string,
  ayStr: string,
  gun: number,
  fallbackUcret = 0,
  atamalar?: PersonelAtamaGecmisi[],
  santiyeId?: string,
): number {
  if (gun <= 0) return 0;
  const [yil, ay] = ayStr.split("-").map(Number);
  const sonGun = new Date(yil, ay, 0).getDate();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ayBas = `${yil}-${p2(ay)}-01`;
  const ayBit = `${yil}-${p2(ay)}-${p2(sonGun)}`;
  const kullan = (u: number) => (u > 0 ? u : fallbackUcret);
  // Bu ayda BAŞLAYAN ücret değişimleri (ay başından SONRAKİ kesim noktaları — gün 1'deki değişim ayı bölmez).
  const kesimGunleri = history
    .filter((h) => h.personel_id === personelId && h.gecerli_tarih > ayBas && h.gecerli_tarih <= ayBit)
    .map((h) => Number(h.gecerli_tarih.slice(8, 10)))
    .filter((n) => n >= 2 && n <= sonGun)
    .sort((a, b) => a - b);
  // Ay içinde değişim yok → tek ücret (o ayın sonunda geçerli).
  if (kesimGunleri.length === 0) return gun * kullan(brutUcretForAy(history, personelId, ayStr));

  // TAM YÖNTEM: gerçek çalışılan günleri (atama∩ay) tek tek gez, her güne o gün geçerli ücreti uygula, gun'a ölçekle.
  if (atamalar && santiyeId) {
    let toplam = 0;
    let sayac = 0;
    for (const a of atamalar) {
      if (a.personel_id !== personelId || a.santiye_id !== santiyeId) continue;
      const bitHam = a.bitis_tarihi ?? ayBit; // aktif atama → ay sonuna kadar (gün toplamı zaten gun'a ölçeklenir)
      if (a.baslangic_tarihi > ayBit || bitHam < ayBas) continue;
      const bas = a.baslangic_tarihi > ayBas ? a.baslangic_tarihi : ayBas;
      const bit = bitHam < ayBit ? bitHam : ayBit;
      const d = new Date(bas + "T00:00:00");
      const end = new Date(bit + "T00:00:00");
      while (d.getTime() <= end.getTime()) {
        const ds = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
        toplam += kullan(brutUcretForGun(history, personelId, ds));
        sayac += 1;
        d.setDate(d.getDate() + 1);
      }
    }
    if (sayac > 0) return toplam * (gun / sayac); // SGK gün'üne (30 tavan / Şubat tamamlama) ölçekle
  }

  // FALLBACK (atama yok — ör. tarihsiz manuel): takvim-gün oranıyla böl.
  const sinirlar = [1, ...kesimGunleri, sonGun + 1];
  let toplam = 0;
  for (let i = 0; i < sinirlar.length - 1; i++) {
    const bas = sinirlar[i], bit = sinirlar[i + 1];
    const takvimGun = bit - bas;
    if (takvimGun <= 0) continue;
    const donemUcret = kullan(brutUcretForGun(history, personelId, `${yil}-${p2(ay)}-${p2(bas)}`));
    toplam += gun * (takvimGun / sonGun) * donemUcret;
  }
  return toplam;
}
