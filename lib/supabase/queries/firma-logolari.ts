// KENAR ÇUBUĞUNDA DÖNEN LOGOLAR — artık koda gömülü değil, firmalardan geliyor.
//
// Önceden logolar components/shared/logo-donen.tsx içinde sabit bir listeydi; yeni bir
// firma ya da ortaklık kurulduğunda logosu ancak kod değiştirilerek eklenebiliyordu.
// Artık Firma düzenleme ekranındaki "Logo Yükle" ile yüklenen her logo kendiliğinden
// dönüyor (sql/firmalar_logo.sql).
import { createClient } from "@/lib/supabase/client";
import type { LogoItem } from "@/components/shared/logo-donen";

let onbellek: Promise<LogoItem[]> | null = null;

async function cek(): Promise<LogoItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("firmalar")
    .select("firma_adi, kisa_adi, logo_url, renk, durum, sira_no")
    .eq("durum", "aktif")
    .not("logo_url", "is", null)
    .order("sira_no", { ascending: true });
  if (error) {
    // Kolon yoksa (migrasyon çalıştırılmamış) ya da oturum yoksa (giriş ekranı):
    // çağıran taraf koddaki varsayılan listeye düşer, ekran eskisi gibi kalır.
    console.warn("[firma logoları] okunamadı, koddaki varsayılan liste kullanılacak:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((f) => typeof f.logo_url === "string" && f.logo_url.trim())
    // RENK DE GELİR: kenar çubuğunda logonun yanında ince bir çubuk olarak
    // görünüyor — panelde firma rengi her yerde (tablolar, kartlar) bu dille
    // gösteriliyor, logo da aynı dili konuşsun.
    .map((f) => ({
      src: String(f.logo_url),
      alt: f.kisa_adi?.trim() || f.firma_adi,
      renk: typeof f.renk === "string" && f.renk.trim() ? f.renk : null,
    }));
}

export function getFirmaLogolari(): Promise<LogoItem[]> {
  if (!onbellek) onbellek = cek();
  return onbellek;
}

/** Logo yüklendikten/silindikten sonra çağrılır. Kenar çubuğu açık kalmaya devam
 *  ettiği için haber de verilir: dinleyen LogoDonen listesini anında tazeler, yoksa
 *  silinen logo sayfa yenilenene kadar dönmeye devam ederdi. */
export const LOGO_DEGISTI_OLAYI = "firma-logolari-degisti";

export function firmaLogolariOnbellegiDusur() {
  onbellek = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOGO_DEGISTI_OLAYI));
}
