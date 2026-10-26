// MUHATAP YAZIMI — "her kelimenin ilk harfi büyük, gerisi küçük".
//
// Kullanıcılar muhatabı bazen tamamen büyük yazıyor ("VAKIFLAR BÖLGE MÜDÜRLÜĞÜ'NE"),
// bazen düzgün; evraklar arasında görünüm tutarsız kalıyordu.
//
// Türkçe büyük/küçük tuzağı: "I".toLowerCase() → "i" YANLIŞ (doğrusu "ı"),
// "İ".toLowerCase() → nokta ayrışır. Bu yüzden her yerde locale'li dönüşüm kullanılır.
//
// İki istisna var, ikisi de gerçek veriden:
//  1) NOKTADAN SONRA BÜYÜK → "T.C.", "A.Ş." bozulmaz. Düz başlık yazımı bunları
//     "T.c." yapardı.
//  2) ŞEHİR SATIRI DOKUNULMAZ → resmî yazı düzeninde şehir son satırda ve BÜYÜK
//     yazılır (SAMSUN, ANKARA, ESKİŞEHİR). Kayıtların çoğu böyle; küçültmek
//     mevcut evraklarla tutarsızlık yaratırdı.

const buyuk = (s: string) => s.toLocaleUpperCase("tr");
const kucuk = (s: string) => s.toLocaleLowerCase("tr");

/** Tek kelimeyi biçimler: ilk harf ve NOKTADAN SONRAKİ her harf büyük, gerisi küçük. */
function kelimeBicim(kelime: string): string {
  let sonuc = "";
  let basaGel = true;   // sıradaki harf büyük olmalı mı?
  for (const ch of kelime) {
    if (basaGel && /\p{L}/u.test(ch)) {
      sonuc += buyuk(ch);
      basaGel = false;
    } else {
      sonuc += kucuk(ch);
    }
    if (ch === ".") basaGel = true;   // "T.C." → C de büyük
  }
  return sonuc;
}

/** Metin tamamen BÜYÜK harflerden mi oluşuyor? */
function tamamiBuyukMu(metin: string): boolean {
  const harfler = metin.replace(/[^\p{L}]/gu, "");
  return harfler.length > 0 && harfler === buyuk(harfler);
}

/** Kısa ve tamamı büyük kelime = KISALTMA (CK, DSİ, MYO, ASM). Satırın geri kalanı
 *  normal yazılmışsa kullanıcı bunu bilerek büyük yazmıştır, bozulmaz.
 *  Satırın TAMAMI büyükse bu ayrım yapılamaz (orada "VE" de büyüktür) → uygulanmaz. */
function kisaltmaMi(kelime: string): boolean {
  const harfler = kelime.replace(/[^\p{L}]/gu, "");
  return harfler.length > 0 && harfler.length <= 4 && harfler === buyuk(harfler);
}

/**
 * Muhatap metnini biçimler. Satır satır çalışır; SON satır tamamen büyükse
 * (şehir) olduğu gibi bırakılır.
 */
export function muhatapBicimle(ham: string | null | undefined): string {
  const metin = String(ham ?? "");
  if (!metin.trim()) return metin;
  const satirlar = metin.split("\n");
  const sonDolu = (() => {
    for (let i = satirlar.length - 1; i >= 0; i--) if (satirlar[i].trim()) return i;
    return -1;
  })();
  return satirlar
    .map((satir, i) => {
      // ŞEHİR SATIRI: son satır, TEK kelime ve tamamı büyük → dokunma (SAMSUN, ANKARA).
      // Tek kelime şartı önemli: "İLGİLİ MAKAMA" da tamamı büyük ama şehir değil,
      // düzeltilmesi gerekiyor.
      const tekKelime = satir.trim().split(/\s+/).length === 1;
      if (i === sonDolu && tekKelime && tamamiBuyukMu(satir)) return satir;
      // Satırın tamamı büyükse kullanıcı caps ile yazmış demektir; kısaltma ayrımı
      // yapılamaz, hepsi başlık yazımına çevrilir.
      const satirTamamiBuyuk = tamamiBuyukMu(satir);
      return satir.replace(/\S+/g, (k) =>
        (!satirTamamiBuyuk && kisaltmaMi(k)) ? k : kelimeBicim(k));
    })
    .join("\n");
}
