import XLSX from "xlsx";
const wb = XLSX.readFile("scripts/_tmp-genel.xlsx");
const ws = wb.Sheets["Genel Rapor"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const veri = rows.slice(3).filter(r => r[0] !== "" && r[2]); // Kayıt No + Plaka olan
console.log(`Veri satırı: ${veri.length}`);
let koordVar=0, koordYok=0, turFarkli=0;
const turler={}, plakaSay={};
const anahtarlar = new Set(); let mukerrerCift=0;
for (const r of veri) {
  const [kno, cihaz, plaka, sur, tarih, kaynak, tur, acik, deger, yuk, birim, enlem, boylam] = r;
  turler[tur] = (turler[tur]||0)+1;
  plakaSay[String(plaka).trim()] = (plakaSay[String(plaka).trim()]||0)+1;
  if (enlem!=="" && boylam!=="" && enlem!=null) koordVar++; else koordYok++;
  if (!/damper/i.test(String(tur))) turFarkli++;
  const key = `${String(plaka).trim()}|${tarih}`;
  if (anahtarlar.has(key)) mukerrerCift++; else anahtarlar.add(key);
}
console.log("Tür dağılımı:", JSON.stringify(turler));
console.log(`Koordinatlı: ${koordVar} · Koordinatsız: ${koordYok}`);
console.log(`Damper olmayan tür: ${turFarkli}`);
console.log(`Aynı plaka+tarih tekrarı (satır içi): ${mukerrerCift} · benzersiz: ${anahtarlar.size}`);
console.log("Plaka başına:", JSON.stringify(plakaSay));
