// KONUM AYDINLATMA ONAYLARI — kim onayladı, ne zaman, hangi cihazdan.
//
// NİYE: onay kaydı KVKK savunma belgesi (bkz. sql/konum_onay_kanit.sql).
// "Bu kişiye söylemiş miydik" sorusu, kayda bakılmadan kullanıcı listesinden
// de görülebilsin diye listede küçük bir işaretle gösteriliyor.
//
// RLS: tablo oturum açmış kullanıcıya açık (panelin kendi izin matrisi
// hangi sayfanın açılacağını zaten belirliyor).
import { createClient } from "@/lib/supabase/client";

export type KonumOnayOzet = {
  kullanici_id: string;
  metin_surum: string;
  onay_at: string;
  cihaz: string | null;
  konum_izni: boolean | null;
  /** Metin boşsa kişi onay vermedi — satır yalnız ret kaydı olabilir. */
  metin: string | null;
  /** Konum izni en son ne zaman reddedildi (sql/konum_izin_reddi.sql). */
  ret_at: string | null;
  ret_sebep: string | null;
  /** site = site izni kapalı · cihaz = telefonun konum servisi kapalı */
  ret_kaynak: string | null;
};

/** Listede gösterilen üç durum. */
export type KonumDurum = "onayli" | "reddetti" | "yok";

/**
 * Kaydı duruma çevir.
 *
 * SIRA ÖNEMLİ: önce onay bakılır. Önce reddedip sonra izni açıp onaylayan
 * kişide ret_at geçmiş kaydı olarak duruyor; o kişi KIRMIZI değil YEŞİL.
 */
export function konumDurumu(o: KonumOnayOzet | undefined): KonumDurum {
  if (!o) return "yok";
  if (o.konum_izni === true && (o.metin ?? "").length > 0) return "onayli";
  if (o.ret_at) return "reddetti";
  return "yok";
}

/**
 * Kullanıcı kimliğine göre onay özeti.
 *
 * YÜRÜRLÜKTEKİ SÜRÜM SÜZÜLMEZ: eski sürümü onaylamış kişi de "onay vermiş"
 * sayılır — listede görünen şey "bu kişi aydınlatmayı okudu mu", "en son
 * metni okudu mu" değil. Hangi sürüm olduğu ipucunda yazıyor.
 *
 * SESSİZ BAŞARISIZLIK YOK: tablo okunamazsa hata YUKARI ATILIR; çağıran
 * sayfa işareti hiç göstermemek yerine durumu bildirmeli, yoksa "kimse onay
 * vermemiş" gibi görünür.
 */
export async function getKonumOnaylari(): Promise<Record<string, KonumOnayOzet>> {
  const { data, error } = await createClient()
    .from("konum_onaylari")
    .select("kullanici_id, metin_surum, onay_at, cihaz, konum_izni, metin, ret_at, ret_sebep, ret_kaynak")
    .order("onay_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Aynı kişinin birden fazla sürüm onayı olabilir; EN YENİSİ tutulur
  // (sorgu zaten tarihe göre tersten geliyor, ilk gelen en yeni).
  const map: Record<string, KonumOnayOzet> = {};
  for (const o of (data ?? []) as KonumOnayOzet[]) {
    if (!map[o.kullanici_id]) map[o.kullanici_id] = o;
  }
  return map;
}
