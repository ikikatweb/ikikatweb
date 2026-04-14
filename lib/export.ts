// PDF ve Excel dışa aktarma yardımcıları
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
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

function trRow(row: string[]): string[] {
  return row.map(trToAscii);
}

const SAYAC_LABEL: Record<string, string> = { km: "KM", saat: "Saat" };
const TIP_LABEL: Record<string, string> = { ozmal: "Ozmal", kiralik: "Kiralik" };

function aracToRow(a: AracWithRelations): string[] {
  return [
    TIP_LABEL[a.tip] ?? a.tip,
    a.plaka,
    a.marka ?? "-",
    a.model ?? "-",
    a.cinsi ?? "-",
    a.yili?.toString() ?? "-",
    a.sayac_tipi ? SAYAC_LABEL[a.sayac_tipi] : "-",
    a.guncel_gosterge?.toLocaleString("tr-TR") ?? "-",
    a.firmalar?.firma_adi ?? a.kiralama_firmasi ?? "-",
    a.santiyeler?.is_adi ?? "-",
    a.hgs_saglayici ?? "-",
    a.motor_no ?? "-",
    a.sase_no ?? "-",
    a.yakit_tipi ?? "-",
    a.son_muayene_tarihi ?? "-",
    a.kiralik_iletisim ?? "-",
  ];
}

const HEADERS = [
  "Tip", "Plaka", "Marka", "Model", "Cinsi", "Yili",
  "Sayac", "Gosterge", "Firma", "Santiye", "HGS",
  "Motor No", "Sase No", "Yakit", "Son Muayene", "Iletisim",
];

export function exportAraclarPDF(araclar: AracWithRelations[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Arac Listesi", 14, 15);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${araclar.length} arac`,
    14, 21
  );

  autoTable(doc, {
    startY: 25,
    head: [HEADERS],
    body: araclar.map((a) => trRow(aracToRow(a))),
    styles: { fontSize: 6, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 95], fontSize: 6 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
  });

  doc.save("arac-listesi.pdf");
}

export function exportAraclarExcel(araclar: AracWithRelations[]) {
  const excelHeaders = [
    "Tip", "Plaka", "Marka", "Model", "Cinsi", "Yılı",
    "Sayaç", "Gösterge", "Firma", "Şantiye", "HGS",
    "Motor No", "Şase No", "Yakıt", "Son Muayene", "İletişim",
  ];
  const rows = araclar.map(aracToRow);
  const ws = XLSX.utils.aoa_to_sheet([excelHeaders, ...rows]);
  ws["!cols"] = excelHeaders.map((h) => ({ wch: Math.max(h.length + 2, 12) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Araclar");
  XLSX.writeFile(wb, "arac-listesi.xlsx");
}
