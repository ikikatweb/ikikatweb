// ANTET GEÇMİŞİ SORGULARI — bkz. sql/firma_antet_gecmisi.sql
//
// Tablo küçük (firma başına birkaç satır) ve yazışma listelerinin HEPSİ bunu istiyor;
// bu yüzden bir kez çekilip bellekte tutuluyor. Antet yüklenince önbellek düşürülür.
import { createClient } from "@/lib/supabase/client";
import type { AntetGecmisSatiri } from "@/lib/utils/antet-gecmis";

let onbellek: Promise<AntetGecmisSatiri[]> | null = null;

async function cek(): Promise<AntetGecmisSatiri[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("firma_antet_gecmisi")
    .select("firma_id, antet_url, antet_renkli_url, gecerli_baslangic");
  if (error) {
    // Tablo henüz kurulmadıysa (migrasyon çalıştırılmamış) yazışma listeleri ÇALIŞMAYA
    // DEVAM ETSİN: boş geçmiş = firmanın şu anki anteti kullanılır, yani eski davranış.
    console.warn("[antet geçmişi] okunamadı, firmanın güncel anteti kullanılacak:", error.message);
    return [];
  }
  return (data ?? []) as AntetGecmisSatiri[];
}

export function getAntetGecmisi(): Promise<AntetGecmisSatiri[]> {
  if (!onbellek) onbellek = cek();
  return onbellek;
}

/** Antet yüklendikten sonra çağrılır — bir sonraki liste yenilemesinde taze okunur. */
export function antetGecmisiOnbellegiDusur() {
  onbellek = null;
}

/** Yeni yüklenen anteti geçmişe işler. Aynı firma+tarih varsa üzerine yazar
 *  (aynı gün ikinci kez yüklenirse iki kayıt birikmesin). */
export async function antetGecmisineEkle(
  firmaId: string,
  antetUrl: string,
  antetRenkliUrl: string | null,
  gecerliBaslangic: string,
) {
  const supabase = createClient();
  const { data: mevcut } = await supabase
    .from("firma_antet_gecmisi")
    .select("id")
    .eq("firma_id", firmaId)
    .eq("gecerli_baslangic", gecerliBaslangic)
    .limit(1)
    .maybeSingle();
  if (mevcut?.id) {
    const { error } = await supabase
      .from("firma_antet_gecmisi")
      .update({ antet_url: antetUrl, antet_renkli_url: antetRenkliUrl })
      .eq("id", mevcut.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("firma_antet_gecmisi")
      .insert({ firma_id: firmaId, antet_url: antetUrl, antet_renkli_url: antetRenkliUrl, gecerli_baslangic: gecerliBaslangic });
    if (error) throw error;
  }
  antetGecmisiOnbellegiDusur();
}
