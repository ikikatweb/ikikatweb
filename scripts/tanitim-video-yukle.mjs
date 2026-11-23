// TANITIM VİDEOLARINI KOVAYA YÜKLE.
//
// Kaynak klasörde sayfa videoları ve rota eşleşmesini veren sayfalar.json bulunur:
//   { "/dashboard/yakit": { "dosya": "yakit.mp4", ... }, ... }
// Dosya adları uygulamanın beklediği adlarla aynı OLMAYABİLİR; eşleşme ROTA üzerinden
// kurulur: sayfalar.json'daki rota → lib/tanitim/sayfalar.ts'teki slug → tanitim/<slug>.mp4
//
// TAHMİNLE YÜKLEMEZ: rotası tabloda olmayan dosya atlanır ve listelenir; videosu olmayan
// ekranlar da ayrıca listelenir. Hiçbir hata yutulmaz, sonunda özet basılır.
//
//   node scripts/tanitim-video-yukle.mjs "C:\\Users\\...\\sayfa-videolari"
import fs from "node:fs";
import path from "node:path";

const kaynak = process.argv[2];
if (!kaynak || !fs.existsSync(kaynak)) {
  console.error("KULLANIM: node scripts/tanitim-video-yukle.mjs <video-klasoru>");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const u = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!u || !key) { console.error("HATA: .env.local okunamadi."); process.exit(1); }

// Uygulamanin rota->slug tablosu (tek kaynak: lib/tanitim/sayfalar.ts).
const tsKaynak = fs.readFileSync(new URL("../lib/tanitim/sayfalar.ts", import.meta.url), "utf8");
const rotaSlug = new Map();
for (const m of tsKaynak.matchAll(/\{\s*yol:\s*"([^"]+)",\s*slug:\s*"([^"]+)"/g)) rotaSlug.set(m[1], m[2]);
if (rotaSlug.size === 0) { console.error("HATA: sayfalar.ts'ten slug tablosu cikarilamadi."); process.exit(1); }

const esleme = JSON.parse(fs.readFileSync(path.join(kaynak, "sayfalar.json"), "utf8"));

const yuklenen = [], atlanan = [], hatali = [];

for (const [rota, bilgi] of Object.entries(esleme)) {
  const slug = rotaSlug.get(rota);
  const dosyaYolu = path.join(kaynak, bilgi.dosya);
  if (!slug) { atlanan.push(`${bilgi.dosya} -> rota tabloda yok: ${rota}`); continue; }
  if (!fs.existsSync(dosyaYolu)) { atlanan.push(`${bilgi.dosya} -> dosya bulunamadi`); continue; }

  const uzanti = path.extname(bilgi.dosya).slice(1).toLowerCase();
  const hedef = `${slug}.${uzanti}`;
  const govde = fs.readFileSync(dosyaYolu);
  const tur = uzanti === "webm" ? "video/webm" : uzanti === "mov" ? "video/quicktime" : "video/mp4";

  const y = await fetch(`${u}/storage/v1/object/tanitim/${hedef}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": tur, "x-upsert": "true" },
    body: govde,
  });
  if (!y.ok) {
    hatali.push(`${hedef} -> HTTP ${y.status} ${(await y.text()).slice(0, 160)}`);
    continue;
  }
  const mb = (govde.length / 1048576).toFixed(1);
  console.log(`  ${hedef.padEnd(34)} ${mb.padStart(5)} MB   (${bilgi.dosya})`);
  yuklenen.push(hedef);
}

// Videosu olmayan ekranlar: kullanici hangi ekranin eksik kaldigini bilsin.
const kapsanan = new Set(Object.keys(esleme));
const eksik = [...rotaSlug.entries()].filter(([rota]) => !kapsanan.has(rota)).map(([, s]) => s);

console.log(`\nYuklenen: ${yuklenen.length}`);
if (atlanan.length) console.log(`Atlanan (${atlanan.length}):\n  ` + atlanan.join("\n  "));
if (hatali.length) console.log(`HATALI (${hatali.length}):\n  ` + hatali.join("\n  "));
if (eksik.length) console.log(`Videosu olmayan ekranlar (${eksik.length}): ${eksik.join(", ")}`);
if (hatali.length) process.exit(1);
