import fs from "fs";
const f = "C:/ikikatweb-yedek/db/ikikatweb-yedek-2026-08-29_12-00.json";
const j = JSON.parse(fs.readFileSync(f, "utf8"));
const kok = Object.keys(j);
console.log("kok anahtarlar:", kok.slice(0, 6), "...");
const tablolar = j.tablolar ?? j.data ?? j;
const adlar = Object.keys(tablolar).filter(k => k.startsWith("odeme"));
console.log("odeme* tablolari:", adlar);
for (const a of adlar) console.log(`  ${a}: ${Array.isArray(tablolar[a]) ? tablolar[a].length : typeof tablolar[a]} kayit`);
if (Array.isArray(tablolar.odeme_plani_satir) && tablolar.odeme_plani_satir.length) {
  console.log("ornek satir:", JSON.stringify(tablolar.odeme_plani_satir[0]).slice(0, 400));
}
