// SAYAÇ OKUMASI GİR — plakayı ve değeri yaz, aracın göstergesi güncellensin.
//
// Neden var: 18 kamyonda hiç kilometre, 13 iş makinesinde hiç saat okuması yoktu; Yakıt
// Denetleme bu araçlarda hiçbir şey hesaplayamıyor. Okumalar toplu halde (elde liste, telefonda
// fotoğraf) geldiğinde tek tek ekrandan girmek yerine buradan işlenir.
//
// Aracın güncel göstergesi yazılır; o güne ait puantaj satırı varsa GÜN BAZLI okumaya da
// işlenir (arac_puantaj.gosterge) — denetim böylece iki yakıt dolumu arasına sıkışmaz.
//
// Çalıştırma:
//   node scripts/gosterge-gir.mjs "60 ACN 701" 138892
//   node scripts/gosterge-gir.mjs "60 ACN 701" 138892 --tarih 2026-09-18
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const arg = process.argv.slice(2);
const plakaArg = arg[0];
const deger = Number(String(arg[1] ?? "").replace(/[^\d.]/g, ""));
const ti = arg.indexOf("--tarih");
const tarih = ti >= 0 ? arg[ti + 1] : new Date().toISOString().slice(0, 10);

if (!plakaArg || !Number.isFinite(deger) || deger <= 0) {
  console.log('Kullanım: node scripts/gosterge-gir.mjs "60 ACN 701" 138892 [--tarih 2026-09-18]');
  process.exit(1);
}

const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const { data: hepsi } = await sb.from("araclar").select("id, plaka, sayac_tipi, guncel_gosterge");
const arac = (hepsi ?? []).find((a) => norm(a.plaka) === norm(plakaArg));
if (!arac) { console.log(`Araç bulunamadı: ${plakaArg}`); process.exit(1); }

const birim = arac.sayac_tipi === "saat" ? "saat" : "km";
const onceki = arac.guncel_gosterge;

// Sayaç geriye gitmez: düşük değer yazım hatasıdır ya da sayaç değişmiştir — yazmadan sor.
if (onceki != null && deger < Number(onceki)) {
  console.log(`DİKKAT: ${arac.plaka} göstergesi ${Number(onceki).toLocaleString("tr-TR")} ${birim} idi,`
    + ` girilen ${deger.toLocaleString("tr-TR")} ${birim} bundan DÜŞÜK. Yazılmadı.`);
  console.log("Sayaç değiştiyse ya da eski bir okumaysa --tarih ile geçmişe yazın veya ekrandan girin.");
  process.exit(1);
}

await sb.from("araclar").update({ guncel_gosterge: deger, updated_at: new Date().toISOString() }).eq("id", arac.id);

const { data: pu } = await sb.from("arac_puantaj").select("id").eq("arac_id", arac.id).eq("tarih", tarih);
const gunYazildi = !!pu?.length;
if (gunYazildi) await sb.from("arac_puantaj").update({ gosterge: deger }).eq("id", pu[0].id);

console.log(`${arac.plaka}: ${onceki == null ? "boş" : Number(onceki).toLocaleString("tr-TR")}`
  + ` → ${deger.toLocaleString("tr-TR")} ${birim}`
  + (gunYazildi ? ` (${tarih} puantajına da yazıldı)` : ` (${tarih} için puantaj satırı yok)`));
