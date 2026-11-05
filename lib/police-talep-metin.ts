// POLİÇELEŞTİRME TALEBİ MAİLİNİN METNİ
//
// Hem ekrandaki onay penceresi hem de mail gönderen API aynı metni kurar. Ayrı ayrı
// yazılsaydı biri değişince diğeri eski kalır, kullanıcı onayladığından başka bir mail
// giderdi — bu yüzden tek yerde duruyor.
//
// METİN ARTIK TANIMLAMALARDAN GELİYOR: Tanımlamalar → "Poliçeleştirme Mail Metni"
// kartından düzenlenir (kategoriler aşağıda). Kayıt yoksa buradaki varsayılan kullanılır.
// Şablon, metni kuran üç fonksiyona ZORUNLU parametre olarak verilir; böylece bir çağıran
// taraf veritabanını okumayı atlarsa TypeScript hatası alır — önizlemenin mailden
// ayrışması derlemede yakalanır.

/** Mail gövdesi (yer tutuculu). Tek satır kayıt. */
export const POLICE_TALEP_KATEGORI = "police_talep_metni";
/** İmzanın altındaki küçük puntolu bilgi notu. Tek satır kayıt. */
export const POLICE_TALEP_NOT_KATEGORI = "police_talep_notu";

export const POLICE_TALEP_VARSAYILAN =
  "Sayın {acente},\n\n" +
  "{plaka} plakalı aracımıza ilişkin göndermiş olduğunuz {tip} teklifleri arasında " +
  "{firma} {tutar} TL tutarındaki teklif uygun bulunmuştur. " +
  "Poliçeyi oluşturup mail yolu ile bize iletmeniz hususunda gereğini rica ederiz.\n\n" +
  "İyi çalışmalar.\n{gonderen}";

export const ODEME_NOTU_VARSAYILAN =
  "Ödeme için lütfen 0 533 314 58 15 numaralı telefonla iletişime geçiniz.";

/** Mail metninde kullanılabilecek yer tutucular (Tanımlamalar kartındaki denetim bunu kullanır). */
export const POLICE_TALEP_YER_TUTUCULAR = ["acente", "plaka", "firma", "tutar", "tip", "gonderen"];

export type PoliceTalepSablon = {
  /** Mail gövdesi — yer tutucular doldurulmadan. */
  govde: string;
  /** Bilgi notu. BOŞ olabilir: kullanıcı notu kaldırmak isterse not satırı hiç gitmez. */
  not: string;
};

export const POLICE_TALEP_SABLON_VARSAYILAN: PoliceTalepSablon = {
  govde: POLICE_TALEP_VARSAYILAN,
  not: ODEME_NOTU_VARSAYILAN,
};

/**
 * Tanımlama satırlarından şablonu çözer. Hem istemci (önizleme) hem sunucu (mail) bunu
 * kullanır — iki yerde ayrı ayrı okunsaydı biri varsayılana düşüp öbürü düşmeyebilirdi.
 *
 * Kayıt YOKSA varsayılan; kayıt VARSA ne yazıyorsa o. Gövde boş bırakılmışsa varsayılana
 * dönülür (boş mail göndermek anlamsız), not boş bırakılmışsa boş kalır (kasıtlı olabilir).
 */
export function policeTalepSablonCoz(
  satirlar: { kategori: string; deger: string | null }[] | null | undefined,
): PoliceTalepSablon {
  const bul = (kat: string) => (satirlar ?? []).find((s) => s.kategori === kat)?.deger;
  const govde = (bul(POLICE_TALEP_KATEGORI) ?? "").trim();
  const not = bul(POLICE_TALEP_NOT_KATEGORI);
  return {
    govde: govde || POLICE_TALEP_VARSAYILAN,
    not: not === undefined || not === null ? ODEME_NOTU_VARSAYILAN : not.trim(),
  };
}

export function paraYaz(v: number): string {
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function policeTalepKonu(plaka: string, tip: "kasko" | "trafik"): string {
  return `${plaka} - ${tip === "kasko" ? "Kasko" : "Trafik Sigortası"} Poliçeleştirme Talebi`;
}

type TalepBilgi = {
  plaka: string;
  acenteAdi: string;
  sigortaFirmasi: string;
  tutar: number;
  /** Poliçe tipi — {tip} yer tutucusunda "kasko" / "trafik sigortası" olarak yazılır. */
  tip: "kasko" | "trafik";
  gonderen?: string | null;
};

/** Yer tutucuları doldur. {gonderen} yazılmamışsa imza metnin sonuna eklenir (eski davranış). */
function doldur(sablon: string, p: TalepBilgi): string {
  const imza = p.gonderen?.trim() ?? "";
  let s = sablon
    .replace(/\{acente\}/g, p.acenteAdi)
    .replace(/\{plaka\}/g, p.plaka)
    .replace(/\{firma\}/g, p.sigortaFirmasi)
    .replace(/\{tip\}/g, p.tip === "kasko" ? "kasko" : "trafik sigortası")
    .replace(/\{tutar\}/g, paraYaz(p.tutar));
  if (s.includes("{gonderen}")) {
    // Gönderen yoksa yer tutucunun bulunduğu satır tümden kalkar (boş imza satırı kalmasın).
    s = imza ? s.replace(/\{gonderen\}/g, imza) : s.replace(/\n?[ \t]*\{gonderen\}[ \t]*/g, "");
  } else if (imza) {
    s = `${s}\n${imza}`;
  }
  return s;
}

/** Asıl metin — bilgi notu HARİÇ. Not ayrı durduğu için hem ekranda hem mailde
 *  küçük puntoyla gösterilebiliyor. */
export function policeTalepGovde(p: TalepBilgi, sablon: PoliceTalepSablon): string {
  return doldur(sablon.govde, p);
}

/** Mailin DÜZ METİN sürümü (text:) — bilgi notunu da içerir. */
export function policeTalepMetin(p: TalepBilgi, sablon: PoliceTalepSablon): string {
  const govde = policeTalepGovde(p, sablon);
  const not = sablon.not.trim();
  return not ? `${govde}\n\nNot: ${not}` : govde;
}

const htmlKacis = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Mailin HTML gövdesi (antet hariç). Bilgi notu 0,88 em — gövdeden yaklaşık iki
 *  punto küçük — ve soluk gri. */
export function policeTalepHtml(p: TalepBilgi, sablon: PoliceTalepSablon): string {
  const not = sablon.not.trim();
  return (
    `<p>${htmlKacis(policeTalepGovde(p, sablon)).replace(/\n/g, "<br>")}</p>` +
    (not ? `<p style="margin-top:16px;font-size:0.88em;color:#555;">Not: ${htmlKacis(not)}</p>` : "")
  );
}
