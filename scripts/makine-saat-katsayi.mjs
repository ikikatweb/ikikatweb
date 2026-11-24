// IS MAKINESI SAAT KATSAYISI — gecmis okumalardan cikarilir.
//
// NEDEN: Makine kontaktayken sayaci her zaman saymiyor (rolanti, yuksuz bekleme). Bu yuzden
// "kontak saati" dogrudan sayaca eklenemez; makineye ozel bir katsayi gerekir:
//     gosterge = son okuma + kontak saati x katsayi
// Katsayi bos birakilirsa 1 kabul edilir ve tahmini saat %10-25 YUKSEK cikar.
//
// scripts/arvento-gosterge-kalibre.ts sahada okunmus gosterge degerleri istiyor; bu betik ise
// ZATEN KAYITLI okumalardan (yakit girisindeki saat + bakim kaydindaki saat) ayni orani
// cikarir: iki okuma arasindaki ilerleme / ayni donemde Arvento'nun saydigi kontak saati.
// Esikler lib/arvento/makine-saat.ts:katsayiHesapla ile AYNI (5 saatten kisa donem ve
// 0,2-1,5 araligi disi oranlar elenir; biri yanlis okunmus demektir).
//
// Calistirma:
//   node scripts/makine-saat-katsayi.mjs            → yalniz hesaplar, hicbir sey yazmaz
//   node scripts/makine-saat-katsayi.mjs --uygula   → araclar.saat_katsayi alanina yazar
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync("C:/ikikatweb/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const al = async (y) => (await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${y}`, { headers: h })).json());
const sayfa = async (tablo, kolon) => {
  const out = [];
  for (let o = 0; ; o += 1000) {
    const d = await al(`${tablo}?select=${kolon}&offset=${o}&limit=1000&order=id.asc`);
    out.push(...d);
    if (d.length < 1000) break;
  }
  return out;
};

// lib/arvento/makine-saat.ts:raporCalismaSn ile AYNI kural
function raporCalismaSn(r) {
  let c = Math.max(r.kontak_sn ?? 0, r.rolanti_sn ?? 0);
  const sn = (s) => {
    if (!s) return null;
    const [a, b, d] = String(s).split(":").map(Number);
    return Number.isFinite(a) ? a * 3600 + (b || 0) * 60 + (d || 0) : null;
  };
  const a = sn(r.ilk_kontak), b = sn(r.son_kontak);
  if (a != null && b != null && b - a > 0) c = Math.min(c, b - a);
  return c;
}
const katsayiHesapla = (onceki, yeni, kontakSaat) => {
  if (onceki == null) return null;
  const ilerleme = yeni - onceki;
  if (ilerleme <= 0) return null;
  if (kontakSaat < 5) return null;
  const k = ilerleme / kontakSaat;
  if (k <= 0.2 || k > 1.5) return null;
  return Math.round(k * 1000) / 1000;
};

const makineler = await al("araclar?select=id,plaka,marka,model,guncel_gosterge&sayac_tipi=eq.saat&tip=eq.ozmal");
const yakit = await sayfa("arac_yakit", "arac_id,tarih,km_saat");
const bakim = await sayfa("arac_bakim", "arac_id,bakim_tarihi,km");
const rapor = await sayfa("arac_arvento_rapor", "plaka,rapor_tarihi,kontak_sn,rolanti_sn,ilk_kontak,son_kontak");

const anahtar = (p) => (p ?? "").toLocaleUpperCase("tr").replace(/[^A-Z0-9]/g, "");
const gunMap = new Map();
for (const r of rapor) {
  const k = anahtar(r.plaka);
  if (!gunMap.has(k)) gunMap.set(k, []);
  gunMap.get(k).push(r);
}

console.log("MAKINE          OKUMA  KATSAYI ADAYLARI (ilerleme / kontak saati)");
const sonuc = [];
for (const m of makineler) {
  const okumalar = [
    ...yakit.filter((y) => y.arac_id === m.id && Number(y.km_saat) > 0).map((y) => ({ t: y.tarih, v: Number(y.km_saat), k: "yakıt" })),
    ...bakim.filter((b) => b.arac_id === m.id && Number(b.km) > 0).map((b) => ({ t: b.bakim_tarihi, v: Number(b.km), k: "bakım" })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  // Ayni gunun birden cok okumasindan sonuncusu
  const tekil = [];
  for (const o of okumalar) {
    if (tekil.length && tekil.at(-1).t === o.t) tekil[tekil.length - 1] = o;
    else tekil.push(o);
  }
  if (tekil.length < 2) { console.log(`${m.plaka.padEnd(15)} ${String(tekil.length).padStart(5)}  — yetersiz okuma`); continue; }
  const gunler = gunMap.get(anahtar(m.plaka)) ?? [];
  const adaylar = [];
  for (let i = 1; i < tekil.length; i++) {
    const o = tekil[i - 1], y = tekil[i];
    const saat = gunler.filter((r) => r.rapor_tarihi > o.t && r.rapor_tarihi <= y.t).reduce((t, r) => t + raporCalismaSn(r), 0) / 3600;
    const k = katsayiHesapla(o.v, y.v, saat);
    adaylar.push({ o, y, saat, k, ilerleme: y.v - o.v });
  }
  const gecerli = adaylar.filter((a) => a.k != null);
  console.log(`${m.plaka.padEnd(15)} ${String(tekil.length).padStart(5)}  ${adaylar.map((a) => `${a.o.t}→${a.y.t}: ${a.ilerleme.toFixed(0)}sa / ${a.saat.toFixed(0)}sa = ${a.k ?? "elenen"}`).join("  ·  ")}`);
  if (gecerli.length) {
    const ort = gecerli.reduce((t, a) => t + a.k, 0) / gecerli.length;
    sonuc.push({ plaka: m.plaka, id: m.id, katsayi: Math.round(ort * 1000) / 1000, adet: gecerli.length, sonOkuma: tekil.at(-1) });
  }
}
console.log("\nHESAPLANABILEN KATSAYILAR:");
for (const s of sonuc) console.log(`  ${s.plaka.padEnd(15)} katsayi ${s.katsayi}  (${s.adet} donemden)  son okuma ${s.sonOkuma.t} = ${s.sonOkuma.v} sa (${s.sonOkuma.k})`);
console.log(`\n${sonuc.length}/${makineler.length} makinede katsayi cikarilabildi.`);

// ── Yazma — yalniz --uygula ile ──────────────────────────────────────────────────────────
if (!process.argv.includes("--uygula")) {
  console.log("\n(yalniz hesaplandi; kaydetmek icin --uygula ekleyin)");
} else {
  const yazKafa = { ...h, "Content-Type": "application/json" };
  let yazilan = 0;
  for (const s of sonuc) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/araclar?id=eq.${s.id}`, {
      method: "PATCH", headers: yazKafa,
      body: JSON.stringify({ saat_katsayi: s.katsayi, updated_at: new Date().toISOString() }),
    });
    // Sessiz gecilmez: yazilamayan katsayi, tahminin eski (katsayisiz) hesapla surmesi demek.
    if (!r.ok) { console.error(`  YAZILAMADI ${s.plaka}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`); continue; }
    yazilan++;
  }
  console.log(`\nKaydedilen katsayi: ${yazilan}/${sonuc.length}`);
}
