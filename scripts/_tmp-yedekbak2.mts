import fs from "fs";
const j = JSON.parse(fs.readFileSync("C:/ikikatweb-yedek/db/ikikatweb-yedek-2026-08-29_12-00.json", "utf8"));
const v = j.veriler;
const adlar = Object.keys(v);
console.log("toplam tablo:", adlar.length);
console.log("odeme* :", adlar.filter(a => a.includes("odeme")));
for (const a of adlar.filter(x => x.includes("odeme"))) console.log(`  ${a}: ${Array.isArray(v[a]) ? v[a].length : typeof v[a]}`);
if (Array.isArray(v.odeme_plani_satir) && v.odeme_plani_satir.length) console.log("ornek:", JSON.stringify(v.odeme_plani_satir[0]).slice(0,500));
console.log("meta:", JSON.stringify(j.meta).slice(0, 600));
