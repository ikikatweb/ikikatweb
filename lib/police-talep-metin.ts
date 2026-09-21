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

export function policeTalepMetin(p: {
  plaka: string;
  acenteAdi: string;
  sigortaFirmasi: string;
  tutar: number;
  gonderen?: string | null;
}): string {
  const imza = p.gonderen?.trim() ? `\n${p.gonderen.trim()}` : "";
  return (
    `Sayın ${p.acenteAdi},\n\n` +
    `${p.plaka} plakalı aracımıza ilişkin göndermiş olduğunuz teklifte ` +
    `${p.sigortaFirmasi} ${paraYaz(p.tutar)} TL teklif uygun görülmüştür, ` +
    `poliçeleştirmeniz hususunda gereğini rica ederiz.\n\n` +
    `İyi çalışmalar.${imza}`
  );
}
