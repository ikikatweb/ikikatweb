// DOLU PENCERE YANLIŞLIKLA KAPANMASIN.
//
// NİYE: pencerenin dışına dokunmak ya da ESC'e basmak formu anında kapatıyor,
// yazılan her şey sessizce gidiyordu. Uzun bir icra kaydını ya da avukat notunu
// baştan yazmak gerekiyor, üstelik kullanıcı ne kaybettiğini de görmüyor —
// pencere "kaydedildi mi, kapandı mı" ayrımını hiç göstermeden kayboluyor.
//
// KAPATMA DÜĞMELERİ SORMAZ: İptal ve ✕ zaten kullanıcının istediği şey. Soru
// yalnız KAZAYLA kapanışta çıkar; her kapanışta sormak düğmeyi iki tıka çıkarır.

/** Base UI'ın "istemeden kapandı" sebepleri (@base-ui/react → reason-parts). */
const KAZA_SEBEPLERI = new Set(["outside-press", "escape-key", "close-watcher", "focus-out"]);

export const KAPANIS_UYARISI =
  "Girdiğiniz bilgiler henüz kaydedilmedi. Pencereyi kapatırsanız yazdıklarınız silinir.\n\nKapatılsın mı?";

export function kazaylaKapanma(detay: unknown): boolean {
  const r = (detay as { reason?: string } | null | undefined)?.reason;
  return typeof r === "string" && KAZA_SEBEPLERI.has(r);
}

/**
 * Pencere kapanabilir mi? Dolu formda kazara kapanışta kullanıcıya sorar.
 * false dönerse çağıran pencereyi AÇIK bırakmalı.
 */
export function kapanabilir(detay: unknown, kirli: boolean): boolean {
  if (!kirli || !kazaylaKapanma(detay)) return true;
  if (typeof window === "undefined") return true;
  return window.confirm(KAPANIS_UYARISI);
}

/** İki form durumu aynı mı? (alan sırası sabit olduğu için JSON yeterli) */
export function ayniMi(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
