// Metin biçimlendirme yardımcıları (Türkçe lokal duyarlı)
//
// İçerik:
//   - formatKisiAdi: Kişi adı (ad soyad). Son kelime BÜYÜK, öncekiler Proper Case.
//                    Örn: "Ahmet Can KILINÇ"
//   - formatBaslik:  Title Case. Her kelimenin ilk harfi büyük, nokta/tire/slash
//                    sonrası ilk harf de büyük. Örn: "Kad-Tem Müh. Müt. İnş."
//   - formatBuyukHarf: Tüm metni Türkçe locale ile büyük harfe çevirir.
//                    Örn: "kad-tem" -> "KAD-TEM"
//   - formatPlaka:   Tüm boşlukları normalleştirir, tüm harfleri büyük yapar.
//                    Örn: "60adr790" -> "60ADR790", "60 adr 790" -> "60 ADR 790"
//   - formatMuhatap: Çok satırlı muhatap bloğu. Her satır title case, son satır
//                    (şehir) tamamen büyük. Örn:
//                    "t.c.\ndevlet su işleri\ntokat" -> "T.C.\nDevlet Su İşleri\nTOKAT"

const TR = "tr-TR";

// Bir karakterin harf olup olmadığını kontrol eder (Türkçe karakterler dahil)
function harfMi(ch: string): boolean {
  return /[a-zA-ZçÇğĞıİöÖşŞüÜ]/.test(ch);
}

/**
 * Tek bir kelimeyi/token'ı "Proper Case" yapar:
 * - İlk harf büyük
 * - Nokta, tire, slash veya & sonrası ilk harf de büyük
 * - Diğer harfler küçük
 *
 * Örnekler:
 *   "müh."     -> "Müh."
 *   "t.c."     -> "T.C."
 *   "kad-tem"  -> "Kad-Tem"
 *   "İNŞ."     -> "İnş."
 */
function properCaseToken(token: string): string {
  if (!token) return "";
  let sonuc = "";
  let yeniSinir = true; // Yeni "kelime başı" mı? (ilk karakter veya ./- sonrası)
  for (const ch of token) {
    if (harfMi(ch)) {
      sonuc += yeniSinir ? ch.toLocaleUpperCase(TR) : ch.toLocaleLowerCase(TR);
      yeniSinir = false;
    } else {
      sonuc += ch;
      // Bu karakterlerden sonra gelen ilk harf büyük olmalı
      if (ch === "." || ch === "-" || ch === "/" || ch === "&") {
        yeniSinir = true;
      }
    }
  }
  return sonuc;
}

/**
 * Kişi adını standart formata dönüştürür.
 * - Tek kelime ise tamamını proper case yapar
 * - Birden fazla kelime varsa son kelime soyad olarak BÜYÜK harfe çevrilir,
 *   önceki tüm kelimeler proper case olur
 * - Birden fazla boşluk tek boşluğa indirilir
 */
export function formatKisiAdi(ad: string | null | undefined): string {
  if (!ad) return "";
  const kelimeler = ad.trim().split(/\s+/).filter(Boolean);
  if (kelimeler.length === 0) return "";
  if (kelimeler.length === 1) return properCaseToken(kelimeler[0]);
  const soyad = kelimeler[kelimeler.length - 1].toLocaleUpperCase(TR);
  const adKisimlari = kelimeler.slice(0, -1).map((k) => properCaseToken(k));
  return [...adKisimlari, soyad].join(" ");
}

/**
 * Cümleyi "Title Case" yapar: her kelimenin ilk harfi büyük.
 * Firma adı, şantiye adı, meslek, görev, marka, model, cins gibi
 * çok kelimeli isimler için kullanılır.
 *
 * Örnekler:
 *   "kad-tem müh. müt. inş."  -> "Kad-Tem Müh. Müt. İnş."
 *   "karabük cevizlidere merkez" -> "Karabük Cevizlidere Merkez"
 *   "ziraat mühendisi yağcı"  -> "Ziraat Mühendisi Yağcı"
 *   "binek beko loder"        -> "Binek Beko Loder"
 */
export function formatBaslik(metin: string | null | undefined): string {
  if (!metin) return "";
  return metin.trim().split(/\s+/).filter(Boolean).map(properCaseToken).join(" ");
}

/**
 * Tüm metni Türkçe locale ile BÜYÜK harfe çevirir.
 * Boşlukları normalleştirir.
 * Firma kısa adı, plaka gibi her zaman büyük olan alanlar için.
 *
 * Örnekler:
 *   "kad-tem" -> "KAD-TEM"
 *   "iki"     -> "İKİ"
 */
export function formatBuyukHarf(metin: string | null | undefined): string {
  if (!metin) return "";
  return metin.trim().replace(/\s+/g, " ").toLocaleUpperCase(TR);
}

/**
 * Plaka formatı: standart Türk plakası ise sayı-harf-sayı gruplarını boşlukla ayırır.
 * İş makinası plakaları (tire içerenler) dokunulmaz.
 *
 * Örnekler:
 *   "60adr790"   -> "60 ADR 790"
 *   "60 adr 790" -> "60 ADR 790"
 *   "06ABC123"   -> "06 ABC 123"
 *   "34-00-2556" -> "34-00-2556" (iş makinası)
 */
export function formatPlaka(metin: string | null | undefined): string {
  if (!metin) return "";
  const temiz = metin.trim().toLocaleUpperCase(TR);
  if (temiz.includes("-")) return temiz;
  const birlesmis = temiz.replace(/\s+/g, "");
  const match = birlesmis.match(/^(\d{2})([A-ZÇĞİÖŞÜ]{1,3})(\d{1,4})$/);
  if (match) return `${match[1]} ${match[2]} ${match[3]}`;
  return temiz.replace(/\s+/g, " ");
}

/**
 * Çok satırlı muhatap bloğunu standart formata dönüştürür:
 * - Her satırın baştaki/sondaki boşlukları temizlenir
 * - Boş satırlar atılır
 * - Önceki satırlar Title Case (T.C., Devlet Su İşleri vb. korunur)
 * - Son satır (şehir) tamamen BÜYÜK harfe çevrilir
 *
 * Örnek:
 *   "t.c.\ndevlet su işleri\ngenel müdürlüğü\ntokat"
 *   -> "T.C.\nDevlet Su İşleri\nGenel Müdürlüğü\nTOKAT"
 */
export function formatMuhatap(metin: string | null | undefined): string {
  if (!metin) return "";
  const satirlar = metin.split("\n").map((s) => s.replace(/[\t ]+/g, " ").trim()).filter(Boolean);
  if (satirlar.length === 0) return "";
  if (satirlar.length === 1) return formatBaslik(satirlar[0]);
  const son = satirlar[satirlar.length - 1].toLocaleUpperCase(TR);
  const oncekiler = satirlar.slice(0, -1).map(formatBaslik);
  return [...oncekiler, son].join("\n");
}
