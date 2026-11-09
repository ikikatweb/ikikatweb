// SQL DOSYASINI SUPABASE'DE ÇALIŞTIRIR — Management API üzerinden.
//
// NİYE GEREKLİ: servis anahtarı (PostgREST) DDL çalıştıramaz; "create table",
// "alter table" gibi şema işleri yalnız bu yoldan yapılabiliyor. Jeton
// .env.local içindeki SUPABASE_ACCESS_TOKEN (Supabase kişisel erişim jetonu).
//
// DİKKAT — CANLI VERİTABANI: bu betik şemayı gerçekten değiştirir. Yıkıcı ifade
// (drop / truncate / delete / alter ... drop column) içeren dosyalarda ÇALIŞMAZ,
// --zorla verilmedikçe. Kullanıcıya sormadan yıkıcı bir şey çalıştırmayın.
//
// Çalıştırma:
//   node scripts/sql-calistir.mjs sql/<dosya>.sql
//   node scripts/sql-calistir.mjs sql/<dosya>.sql --kuru   → yalnız göster, çalıştırma
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const dosya = process.argv[2];
const KURU = process.argv.includes("--kuru");
const ZORLA = process.argv.includes("--zorla");
if (!dosya) { console.error("Kullanım: node scripts/sql-calistir.mjs sql/<dosya>.sql [--kuru]"); process.exitCode = 1; }
else {
  const sql = fs.readFileSync(path.join(kok, dosya), "utf8");
  // Yorum satırları çıkarılarak bakılır: açıklamada geçen "drop" kelimesi engellemesin.
  const govde = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  const yikici = /\b(drop\s+(table|column|schema|database)|truncate|delete\s+from)\b/i.exec(govde);
  if (yikici && !ZORLA) {
    console.error(`DURDURULDU: dosyada yıkıcı ifade var ("${yikici[0]}").`);
    console.error("Kullanıcıya sorun; bilerek isteniyorsa --zorla ekleyin.");
    process.exitCode = 1;
  } else {
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    console.log(`proje: ${ref} · dosya: ${dosya}${KURU ? " · --kuru" : ""}`);
    if (KURU) {
      console.log(govde.trim());
    } else {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      const cevap = (await r.text()).slice(0, 500);
      console.log(`HTTP ${r.status} ${cevap}`);
      if (!r.ok) process.exitCode = 1;
    }
  }
}
