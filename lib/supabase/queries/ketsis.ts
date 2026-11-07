// KETSİS (GİB e-tebligat) SORGULARI — vergi dairesi tebligatının bildirim maili.
//
// Burada TEBLİGATIN KENDİSİ yok, olamaz: KETSİS'in alıcı tarafı için API yayınlanmış
// değil, belge yalnız Dijital Vergi Dairesi ekranından görülür (gerekçe:
// sql/ketsis_bildirim.sql başlığı). Bu tablolar "git bak" uyarısını taşır.
//
// Tablolar SALT OKUNUR: yazma /api/ketsis/kontrol rotasından, servis anahtarıyla olur.
import { createClient } from "@/lib/supabase/client";

/** Dijital Vergi Dairesi — tebligatın okunacağı tek yer. */
export const GIB_GIRIS = "https://dijital.gib.gov.tr/";

/** Kaç gün bakılmazsa ana ekran hatırlatması çıkar. */
export const KONTROL_ARALIGI_GUN = 7;

export type KetsisBildirim = {
  id: number;
  kutu: string;
  /** Mailin bulunduğu klasör. INBOX dışı bir değer tek başına bulgudur (Junk'a düşmüş olabilir). */
  klasor: string | null;
  mail_tarihi: string;
  gonderen: string | null;
  gonderen_adres: string | null;
  konu: string | null;
  ozet: string | null;
  vkn: string | null;
  /** GİB mailinin konusundaki belge numarası — Dijital Vergi Dairesi'nde liste bununla eşleşir. */
  belge_no: string | null;
  guven: "kesin" | "aday";
  durum: "yeni" | "kontrol_edildi" | "ilgisiz";
  kontrol_eden_ad: string | null;
  kontrol_at: string | null;
  notlar: string | null;
  firma_id: string | null;
  firmalar?: { firma_adi: string; kisa_adi: string | null; renk: string | null } | null;
};

/**
 * Dijital Vergi Dairesi'nde GÖRÜLEN tebligatın elle tutulan kaydı (ketsis_tebligat).
 * Bildirim mailinden farklı: burada tebligatın kendisi var, süresiyle birlikte.
 */
export type KetsisTebligat = {
  id: number;
  firma_id: string | null;
  vergi_dairesi: string | null;
  konu: string | null;
  belge_no: string | null;
  ulasma_tarihi: string;
  /** Hesaplanan sütun: ulaşma + 5 gün (VUK 107/A). */
  teblig_tarihi: string;
  okundu_at: string | null;
  okuyan_ad: string | null;
  notlar: string | null;
  kaydeden_ad: string | null;
  created_at: string;
  firmalar?: { firma_adi: string; kisa_adi: string | null; renk: string | null } | null;
};

export type KetsisKontrol = {
  id: number;
  kontrol_at: string;
  kullanici_ad: string | null;
  bulgu: string;
  notlar: string | null;
};

/** Tarayıcının son çalışma damgası — görev sessizce ölmüşse tek belirti bu. */
export type KetsisTarayiciDurum = {
  kutu: string;
  son_calisma: string | null;
  son_sonuc: string | null;
  son_hata: string | null;
};

function sb() { return createClient(); }

export async function getKetsisBildirimler(): Promise<KetsisBildirim[]> {
  const { data, error } = await sb()
    .from("ketsis_bildirim")
    .select("*, firmalar ( firma_adi, kisa_adi, renk )")
    .order("mail_tarihi", { ascending: false })
    .limit(200);
  // Hata YUTULMAZ: boş liste "bildirim yok" diye okunur, oysa sorgu patlamıştır.
  if (error) throw error;
  return (data ?? []) as unknown as KetsisBildirim[];
}

/** En son elle kontrol. Hiç yoksa null → hatırlatma "hiç bakılmadı" der. */
export async function getSonKetsisKontrol(): Promise<KetsisKontrol | null> {
  const { data, error } = await sb()
    .from("ketsis_kontrol")
    .select("id, kontrol_at, kullanici_ad, bulgu, notlar")
    .order("kontrol_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as KetsisKontrol | undefined) ?? null;
}

export async function getKetsisTebligatlar(): Promise<KetsisTebligat[]> {
  const { data, error } = await sb()
    .from("ketsis_tebligat")
    .select("*, firmalar ( firma_adi, kisa_adi, renk )")
    .order("teblig_tarihi", { ascending: true })
    .limit(500);
  // Hata YUTULMAZ: boş liste "tebligat yok" diye okunur, oysa sorgu patlamış olabilir.
  if (error) throw error;
  return (data ?? []) as unknown as KetsisTebligat[];
}

/** Tebliğ sayılacağı güne kalan tam gün. Negatif = süre geçti. */
export function ketsisKalanGun(teblig_tarihi: string): number {
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const son = new Date(teblig_tarihi + "T00:00:00");
  return Math.round((son.getTime() - bugun.getTime()) / 86400000);
}

export async function getKetsisTarayici(): Promise<KetsisTarayiciDurum[]> {
  const { data, error } = await sb()
    .from("ketsis_imap_durum").select("kutu, son_calisma, son_sonuc, son_hata");
  if (error) throw error;
  return (data ?? []) as KetsisTarayiciDurum[];
}

/** Son kontrolden bu yana geçen tam gün sayısı. Hiç kontrol yoksa null. */
export function kontrolYasiGun(kontrol_at: string | null | undefined): number | null {
  if (!kontrol_at) return null;
  return Math.floor((Date.now() - new Date(kontrol_at).getTime()) / 86400000);
}
