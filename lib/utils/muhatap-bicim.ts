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

/** 81 il. Metnin sonundaki şehir adını BÜYÜK yazmak için — "son kelimeyi büyüt"
 *  demek şehir olmayan sonları da bozardı, bu yüzden liste ile kesin ayrım. */
const ILLER = new Set([
  "ADANA","ADIYAMAN","AFYONKARAHISAR","AGRI","AKSARAY","AMASYA","ANKARA","ANTALYA","ARDAHAN",
  "ARTVIN","AYDIN","BALIKESIR","BARTIN","BATMAN","BAYBURT","BILECIK","BINGOL","BITLIS","BOLU",
  "BURDUR","BURSA","CANAKKALE","CANKIRI","CORUM","DENIZLI","DIYARBAKIR","DUZCE","EDIRNE",
  "ELAZIG","ERZINCAN","ERZURUM","ESKISEHIR","GAZIANTEP","GIRESUN","GUMUSHANE","HAKKARI","HATAY",
  "IGDIR","ISPARTA","ISTANBUL","IZMIR","KAHRAMANMARAS","KARABUK","KARAMAN","KARS","KASTAMONU",
  "KAYSERI","KILIS","KIRIKKALE","KIRKLARELI","KIRSEHIR","KOCAELI","KONYA","KUTAHYA","MALATYA",
  "MANISA","MARDIN","MERSIN","MUGLA","MUS","NEVSEHIR","NIGDE","ORDU","OSMANIYE","RIZE","SAKARYA",
  "SAMSUN","SANLIURFA","SIIRT","SINOP","SIRNAK","SIVAS","TEKIRDAG","TOKAT","TRABZON","TUNCELI",
  "USAK","VAN","YALOVA","YOZGAT","ZONGULDAK",
]);

/** Türkçe harfleri sadeleştirip büyütür — il karşılaştırması için. */
function ilAnahtar(k: string): string {
  return buyuk(k).replace(/[^\p{L}]/gu, "")
    .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C");
}

const ilMi = (kelime: string) => ILLER.has(ilAnahtar(kelime));

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
      // Satırın tamamı büyükse kullanıcı caps ile yazmış demektir; kısaltma ayrımı
      // yapılamaz (orada "VE" de büyüktür), hepsi başlık yazımına çevrilir.
      const satirTamamiBuyuk = tamamiBuyukMu(satir);
      const bicimli = satir.replace(/\S+/g, (k) =>
        (!satirTamamiBuyuk && kisaltmaMi(k)) ? k : kelimeBicim(k));
      if (i !== sonDolu) return bicimli;
      // METNİN EN SONUNDAKİ KELİME İL İSE BÜYÜK YAZILIR — kendi satırında olsun ya da
      // olmasın; "Müdürlüğü'ne TOKAT" ile son satırı SAMSUN olan yazı aynı kurala tabi.
      return bicimli.replace(/(\S+)(\s*)$/, (tam, sonKelime, bosluk) =>
        ilMi(sonKelime) ? buyuk(sonKelime) + bosluk : tam);
    })
    .join("\n");
}
