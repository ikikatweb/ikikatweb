// GEÇİCİ KABUL DİLEKÇESİ — konu metninden yakalama.
//
// Konusunda "geçici kabul" geçen GİDEN evrak, işin geçici kabul başvurusudur. Ayrı bir
// alanda SAKLANMAZ: evrakın kendisinde tarih, yazan kişi ve metin zaten var; kopyalamak
// aynı bilgiyi iki yerde tutmak olurdu. Uyarı doğrudan giden evraktan türetilir.

/**
 * Konuda "geçici kabul" geçiyor mu?
 *
 * Türkçe büyük İ/ı tuzağı: "GEÇİCİ".toLowerCase() beklenen "geçici"yi vermez, bu yüzden
 * karşılaştırma toLocaleUpperCase("tr") üzerinden yapılır ve aksanlar sadeleştirilir —
 * "GEÇİCİ KABUL", "Geçici Kabul", "gecici kabul" hepsi yakalanır.
 */
export function geciciKabulKonusuMu(konu: string | null | undefined): boolean {
  const n = String(konu ?? "")
    .toLocaleUpperCase("tr")
    .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/\s+/g, " ");
  return n.includes("GECICI KABUL");
}
