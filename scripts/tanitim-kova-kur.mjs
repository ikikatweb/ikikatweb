// TANITIM VİDEOLARI KOVASI — bir kerelik kurulum.
//
// "Sayfayı Tanı" penceresi videoları Supabase Storage'daki ÖZEL `tanitim` kovasından okur
// (bkz. lib/tanitim/sayfalar.ts, app/api/tanitim-video/route.ts). Bu betik kovayı oluşturur.
// Kova zaten varsa dokunmaz, "zaten var" der.
//
//   node scripts/tanitim-kova-kur.mjs
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const u = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!u || !key) { console.error("HATA: .env.local okunamadi."); process.exit(1); }

const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const mevcut = await (await fetch(`${u}/storage/v1/bucket`, { headers: h })).json();
if (Array.isArray(mevcut) && mevcut.some((k) => k.id === "tanitim")) {
  const k = mevcut.find((x) => x.id === "tanitim");
  console.log(`Kova zaten var: tanitim (public=${k.public}, boyut siniri=${k.file_size_limit ?? "yok"})`);
  process.exit(0);
}

const y = await fetch(`${u}/storage/v1/bucket`, {
  method: "POST",
  headers: h,
  // ÖZEL kova: videolar yalnız oturumlu kullanıcıya imzalı adresle verilir.
  // Boyut siniri VERILMEZ → projenin genel siniri gecerli olur (su an 50 MB).
  // Daha buyuk video gerekirse proje ayarlarindaki genel sinir yukseltilmeli.
  body: JSON.stringify({ id: "tanitim", name: "tanitim", public: false }),
});
const sonuc = await y.json().catch(() => null);
if (!y.ok) { console.error("HATA: kova olusturulamadi ->", y.status, JSON.stringify(sonuc)); process.exit(1); }
console.log("Kova olusturuldu: tanitim (ozel, projenin genel boyut siniriyla)");
