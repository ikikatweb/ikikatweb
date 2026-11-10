// ESKİ YAKIT KAYITLARINDA YOL MESAFESİNİ DOLDUR.
//
// NİYE: yol mesafesi kayıt anında hesaplanıp saklanıyor (arac_yol_m). Sütunlar
// eklenmeden önce girilmiş kayıtlarda bu alan boş; listede kuşbakışı mesafe
// "~" işaretiyle görünüyor. Bu betik, iki konumu da olan kayıtlar için rotayı
// bir kez sorup yazıyor.
//
// UYDURMAZ: servis cevap vermezse kayıt BOŞ bırakılır (ekran kuşbakışına
// düşmeye devam eder). Zaten dolu olan kayda dokunulmaz.
//
// SERVİSİ YORMAZ: istekler arasında bekleme var; OSRM açık sunucusu ortak
// kullanılan bir kaynak.
//
//   node scripts/yakit-yol-mesafesi-doldur.mjs --kuru   → yalnız göster
//   node scripts/yakit-yol-mesafesi-doldur.mjs          → yaz
import fs from "node:fs";

const kuru = process.argv.includes("--kuru");
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const u = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!u || !key) { console.error("HATA: .env.local okunamadı."); process.exit(1); }
const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const kayitlar = await (await fetch(
  `${u}/rest/v1/arac_yakit?select=id,tarih,saat,konum_lat,konum_lng,arac_lat,arac_lng,arac_mesafe_m`
  + `&konum_lat=not.is.null&arac_lat=not.is.null&arac_yol_m=is.null&order=created_at.desc`, { headers: h })).json();

if (!Array.isArray(kayitlar)) { console.error("HATA:", JSON.stringify(kayitlar).slice(0, 200)); process.exit(1); }
if (kayitlar.length === 0) { console.log("Doldurulacak kayıt yok."); process.exit(0); }
console.log(`${kayitlar.length} kayıt${kuru ? " (KURU ÇALIŞTIRMA)" : ""}:`);

for (const k of kayitlar) {
  let rota = null;
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${k.arac_lng},${k.arac_lat};${k.konum_lng},${k.konum_lat}`
      + `?overview=false&snapping=any`, { signal: AbortSignal.timeout(15000) });
    rota = (await r.json())?.routes?.[0] ?? null;
  } catch { /* aşağıda boş geçilir */ }

  if (!rota) { console.log(` · ${k.tarih} ${k.saat}: rota alınamadı — boş bırakıldı`); await bekle(1200); continue; }
  const m = Math.round(rota.distance), dk = Math.round((rota.duration ?? 0) / 60);
  const kus = k.arac_mesafe_m != null ? ` (kuşbakışı ${(k.arac_mesafe_m / 1000).toFixed(1)} km)` : "";
  console.log(` · ${k.tarih} ${k.saat}: yoldan ${(m / 1000).toFixed(1)} km · ~${dk} dk${kus}`);
  if (!kuru) {
    const p = await fetch(`${u}/rest/v1/arac_yakit?id=eq.${k.id}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({ arac_yol_m: m, arac_yol_dk: dk, arac_yol_kaynak: "osrm" }),
    });
    if (!p.ok) console.error(`   HATA ${p.status}: ${(await p.text()).slice(0, 140)}`);
  }
  await bekle(1200);   // ortak sunucu — arka arkaya yüklenmesin
}
