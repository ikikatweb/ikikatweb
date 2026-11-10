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
};

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
    .select("kullanici_id, metin_surum, onay_at, cihaz, konum_izni")
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
