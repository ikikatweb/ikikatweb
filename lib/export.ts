// PDF ve Excel dışa aktarma yardımcıları
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
// xlsx-js-style: standart xlsx cell-style desteklemediği için
// Excel'de firma renk dolgu yapabilmek için kullanılır.
import * as XLSXStyle from "xlsx-js-style";
import type { AracWithRelations } from "@/lib/supabase/types";

// Türkçe karakterleri ASCII'ye dönüştür (jsPDF helvetica fontu Türkçe desteklemez)
function trToAscii(str: string): string {
  return str
    .replace(/ğ/g, "g").replace(/Ğ/g, "G")
    .replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S")
    .replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C")
    .replace(/ı/g, "i").replace(/İ/g, "I")
    .replace(/—/g, "-");
}

const SAYAC_LABEL: Record<string, string> = { km: "KM", saat: "Saat" };

// Bir aracın "firma" anahtarı: özmal ise firmalar.firma_adi,
// kiralık ise kiralama_firmasi. Hiçbiri yoksa "Diğer".
function aracFirmaAd(a: AracWithRelations): string {
  if (a.firmalar?.firma_adi) return a.firmalar.firma_adi;
  if (a.kiralama_firmasi) return a.kiralama_firmasi;
  return "Diğer";
}

// Sıralama anahtarı: özmal firmalar (sira_no'su olan) önce, kiralık firmalar sonra.
// Aynı sira_no grubunda alfabetik.
function aracFirmaSira(a: AracWithRelations): number {
  if (a.firmalar?.sira_no != null) return a.firmalar.sira_no;
  // Kiralık (sira_no yok) → çok büyük sayı ile en sona
  return Number.MAX_SAFE_INTEGER;
}

// Hex renkten RGB'ye çevir (jsPDF için)
function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const num = parseInt(m[1], 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Bir rengin koyu mu açık mı olduğunu tespit et (kontrast için metin rengi seçimi)
function isLightColor(rgb: [number, number, number]): boolean {
  // Luminance hesabı (basit) — 0.5'ten büyükse açık
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.6;
}

// Araçları firma bazlı grupla. Sıra: firma sira_no → kiralık firmalar (alfabetik)
function gruplaFirmaBazli(araclar: AracWithRelations[]): { firmaAd: string; renk: string | null; araclar: AracWithRelations[] }[] {
  const map = new Map<string, { firmaAd: string; sira: number; renk: string | null; araclar: AracWithRelations[] }>();
  for (const a of araclar) {
    const ad = aracFirmaAd(a);
    if (!map.has(ad)) {
      map.set(ad, {
        firmaAd: ad,
        sira: aracFirmaSira(a),
        renk: a.firmalar?.renk ?? null,
        araclar: [],
      });
    }
    map.get(ad)!.araclar.push(a);
  }
  const liste = Array.from(map.values()).sort((a, b) => {
    if (a.sira !== b.sira) return a.sira - b.sira;
    return a.firmaAd.localeCompare(b.firmaAd, "tr");
  });
  for (const g of liste) {
    g.araclar.sort((x, y) => {
      const c = (x.cinsi ?? "").localeCompare(y.cinsi ?? "", "tr");
      if (c !== 0) return c;
      const y1 = y.yili ?? 0; const y2 = x.yili ?? 0;
      if (y1 !== y2) return y1 - y2;
      return x.plaka.localeCompare(y.plaka, "tr");
    });
  }
  return liste.map(({ firmaAd, renk, araclar }) => ({ firmaAd, renk, araclar }));
}

// Yeni sütun düzeni (kullanıcı talebine göre):
// Marka, Model, Plaka, Cinsi, Yılı, Araç Değeri, Sayaç, Gösterge,
// HGS, Motor No, Şase No, Yakıt, Son Muayene, İletişim
const HEADERS_TR = [
  "Marka", "Model", "Plaka", "Cinsi", "Yılı", "Araç Değeri",
  "Sayaç", "Gösterge", "HGS", "Motor No", "Şase No",
  "Yakıt", "Son Muayene", "İletişim",
];

const HEADERS_ASCII = HEADERS_TR.map(trToAscii);

function aracRow(a: AracWithRelations): string[] {
  return [
    a.marka ?? "-",
    a.model ?? "-",
    a.plaka,
    a.cinsi ?? "-",
    a.yili?.toString() ?? "-",
    a.arac_degeri != null && a.arac_degeri > 0
      ? `${a.arac_degeri.toLocaleString("tr-TR")} TL`
      : "-",
    a.sayac_tipi ? SAYAC_LABEL[a.sayac_tipi] : "-",
    a.guncel_gosterge?.toLocaleString("tr-TR") ?? "-",
    a.hgs_saglayici ?? "-",
    a.motor_no ?? "-",
    a.sase_no ?? "-",
    a.yakit_tipi ?? "-",
    a.son_muayene_tarihi ?? "-",
    a.kiralik_iletisim ?? "-",
  ];
}

export function exportAraclarPDF(araclar: AracWithRelations[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Arac Listesi", 14, 15);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${araclar.length} arac`,
    14, 21,
  );

  const grupli = gruplaFirmaBazli(araclar);

  // Firma başlığı + araçlar şeklinde flat body — autoTable spanning kullanılır
  type Cell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const body: (Cell[] | string[])[] = [];
  for (const grup of grupli) {
    // Firma renk dolgusu — yoksa default koyu mavi. Renk açıksa metin koyu olur.
    const rgb = hexToRgb(grup.renk) ?? [30, 58, 95];
    const aciksaKoyu = isLightColor(rgb);
    body.push([
      {
        content: trToAscii(grup.firmaAd),
        colSpan: HEADERS_ASCII.length,
        styles: {
          fillColor: rgb,
          textColor: aciksaKoyu ? [30, 41, 59] : [255, 255, 255],
          fontStyle: "bold",
          halign: "left",
          fontSize: 7,
        },
      },
    ]);
    for (const a of grup.araclar) {
      body.push(aracRow(a).map(trToAscii));
    }
  }

  autoTable(doc, {
    startY: 25,
    head: [HEADERS_ASCII],
    body,
    styles: { fontSize: 6, cellPadding: 1.2 },
    headStyles: { fillColor: [30, 58, 95], fontSize: 6 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
  });

  doc.save("arac-listesi.pdf");
}

export function exportAraclarExcel(araclar: AracWithRelations[]) {
  const grupli = gruplaFirmaBazli(araclar);

  const aoa: (string | number | null)[][] = [HEADERS_TR];
  // Firma başlık satır indeksi + rengi (xlsx-js-style ile stil uygulamak için)
  const firmaBaslikSatirlari: { row: number; renk: string | null }[] = [];

  let satirIdx = 1;
  for (const grup of grupli) {
    const baslikRow: string[] = new Array(HEADERS_TR.length).fill("");
    baslikRow[0] = grup.firmaAd;
    aoa.push(baslikRow);
    firmaBaslikSatirlari.push({ row: satirIdx, renk: grup.renk });
    satirIdx++;
    for (const a of grup.araclar) {
      aoa.push(aracRow(a));
      satirIdx++;
    }
  }

  // xlsx-js-style üzerinden sheet oluştur (cell-level stil destekler)
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  ws["!cols"] = HEADERS_TR.map((h) => ({ wch: Math.max(h.length + 2, 14) }));

  // Firma başlık satırlarını birleştir + renk dolgusu uygula
  ws["!merges"] = ws["!merges"] || [];
  for (const { row, renk } of firmaBaslikSatirlari) {
    ws["!merges"].push({
      s: { r: row, c: 0 },
      e: { r: row, c: HEADERS_TR.length - 1 },
    });
    // Renk dolgusu — yoksa default koyu mavi. Açık renkte koyu yazı.
    const hex = (renk ?? "#1E3A5F").replace("#", "");
    const rgb = hexToRgb(`#${hex}`) ?? [30, 58, 95];
    const yaziRengi = isLightColor(rgb) ? "1E293B" : "FFFFFF";
    // Sadece ilk hücreye stil uygula (birleştirilmiş hücrede ilk hücre stilini yansıtır)
    const cellRef = XLSXStyle.utils.encode_cell({ r: row, c: 0 });
    ws[cellRef] = ws[cellRef] || { v: "" };
    ws[cellRef].s = {
      fill: { patternType: "solid", fgColor: { rgb: hex.toUpperCase() } },
      font: { bold: true, color: { rgb: yaziRengi }, sz: 11 },
      alignment: { horizontal: "left", vertical: "center" },
    };
  }

  // Tablo başlık satırına da stil ver (koyu mavi)
  for (let c = 0; c < HEADERS_TR.length; c++) {
    const ref = XLSXStyle.utils.encode_cell({ r: 0, c });
    if (ws[ref]) {
      ws[ref].s = {
        fill: { patternType: "solid", fgColor: { rgb: "1E3A5F" } },
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }
  }

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Araclar");
  XLSXStyle.writeFile(wb, "arac-listesi.xlsx");
}
