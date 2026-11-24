// İLÇE → İL TABLOSUNU ÜRET (lib/tr-ilce-il.ts).
//
// NEDEN: İş adında çoğu zaman il yazmıyor, ilçe yazıyor — "Erbaa Myo…", "Zile Myo…",
// "Tokat Niksar İş Merkezi…". Yeni iş formunda il kutusu boş kalıyordu.
//
// VERİ NEREDEN: Elde zaten iki şey var, dışarıdan liste getirilmiyor:
//   • lib/arvento/yerlesim-tr.ts → ilçe adı + koordinat (OpenStreetMap, 05.11.2026)
//   • public/tr-iller.json       → il sınırları (GeoJSON)
// Her yerleşimin koordinatı hangi il sınırının içine düşüyorsa ili odur (nokta-poligon).
//
// AYNI ADLI İLÇELER ELENİR: "Ulubey" hem Ordu'da hem Uşak'ta var; böyle bir ad iş adında
// geçince ili kestirmek tahmin olur. Tahminle doldurmak yanlış ili sessizce yazar —
// o yüzden bu adlar tabloya HİÇ girmez, il kutusu boş kalır ve kullanıcı seçer.
//
// Çalıştırma:  node scripts/ilce-il-uret.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Kaynaklar ────────────────────────────────────────────────────────────────────────────
const yerlesimKaynak = fs.readFileSync(path.join(kok, "lib/arvento/yerlesim-tr.ts"), "utf8");
const yerlesimler = [...yerlesimKaynak.matchAll(/\["([^"]+)",(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([01])\]/g)]
  .map((m) => ({ ad: m[1], lat: Number(m[2]), lng: Number(m[3]), tip: Number(m[4]) }));
if (yerlesimler.length < 500) { console.error("HATA: yerleşim listesi okunamadı."); process.exit(1); }

const geo = JSON.parse(fs.readFileSync(path.join(kok, "public/tr-iller.json"), "utf8"));
const iller = (geo.features ?? []).map((f) => {
  const poligonlar = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  return { ad: f.properties?.name, poligonlar };
}).filter((x) => x.ad);
if (iller.length !== 81) console.warn(`UYARI: ${iller.length} il okundu (81 bekleniyordu).`);

// ── Nokta-poligon (ray casting) — lib/arvento/il-sinir.ts ile aynı yöntem ────────────────
const halkaIcinde = (lng, lat, halka) => {
  let ic = false;
  for (let i = 0, j = halka.length - 1; i < halka.length; j = i++) {
    const xi = halka[i][0], yi = halka[i][1], xj = halka[j][0], yj = halka[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
};
const noktaIlinde = (lat, lng, il) => il.poligonlar.some((pol) => {
  if (!halkaIcinde(lng, lat, pol[0] ?? [])) return false;
  return !pol.slice(1).some((delik) => halkaIcinde(lng, lat, delik));   // delikler (enklav)
});

// lib/tr-il-bul.ts'teki ilNormalize ile AYNI olmalı (orada da aynısı yazılı).
// Düzeltme işaretli harfler (Devrekâni, Hakkâri) sadeleştirilir; yoksa harf tümden
// atılıp "devrekni" gibi bir anahtar çıkıyor ve ilçe hiç bulunamıyordu.
const normalize = (s) => (s || "").toLocaleLowerCase("tr").replace(/i̇/g, "i")
  .replace(/[çğıöşüâîûêô]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", ê: "e", ô: "o" }[c] || c))
  .replace(/[^a-z]/g, "");

// ── Eşleme ───────────────────────────────────────────────────────────────────────────────
const ilAdlari = new Set(iller.map((i) => normalize(i.ad)));
const adaIller = new Map();      // normalize(ilçe) → Set(il adı)
const gercekAd = new Map();      // normalize → özgün yazım (yorum satırı için)
let ilsiz = 0;

for (const y of yerlesimler) {
  const il = iller.find((i) => noktaIlinde(y.lat, y.lng, i));
  if (!il) { ilsiz++; continue; }                       // sınırların dışında kalan nokta
  const n = normalize(y.ad);
  if (!n || ilAdlari.has(n)) continue;                  // il adının kendisi: zaten biliniyor
  if (!adaIller.has(n)) { adaIller.set(n, new Set()); gercekAd.set(n, y.ad); }
  adaIller.get(n).add(il.ad);
}

const tekil = [...adaIller.entries()].filter(([, s]) => s.size === 1)
  .map(([n, s]) => [n, [...s][0], gercekAd.get(n)])
  .sort((a, b) => a[0].localeCompare(b[0]));
const cokAnlamli = [...adaIller.entries()].filter(([, s]) => s.size > 1)
  .map(([n, s]) => `${gercekAd.get(n)} (${[...s].join(", ")})`)
  .sort();

// ── Dosyayı yaz ──────────────────────────────────────────────────────────────────────────
const satirlar = tekil.map(([n, il, ad]) => `  ${n}: "${il}",${" ".repeat(Math.max(1, 18 - n.length))}// ${ad}`);
const icerik = `// İLÇE → İL — iş adında il yazmayıp ilçe yazdığında ili bulmak için.
//
// BU DOSYA ÜRETİLMİŞTİR, elle düzenlemeyin: node scripts/ilce-il-uret.mjs
// Kaynak: lib/arvento/yerlesim-tr.ts (ilçe koordinatları) + public/tr-iller.json (il sınırları).
// Her ilçenin koordinatı hangi il sınırına düşüyorsa ili odur.
//
// Anahtarlar lib/arvento/il-sinir.ts'teki ilNormalize ile aynı biçimdedir
// (küçük harf, Türkçe harfler sadeleştirilmiş, harf dışı karakter yok).
//
// AYNI ADLI İLÇELER TABLOYA GİRMEZ (${cokAnlamli.length} ad): ${cokAnlamli.join(" · ") || "yok"}.
// Bu adlar iş adında geçerse il boş kalır; tahminle doldurmak yanlış ili sessizce yazardı.

export const ILCE_IL: Record<string, string> = {
${satirlar.join("\n")}
};
`;
fs.writeFileSync(path.join(kok, "lib/tr-ilce-il.ts"), icerik, "utf8");

console.log(`Yerleşim: ${yerlesimler.length} (il sınırına düşmeyen: ${ilsiz})`);
console.log(`Tabloya yazılan tekil ilçe: ${tekil.length}`);
console.log(`Elenen aynı adlı ilçe: ${cokAnlamli.length} → ${cokAnlamli.slice(0, 12).join(" · ")}${cokAnlamli.length > 12 ? " …" : ""}`);
for (const ad of ["niksar", "erbaa", "zile", "merzifon", "vezirkopru", "nazilli", "devrekani"]) {
  console.log(`  denetim: ${ad} → ${tekil.find(([n]) => n === ad)?.[1] ?? "(yok)"}`);
}
