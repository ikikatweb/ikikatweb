// GEÇİCİ KABUL DİLEKÇESİ — konu metninden yakalama.
//
// Konusunda "geçici kabul" geçen GİDEN evrak, işin geçici kabul başvurusudur. Ayrı bir
// alanda SAKLANMAZ: evrakın kendisinde tarih, yazan kişi ve metin zaten var.

/** Türkçe harfleri sadeleştirip büyütür. toLowerCase KULLANILMAZ: "GEÇİCİ".toLowerCase()
 *  beklenen "geçici"yi vermez (İ → i + birleşen nokta). */
function trNorm(x: string): string {
  return x.toLocaleUpperCase("tr")
    .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/Â/g, "A").replace(/Î/g, "I").replace(/Û/g, "U")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein uzaklığı — yazım hatasına tolerans için. */
function uzaklik(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return Math.max(m, n);
  let onceki = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const simdi = [i, ...new Array(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      simdi[j] = Math.min(
        onceki[j] + 1,                                   // silme
        simdi[j - 1] + 1,                                // ekleme
        onceki[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), // değiştirme
      );
    }
    onceki = simdi;
  }
  return onceki[n];
}

const HEDEF = "GECICI";
// 6 harflik kelimede 2 hata toleransı: "GECCI", "GECIC", "GEICI" yakalanır.
// "KESIN"in uzaklığı 4, "KESİN KABUL" yanlışlıkla yakalanmaz.
const TOLERANS = 2;

/**
 * Konuda "geçici kabul" geçiyor mu? Yazım hatalarına toleranslı.
 *
 * Yalnız aksan/büyük-küçük farkı yetmiyor: kullanıcı "gecici", "gecıcı" yazabildiği gibi
 * "geccı kabul" gibi gerçek harf hatası da yapabiliyor. Bu yüzden "KABUL" kelimesi
 * aranır ve ONDAN ÖNCEKİ kelime "GECICI"ye yeterince yakınsa eşleşme sayılır.
 *
 * "KESİN KABUL" bilerek eşleşmez: uzaklığı 4, toleransın dışında.
 */
export function geciciKabulKonusuMu(konu: string | null | undefined): boolean {
  const n = trNorm(String(konu ?? ""));
  if (!n) return false;
  const kelimeler = n.split(/[^A-Z0-9]+/).filter(Boolean);
  for (let i = 1; i < kelimeler.length; i++) {
    // "KABUL", "KABULU", "KABULUNUN" gibi çekimli hâlleri de kapsasın.
    if (!kelimeler[i].startsWith("KABUL")) continue;
    const onceki = kelimeler[i - 1];
    // Çok kısa kelimeyle (ör. "IL") yanlış eşleşme olmasın.
    if (onceki.length < 4) continue;
    if (uzaklik(onceki, HEDEF) <= TOLERANS) return true;
  }
  return false;
}
