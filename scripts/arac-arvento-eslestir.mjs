// ARAÇLARI ARVENTO CİHAZLARIYLA EŞLEŞTİR — PLAKADAN.
//
// NİYE: yakıt kaydında konum, aracın o andaki Arvento konumuyla
// karşılaştırılıyor. Karşılaştırma yalnız araçta cihaz TANIMLIYSA yapılabiliyor
// (araclar.arvento_node). 124 araçtan 31'inde tanımlıydı; gerisi için
// karşılaştırma hiç çalışmıyordu.
//
// ══ TAHMİNLE BAĞLAMAZ ══
// Eşleşme yalnız plaka SADELEŞTİRİLMİŞ hâliyle BİREBİR tutuyorsa kurulur
// ("60 AAG 665" = "60AAG665" = "60-AAG-665"). Birden fazla aday varsa ya da
// hiç yoksa kayıt BOŞ BIRAKILIR ve listede "belirsiz" diye raporlanır.
// Yanlış cihaz bağlamak, yakıt kaydına "araç 40 km uzaktaydı" yazdırıp insanı
// haksız yere şüpheli duruma düşürür.
//
// Kuru çalıştırma (hiçbir şey yazmaz):
//   node scripts/arac-arvento-eslestir.mjs --kuru
// Uygula:
//   node scripts/arac-arvento-eslestir.mjs
import fs from "node:fs";

const kuru = process.argv.includes("--kuru");
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const u = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!u || !key) { console.error("HATA: .env.local okunamadı."); process.exit(1); }
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
const al = async (p) => await (await fetch(`${u}/rest/v1/${p}`, { headers: h })).json();

/** Plakayı sadeleştir: boşluk/tire at, Türkçe güvenli büyük harf. */
const sade = (v) => String(v ?? "").toLocaleUpperCase("tr").replace(/[^A-Z0-9]/g, "");

const araclar = await al("araclar?select=id,plaka,arvento_node,durum&order=plaka");
const cihazlar = await al("arvento_cihaz?select=node,plaka,tescil,marka,sinif");
if (!Array.isArray(araclar) || !Array.isArray(cihazlar)) {
  console.error("HATA:", JSON.stringify(araclar).slice(0, 200), JSON.stringify(cihazlar).slice(0, 200));
  process.exit(1);
}

// Cihazları sadeleştirilmiş plaka VE tescil anahtarlarıyla indeksle.
// Aynı anahtara birden fazla cihaz düşerse o anahtar BELİRSİZ sayılır.
const indeks = new Map();   // anahtar -> [cihaz, ...]
for (const c of cihazlar) {
  for (const ham of [c.plaka, c.tescil]) {
    const k = sade(ham);
    if (k.length < 5) continue;                 // "2025 trencher" gibi plaka olmayan kayıtlar
    if (!indeks.has(k)) indeks.set(k, []);
    if (!indeks.get(k).some((x) => x.node === c.node)) indeks.get(k).push(c);
  }
}

const eslesen = [], belirsiz = [], bulunamayan = [], zatenVar = [];
for (const a of araclar) {
  if ((a.arvento_node ?? "").trim()) { zatenVar.push(a); continue; }
  const k = sade(a.plaka);
  const adaylar = indeks.get(k) ?? [];
  if (adaylar.length === 1) eslesen.push({ arac: a, cihaz: adaylar[0] });
  else if (adaylar.length > 1) belirsiz.push({ arac: a, adaylar });
  else bulunamayan.push(a);
}

console.log(`araç: ${araclar.length} · cihaz: ${cihazlar.length}`);
console.log(`zaten tanımlı: ${zatenVar.length} · EŞLEŞEN: ${eslesen.length} · belirsiz: ${belirsiz.length} · eşi yok: ${bulunamayan.length}`);
console.log(kuru ? "\n— KURU ÇALIŞTIRMA, YAZILMAYACAK —" : "");

for (const e of eslesen) {
  console.log(` + ${e.arac.plaka} → ${e.cihaz.node} (${e.cihaz.plaka}${e.cihaz.sinif ? ", " + e.cihaz.sinif : ""})`);
  if (kuru) continue;
  const r = await fetch(`${u}/rest/v1/araclar?id=eq.${e.arac.id}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ arvento_node: e.cihaz.node }),
  });
  if (!r.ok) console.error(`   HATA ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

// BELİRSİZ VE EŞSİZLER SESSİZCE GEÇİLMEZ: hangi araç niye bağlanamadı, görünsün.
for (const b of belirsiz) {
  console.log(` ? ${b.arac.plaka}: ${b.adaylar.length} aday (${b.adaylar.map((x) => x.node).join(", ")}) — elle seçilmeli`);
}
if (bulunamayan.length) {
  console.log(`\nCihazı bulunamayan ${bulunamayan.length} araç:`);
  console.log(bulunamayan.map((a) => `${a.plaka}${a.durum !== "aktif" ? ` (${a.durum})` : ""}`).join(" · "));
}

// Hangi cihazlar hiçbir araca bağlanmadı? (plaka panelde yoksa araç kaydı eksik demektir)
const bagliNodelar = new Set([...zatenVar.map((a) => a.arvento_node), ...eslesen.map((e) => e.cihaz.node)]);
const bostaCihaz = cihazlar.filter((c) => !bagliNodelar.has(c.node));
if (bostaCihaz.length) {
  console.log(`\nHiçbir araca bağlanmayan ${bostaCihaz.length} cihaz:`);
  console.log(bostaCihaz.map((c) => `${c.plaka ?? "?"} [${c.node}]`).join(" · "));
}
