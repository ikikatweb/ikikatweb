// Personel × Şantiye bazlı teknik personel bayrağı + (opsiyonel) atanan isim.
// Sadece bilgi amaçlı rozet için kullanılır — atamalara, giriş/çıkış tarihlerine
// veya gün hesabına HİÇBİR ETKİSİ YOKTUR.
//
// Tablo şeması (Supabase SQL editor'de çalıştırılmalı):
//   CREATE TABLE IF NOT EXISTS personel_teknik (
//     personel_id UUID NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
//     santiye_id UUID NOT NULL REFERENCES santiyeler(id) ON DELETE CASCADE,
//     is_teknik BOOLEAN NOT NULL DEFAULT TRUE,
//     teknik_isim TEXT NULL,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     PRIMARY KEY (personel_id, santiye_id)
//   );
//
// teknik_isim: yeni model — kullanıcı şantiyenin teknik_personeller listesinden
// bir isim seçer ve burada saklanır. Eski model (is_teknik=true/false) hâlâ
// çalışır; teknik_isim null kalır.
import { createClient } from "@/lib/supabase/client";

export type PersonelTeknikRow = {
  personel_id: string;
  santiye_id: string;
  is_teknik: boolean;
  teknik_isim?: string | null;
  created_at?: string;
};

function getSupabase() {
  return createClient();
}

function isTableMissingError(msg: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("personel_teknik") && (
    m.includes("does not exist")
    || m.includes("could not find the table")
    || m.includes("could not find a relation")
    || m.includes("schema cache")
  );
}

function isColumnMissingError(msg: string, col: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  const c = col.toLowerCase();
  // Daha esnek: kolon adı mesajda geçiyorsa ve "missing/find/column/schema/exist" kelimelerinden biri varsa
  if (!m.includes(c)) return false;
  return (
    m.includes("column")
    || m.includes("could not find")
    || m.includes("schema cache")
    || m.includes("does not exist")
    || m.includes("unknown")
    || m.includes("missing")
  );
}

// Tüm teknik personel × şantiye eşleşmelerini getir.
export async function getTeknikPersonelKayitlari(): Promise<PersonelTeknikRow[]> {
  const supabase = getSupabase();
  // İlk denemede teknik_isim ile birlikte çek
  const { data, error } = await supabase
    .from("personel_teknik")
    .select("personel_id, santiye_id, is_teknik, teknik_isim");
  if (error && isColumnMissingError(error.message, "teknik_isim")) {
    // Eski şema: teknik_isim kolonu yok → onsuz çek
    const res = await supabase.from("personel_teknik").select("personel_id, santiye_id, is_teknik");
    if (res.error) {
      if (isColumnMissingError(res.error.message, "is_teknik")) {
        // Hiç is_teknik kolonu yoksa (en eski şema) → tüm satırları true say
        const res2 = await supabase.from("personel_teknik").select("personel_id, santiye_id");
        if (res2.error) {
          if (isTableMissingError(res2.error.message)) return [];
          throw res2.error;
        }
        return (res2.data ?? []).map((r) => ({ ...r, is_teknik: true, teknik_isim: null }));
      }
      if (isTableMissingError(res.error.message)) return [];
      throw res.error;
    }
    return (res.data ?? []).map((r) => ({ ...r, teknik_isim: null })) as PersonelTeknikRow[];
  }
  if (error && isColumnMissingError(error.message, "is_teknik")) {
    const res = await supabase.from("personel_teknik").select("personel_id, santiye_id");
    if (res.error) {
      if (isTableMissingError(res.error.message)) return [];
      throw res.error;
    }
    return (res.data ?? []).map((r) => ({ ...r, is_teknik: true, teknik_isim: null }));
  }
  if (error) {
    if (isTableMissingError(error.message)) return [];
    throw error;
  }
  return (data ?? []) as PersonelTeknikRow[];
}

// TEKNİK ATAMA UYARISI — İhaleli+aktif işlerde, işyeri tesliminden sonra `teknik_atama_gun` içinde teknik
// personel ataması (personel_teknik: is_teknik + teknik_isim dolu) LİSTE KADAR (teknik_personeller.length)
// yapılmamışsa uyarır. Son tarih = teslim + gün; süre dolmadan geri sayım, geçince gecikme.
export type TeknikAtamaEksik = {
  santiye_id: string;
  is_adi: string;
  bazTarih: string;                 // hesaplamada kullanılan baz tarih
  bazTip: "teslim" | "sozlesme";    // teslim girilmişse "teslim"; yoksa geçici olarak "sozlesme"
  teknik_atama_gun: number;         // kullanılan süre (girilmemişse 10)
  gunVarsayilan: boolean;           // süre girilmemiş, 10 varsayıldıysa true
  gereken: number;   // teknik_personeller listesindeki rol sayısı
  atanan: number;    // atanmış teknik personel sayısı
  sonTarih: string;  // YYYY-MM-DD (baz + gün)
  kalanGun: number;  // >=0 kaldı, <0 gecikti
};
export async function getTeknikAtamaEksikleri(): Promise<TeknikAtamaEksik[]> {
  const supabase = getSupabase();
  const { data: santiyeler, error } = await supabase
    .from("santiyeler")
    .select("id, is_adi, durum, ihaleli, isyeri_teslim_tarihi, sozlesme_tarihi, teknik_atama_gun, teknik_personeller")
    .eq("durum", "aktif");
  if (error) return [];
  type S = { id: string; is_adi: string; ihaleli?: boolean | null; isyeri_teslim_tarihi: string | null; sozlesme_tarihi: string | null; teknik_atama_gun: number | null; teknik_personeller: string[] | null };
  // İhaleli + aktif + teknik gerekli (liste dolu). Teslim/süre YOKSA fallback uygulanır (aşağıda).
  const isler = (santiyeler ?? []).filter((s: S) =>
    s.ihaleli !== false && Array.isArray(s.teknik_personeller) && s.teknik_personeller.length > 0) as S[];
  if (isler.length === 0) return [];

  // Şantiye başına atanmış teknik personel sayısı (is_teknik + teknik_isim dolu)
  const teknikler = await getTeknikPersonelKayitlari();
  const atananMap = new Map<string, number>();
  for (const t of teknikler) {
    if (t.is_teknik && t.teknik_isim && String(t.teknik_isim).trim().length > 0) {
      atananMap.set(t.santiye_id, (atananMap.get(t.santiye_id) ?? 0) + 1);
    }
  }

  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
  const gunFark = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
  const bugun = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }); // YYYY-MM-DD (TR)

  const GERI_SAYIM_ESIK = 3;    // geri sayım uyarısı yalnız son 3 gün kala başlar (öncesi sessiz); geçince gecikme devam eder
  const VARSAYILAN_GUN = 10;    // atama süresi girilmemişse 10 gün varsay (kullanıcı isteği)
  const sonuc: TeknikAtamaEksik[] = [];
  for (const s of isler) {
    const gereken = (s.teknik_personeller as string[]).length;
    const atanan = atananMap.get(s.id) ?? 0;
    if (atanan >= gereken) continue;                       // yeterli teknik atanmış → uyarma
    // BAZ TARİH: teslim varsa teslim; yoksa GEÇİCİ olarak sözleşme tarihi (teslim girilince ona göre güncellenir).
    const bazTarih = s.isyeri_teslim_tarihi ?? s.sozlesme_tarihi;
    if (!bazTarih) continue;                               // ne teslim ne sözleşme → hesaplanamaz (uyarı verilemez)
    const gunVarsayilan = s.teknik_atama_gun == null || s.teknik_atama_gun <= 0;
    const gun = gunVarsayilan ? VARSAYILAN_GUN : (s.teknik_atama_gun as number);
    const sonTarih = addDays(bazTarih, gun);
    const kalanGun = gunFark(bugun, sonTarih);
    if (kalanGun > GERI_SAYIM_ESIK) continue;              // son tarihe 3 günden fazla var → henüz uyarma
    sonuc.push({
      santiye_id: s.id, is_adi: s.is_adi,
      bazTarih, bazTip: s.isyeri_teslim_tarihi ? "teslim" : "sozlesme",
      teknik_atama_gun: gun, gunVarsayilan, gereken, atanan, sonTarih, kalanGun,
    });
  }
  return sonuc.sort((a, b) => a.kalanGun - b.kalanGun); // en geciken / en yakın üstte
}

// Bir personeli BELİRLİ bir şantiyede teknik olarak işaretle (opsiyonel isim ile)
// veya işareti kaldır.
export async function setPersonelTeknikSantiye(
  personelId: string,
  santiyeId: string,
  isTeknik: boolean,
  teknikIsim?: string | null,
): Promise<void> {
  const supabase = getSupabase();
  // Upsert ile both true ve false durumunu kalıcı olarak işaretle, isim varsa kaydet
  const row: Record<string, unknown> = {
    personel_id: personelId,
    santiye_id: santiyeId,
    is_teknik: isTeknik,
    teknik_isim: isTeknik ? (teknikIsim ?? null) : null,
  };
  let { error } = await supabase
    .from("personel_teknik")
    .upsert(row, { onConflict: "personel_id,santiye_id" });
  if (error && isColumnMissingError(error.message, "teknik_isim")) {
    // Eski şema: teknik_isim kolonu yok → onsuz upsert
    delete row.teknik_isim;
    const res = await supabase
      .from("personel_teknik")
      .upsert(row, { onConflict: "personel_id,santiye_id" });
    error = res.error;
  }
  if (error && isColumnMissingError(error.message, "is_teknik")) {
    // En eski şema (is_teknik kolonu yok): true → insert, false → delete
    if (isTeknik) {
      const res = await supabase
        .from("personel_teknik")
        .upsert({ personel_id: personelId, santiye_id: santiyeId }, { onConflict: "personel_id,santiye_id" });
      error = res.error;
    } else {
      const res = await supabase
        .from("personel_teknik")
        .delete()
        .eq("personel_id", personelId)
        .eq("santiye_id", santiyeId);
      error = res.error;
    }
  }
  if (error) {
    if (isTableMissingError(error.message)) {
      throw new Error("personel_teknik tablosu bulunamadı. Supabase'de SQL migration çalıştırılmalı.");
    }
    throw error;
  }
}
