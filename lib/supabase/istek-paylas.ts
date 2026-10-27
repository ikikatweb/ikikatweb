// AYNI İSTEĞİ BİR KEZ SOR.
//
// Ana sayfada birbirinden habersiz birçok bileşen aynı tabloyu okuyor: Arvento widget'ı,
// sezon-uzunluk hesabı ve günlük metrik üçü de "arvento_ayarlar"ı; teknik atama uyarısı,
// prim dengesi ve bordro özeti üçü de "personel_teknik"i istiyor. Ölçümde bir açılışta
// aynı sorgu 5 kez gidiyordu.
//
// İKİ KADEME:
//   • tazeMs = 0 (varsayılan) → YALNIZ UÇUŞTAKİ istek paylaşılır. İlk çağıran isteği
//     başlatır, cevap gelene kadar gelenler aynı sözü alır, cevap gelince kayıt silinir.
//     Önbellek yok: bir sonraki çağrı yeniden sorar, yani veri asla bayat gelmez.
//   • tazeMs > 0 → cevap o kadar süre saklanır; aralıkla çalışan ama aynı anda olmayan
//     çağrılar da tek sorguya iner. YALNIZ nadiren değişen, gösterim amaçlı veriler için
//     kullanılır ve o veriyi DEĞİŞTİREN işlem istegiUnut() ile kaydı düşürür — böylece
//     kullanıcının kendi yaptığı değişiklik asla gecikmeli görünmez.
//
// Hata saklanmaz: istek başarısız olursa o anda bekleyen herkes aynı hatayı alır (zaten
// ayrı ayrı sorsalardı hepsi alacaktı) ama kayıt tutulmaz, sonraki çağrı yeniden dener.

const ucustakiler = new Map<string, Promise<unknown>>();
const saklananlar = new Map<string, { ts: number; deger: unknown }>();

export function paylasilanIstek<T>(anahtar: string, uret: () => Promise<T>, tazeMs = 0): Promise<T> {
  if (tazeMs > 0) {
    const saklanan = saklananlar.get(anahtar);
    if (saklanan && Date.now() - saklanan.ts < tazeMs) return Promise.resolve(saklanan.deger as T);
  }
  const mevcut = ucustakiler.get(anahtar) as Promise<T> | undefined;
  if (mevcut) return mevcut;
  const soz = uret()
    .then((deger) => {
      if (tazeMs > 0) saklananlar.set(anahtar, { ts: Date.now(), deger });
      return deger;
    })
    .finally(() => { ucustakiler.delete(anahtar); });
  ucustakiler.set(anahtar, soz);
  return soz;
}

/** Veriyi değiştiren işlem çağırır: bu anahtarın saklanan cevabı düşer, sonraki okuma tazesini alır. */
export function istegiUnut(anahtarOnEki: string) {
  for (const a of [...saklananlar.keys()]) {
    if (a === anahtarOnEki || a.startsWith(`${anahtarOnEki}:`)) saklananlar.delete(a);
  }
}
