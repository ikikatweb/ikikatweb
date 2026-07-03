import XLSX from "xlsx";
const wb = XLSX.readFile("scripts/_tmp-genel.xlsx");
console.log("Sheetler:", wb.SheetNames.join(", "));
for (const sn of wb.SheetNames) {
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  console.log(`\n=== Sheet "${sn}": ${rows.length} satır ===`);
  // İlk 3 satır (başlık bulmak için)
  for (let i = 0; i < Math.min(4, rows.length); i++) console.log(`  [${i}]`, JSON.stringify(rows[i]).slice(0, 300));
  // Kolon başlıklarını bulmaya çalış (Plaka/Tarih/Alarm geçen satır)
  const hi = rows.findIndex(r => r.some(c => /plaka|tarih|alarm|damper|enlem|boylam|lat|konum/i.test(String(c))));
  console.log(`  başlık satırı index: ${hi}`);
  if (hi >= 0) { console.log("  başlık:", JSON.stringify(rows[hi])); console.log(`  veri satırı ~: ${rows.length - hi - 1}`); }
}
