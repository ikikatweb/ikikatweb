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
    .select("firma_adi, kisa_adi, logo_url, durum, sira_no")
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
    .map((f) => ({ src: String(f.logo_url), alt: f.kisa_adi?.trim() || f.firma_adi }));
}

export function getFirmaLogolari(): Promise<LogoItem[]> {
  if (!onbellek) onbellek = cek();
  return onbellek;
}

/** Logo yüklendikten/silindikten sonra çağrılır. */
export function firmaLogolariOnbellegiDusur() {
  onbellek = null;
}
