// Arvento SpeedReport → YOĞUN ROTA senkronu. SpeedReport (yetkili) her GPS okumasını verir
// (LATITUDE, LONGITUDE, Date/Time, Speed, Odometer) — greyder başına günde binlerce nokta. Seyrek
// e-posta/export rotasının aksine reglaj omurgası (≥N geçiş → tek çizgi) bu yoğun veriyle düzgün çalışır.
//
// İZİN: Arvento WS IP-kısıtlı → kullanıcının (izinli) makinesinde çalışır.
// EN GÜNCEL ROTA: Görev Zamanlayıcı ile gün içinde her ~15 dk çalıştır → BUGÜNÜN o ana kadarki TAM yoğun
// izini yazar (idempotent → düşüş olmaz, hep güncel). anlik sync yalnız canlı konum yazar (rota buradan).
// Kullanım:  node scripts/arvento-speed-sync.mjs [gunSayisi]     (varsayılan 1 = SADECE bugün; 2 = bugün+dün ...)
//            node scripts/arvento-speed-sync.mjs 2026-06-20 2026-06-25   (geçmiş tarih aralığı — backfill)
// .env.local: ARVENTO_WS_USERNAME/PIN1/PIN2, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const xe = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const WS = "https://ws.arvento.com/v1/report.asmx";
const DECIM_M = 14;       // nokta seyreltme: ≥14 m uzaksa tut. Omurga hücresi 2×gridM (~28 m) olduğu için
                         // 14 m noktalar omurgayı BOZMAZ (hücre içinde kalır) ama veriyi ~1.75× küçültür →
                         // geniş aralık daha hızlı yüklenir. Tek-gün/kısa aralık doğruluğu korunur.
const SICRAMA_M = 50000;  // 50 km+ ardışık sıçrama = çöp GPS, km'ye katma
const BEKLE_MS = 350;     // WS rate-limit: çağrılar arası bekleme

const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

function mesafeM(la1, ln1, la2, ln2) {
  const R = 111320, cosL = Math.max(0.1, Math.cos(((la1 + la2) / 2) * Math.PI / 180));
  return Math.hypot((ln2 - ln1) * R * cosL, (la2 - la1) * R);
}
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function fetchTimeout(url, opts, ms = 60000) {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(id); }
}

// Bir araç-gün için SpeedReport çek → ham nokta listesi (zaman sıralı, seyreltilmiş).
async function aracGun(node, gunIso) {
  const g = gunIso.replace(/-/g, "");
  const P = { Username: get("ARVENTO_WS_USERNAME"), PIN1: get("ARVENTO_WS_PIN1"), PIN2: get("ARVENTO_WS_PIN2"),
    Node: node, StartDate: `${g}000000`, EndDate: `${g}235959`, Group: "", Locale: "", MinuteDif: "180", Language: "1033", Compress: "0" };
  const inner = Object.entries(P).map(([k, v]) => `<${k}>${xe(v)}</${k}>`).join("");
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><SpeedReport xmlns="http://www.arvento.com/">${inner}</SpeedReport></soap:Body></soap:Envelope>`;
  const r = await fetchTimeout(WS, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://www.arvento.com/SpeedReport" }, body });
  const t = await r.text();
  if (/yetkiniz yoktur|Access denied/i.test(t)) throw new Error("SpeedReport yetkisiz/erişim reddedildi (IP?)");
  // <Table1> satırlarını ayrıştır
  const ham = [];
  const al = (blok, tag) => { const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(blok); return m ? m[1] : null; };
  for (const m of t.matchAll(/<Table1\b[^>]*>([\s\S]*?)<\/Table1>/g)) {
    const blok = m[1];
    const lat = parseFloat(al(blok, "LATITUDE")), lng = parseFloat(al(blok, "LONGITUDE"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const dt = al(blok, "Date_x002F_Time") || "";          // 2026-06-24T00:01:29+03:00
    const saat = (dt.split("T")[1] || "").slice(0, 8) || null;
    const hiz = parseFloat(al(blok, "Speed_x0020_km_x002F_h")); const odo = parseFloat(al(blok, "Odometer"));
    ham.push({ lat, lng, saat, hiz: Number.isFinite(hiz) ? hiz : null, odo: Number.isFinite(odo) ? odo : null });
  }
  ham.sort((a, b) => (a.saat || "").localeCompare(b.saat || ""));
  // seyreltme: son tutulandan ≥ DECIM_M uzaksa tut
  const noktalar = [];
  for (const p of ham) {
    const son = noktalar[noktalar.length - 1];
    if (son && mesafeM(son.lat, son.lng, p.lat, p.lng) < DECIM_M) continue;
    noktalar.push(p);
  }
  return noktalar;
}

(async () => {
  const args = process.argv.slice(2);
  // tarih aralığı belirle
  const gunler = [];
  if (args.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(args[0])) {
    const b = new Date(args[0] + "T12:00:00"), s = new Date(args[1] + "T12:00:00");
    for (let d = new Date(b); d <= s; d.setDate(d.getDate() + 1)) gunler.push(iso(new Date(d)));
  } else {
    const n = Math.max(1, parseInt(args[0] || "1", 10)); // kaç gün (varsayılan 1 = SADECE bugün)
    for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); gunler.push(iso(d)); }
  }
  console.log(`SpeedReport senkron — günler: ${gunler.join(", ")}`);

  // cihaz listesi (node → plaka/marka/model/sinif)
  const { data: cihazlar, error: cErr } = await sb.from("arvento_cihaz").select("node, plaka, marka, model, sinif");
  if (cErr) { console.error("Cihaz listesi alınamadı:", cErr.message); process.exit(1); }
  const liste = (cihazlar || []).filter((c) => c.node && c.plaka);
  console.log(`${liste.length} cihaz × ${gunler.length} gün = ${liste.length * gunler.length} çağrı`);

  let yazilan = 0, hata = 0, toplamNokta = 0;
  for (const gun of gunler) {
    for (const c of liste) {
      try {
        const noktalar = await aracGun(c.node, gun);
        await bekle(BEKLE_MS);
        if (noktalar.length < 2) continue;
        // polyline km (çöp sıçramalar hariç)
        let m = 0;
        for (let i = 1; i < noktalar.length; i++) { const s = mesafeM(noktalar[i - 1].lat, noktalar[i - 1].lng, noktalar[i].lat, noktalar[i].lng); if (s <= SICRAMA_M) m += s; }
        const row = { rapor_tarihi: gun, plaka: c.plaka, arac_sinifi: c.sinif || null, marka: c.marka || null, model: c.model || null,
          toplam_mesafe: Math.round((m / 1000) * 100) / 100, nokta_sayisi: noktalar.length, noktalar };
        const { error } = await sb.from("arac_arvento_guzergah").upsert(row, { onConflict: "rapor_tarihi,plaka" });
        if (error) { console.error(`  ${gun} ${c.plaka}: yazma hatası ${error.message}`); hata++; continue; }
        yazilan++; toplamNokta += noktalar.length;
        console.log(`  ${gun} ${c.plaka}: ${noktalar.length} nokta, ${row.toplam_mesafe} km`);
      } catch (e) {
        hata++; console.error(`  ${gun} ${c.node}: ${e instanceof Error ? e.message : String(e)}`);
        await bekle(BEKLE_MS);
      }
    }
  }
  console.log(`\nBitti: ${yazilan} araç-gün yazıldı, ${toplamNokta} nokta, ${hata} hata.`);

  // ÖZET WARMING: senkronlanan günlerin stabilize özetini CANLIDA önceden hesaplat (önbelleğe yaz). Böylece
  // kullanıcı stabilize'yi açınca BUGÜN de önbellekten gelir (canlı yeniden-hesap ~1,5s beklenmez). Sync'i
  // bozmaz (hata yoksayılır). API en fazla 45 günü işler; geniş backfill'de son 45 gün ısınır.
  try {
    const bas = gunler[0], bitis = gunler[gunler.length - 1];
    const r = await fetchTimeout(`https://ikikat.net/api/arvento/stabilize-ozet?bas=${bas}&bitis=${bitis}&force=1`, {}, 120000);
    console.log(`Özet warming (${bas} → ${bitis}): HTTP ${r.status}`);
  } catch (e) {
    console.error(`Özet warming hatası (yoksayıldı): ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(0);
})();
