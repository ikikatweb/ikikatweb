// POLİÇELEŞTİRME TALEBİ MAİLİNİN METNİ
//
// Hem ekrandaki onay penceresi hem de mail gönderen API aynı metni kurar. Ayrı ayrı
// yazılsaydı biri değişince diğeri eski kalır, kullanıcı onayladığından başka bir mail
// giderdi — bu yüzden tek yerde duruyor.

export function paraYaz(v: number): string {
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function policeTalepKonu(plaka: string, tip: "kasko" | "trafik"): string {
  return `${plaka} - ${tip === "kasko" ? "Kasko" : "Trafik Sigortası"} Poliçeleştirme Talebi`;
}

/** Mailin sonundaki BİLGİ NOTU. Gövdenin parçası değil: imzadan sonra, bir punto
 *  küçük ve soluk gider (HTML sürümünde). Düz metin sürümünde de aynı yerde durur
 *  ki onay penceresinde görülen ile acenteye giden ayrışmasın. */
export const ODEME_NOTU = "Ödeme için lütfen 0 533 314 58 15 numaralı telefonla iletişime geçiniz.";

type TalepBilgi = {
  plaka: string;
  acenteAdi: string;
  sigortaFirmasi: string;
  tutar: number;
  gonderen?: string | null;
};

/** Asıl metin — bilgi notu HARİÇ. Not ayrı durduğu için hem ekranda hem mailde
 *  küçük puntoyla gösterilebiliyor. */
export function policeTalepGovde(p: TalepBilgi): string {
  const imza = p.gonderen?.trim() ? `\n${p.gonderen.trim()}` : "";
  return (
    `Sayın ${p.acenteAdi},\n\n` +
    `${p.plaka} plakalı aracımıza ilişkin göndermiş olduğunuz teklifler arasında ` +
    `${p.sigortaFirmasi} ${paraYaz(p.tutar)} TL tutarındaki teklif uygun bulunmuştur. ` +
    `Poliçeyi oluşturup mail yolu ile bize iletmeniz hususunda gereğini rica ederiz.\n\n` +
    `İyi çalışmalar.${imza}`
  );
}

/** Mailin DÜZ METİN sürümü (text:) — bilgi notunu da içerir. */
export function policeTalepMetin(p: TalepBilgi): string {
  return `${policeTalepGovde(p)}\n\nNot: ${ODEME_NOTU}`;
}

const htmlKacis = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Mailin HTML gövdesi (antet hariç). Bilgi notu 0,88 em — gövdeden yaklaşık iki
 *  punto küçük — ve soluk gri. */
export function policeTalepHtml(p: TalepBilgi): string {
  return (
    `<p>${htmlKacis(policeTalepGovde(p)).replace(/\n/g, "<br>")}</p>` +
    `<p style="margin-top:16px;font-size:0.88em;color:#555;">Not: ${htmlKacis(ODEME_NOTU)}</p>`
  );
}
