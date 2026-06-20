// Arvento ANLIK konum senkronu — Arvento web servisinin IZINLI olduğu bir makinede
// (şirket ağı / Türkiye IP'si) çalışır, GetVehicleStatusV3 ile anlık konumları çekip
// Supabase'deki `arvento_anlik` tablosuna yazar. Web sitesi (Vercel) bu tablodan okur,
// böylece Arvento'nun Vercel IP'sini engellemesi sorun olmaktan çıkar.
//
// Çalıştırma (proje klasöründe):
//   node scripts/arvento-anlik-sync.mjs           → bir kez çek-yaz (Zamanlanmış Görev için)
//   node scripts/arvento-anlik-sync.mjs --loop    → her 60 sn'de bir sürekli (test/elle)
//
// Gerekli .env.local anahtarları: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   ARVENTO_WS_USERNAME, ARVENTO_WS_PIN1, ARVENTO_WS_PIN2, ARVENTO_WS_LANG (varsayılan tr)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(__dirname, "..");

// .env.local'i process.env'e yükle (zaten tanımlıysa üzerine yazma)
function envYukle() {
  for (const dosya of [".env.local", ".env"]) {
    const p = path.join(kok, dosya);
    if (!fs.existsSync(p)) continue;
    for (const satir of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const i = satir.indexOf("=");
      if (i < 0 || satir.trim().startsWith("#")) continue;
      const k = satir.slice(0, i).trim();
      const v = satir.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}
envYukle();

const WS_URL = "https://ws.arvento.com/v1/report.asmx";
const xe = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sayi = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };

// --- Bugünün güzergahını anlık konumlardan biriktirme yardımcıları ---
const R_METRE = 111320;
function mesafeM(la1, lo1, la2, lo2) {
  const cosL = Math.max(0.1, Math.cos(((la1 + la2) / 2) * Math.PI / 180));
  return Math.hypot((lo2 - lo1) * R_METRE * cosL, (la2 - la1) * R_METRE);
}
function trBugun() {
  const n = new Date();
  const tr = new Date(n.getTime() + (3 * 60 - n.getTimezoneOffset()) * 60000);
  return tr.toISOString().slice(0, 10);
}
const saatAl = (t) => { const m = String(t || "").match(/\d{2}:\d{2}:\d{2}/); return m ? m[0] : null; };

// Bellek: --loop modunda gün boyu birikir; one-shot'ta her çalıştırmada DB'den yüklenir.
let rotaBellek = new Map(); // plaka -> noktalar[]
let rotaGun = null;
let cihazCache = null, cihazZaman = 0;

async function cihazlariYukle(sb) {
  if (cihazCache && Date.now() - cihazZaman < 600000) return cihazCache; // 10 dk önbellek
  const { data } = await sb.from("arvento_cihaz").select("node, plaka, sinif, marka, model");
  const m = new Map();
  for (const c of (data || [])) if (c.node) m.set(c.node.trim(), c);
  cihazCache = m; cihazZaman = Date.now();
  return m;
}

// Anlık konumları bugünün güzergahına (arac_arvento_guzergah) işler. Hareket eden araçlarda
// son noktadan >12 m uzaklaşınca yeni nokta eklenir (duranlarda nokta birikmez).
async function rotaBirik(sb, konumlar) {
  const gun = trBugun();
  const cihaz = await cihazlariYukle(sb);
  if (rotaGun !== gun) { // gün değişti → belleği sıfırla, bugünü DB'den yükle
    rotaBellek = new Map(); rotaGun = gun;
    const plakalar = [...new Set([...cihaz.values()].map((c) => c.plaka).filter(Boolean))];
    if (plakalar.length) {
      const { data } = await sb.from("arac_arvento_guzergah").select("plaka, noktalar").eq("rapor_tarihi", gun).in("plaka", plakalar);
      for (const r of (data || [])) rotaBellek.set(r.plaka, Array.isArray(r.noktalar) ? r.noktalar : []);
    }
  }
  const yaz = [];
  for (const k of konumlar) {
    if (k.lat == null || k.lng == null) continue;
    const c = cihaz.get((k.node || "").trim());
    if (!c || !c.plaka) continue;
    const noktalar = rotaBellek.get(c.plaka) || [];
    const son = noktalar[noktalar.length - 1];
    if (son && mesafeM(son.lat, son.lng, k.lat, k.lng) <= 12) continue; // hareket yok → ekleme
    noktalar.push({ lat: k.lat, lng: k.lng, saat: saatAl(k.tarih), hiz: k.hiz });
    rotaBellek.set(c.plaka, noktalar);
    let km = 0;
    for (let i = 1; i < noktalar.length; i++) km += mesafeM(noktalar[i - 1].lat, noktalar[i - 1].lng, noktalar[i].lat, noktalar[i].lng);
    yaz.push({ rapor_tarihi: gun, plaka: c.plaka, arac_sinifi: c.sinif || null, marka: c.marka || null, model: c.model || null, toplam_mesafe: Math.round(km / 1000 * 100) / 100, nokta_sayisi: noktalar.length, noktalar });
  }
  if (yaz.length) {
    const { error } = await sb.from("arac_arvento_guzergah").upsert(yaz, { onConflict: "rapor_tarihi,plaka" });
    if (error) throw new Error(`Rota yazma hatası: ${error.message}`);
  }
  return yaz.length;
}

async function cekAnlik() {
  const user = process.env.ARVENTO_WS_USERNAME, pin1 = process.env.ARVENTO_WS_PIN1,
        pin2 = process.env.ARVENTO_WS_PIN2, lang = process.env.ARVENTO_WS_LANG || "tr";
  if (!user || !pin1 || !pin2) throw new Error("Arvento WS bilgileri eksik (.env.local: ARVENTO_WS_USERNAME/PIN1/PIN2)");
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetVehicleStatusV3 xmlns="http://www.arvento.com/"><Username>${xe(user)}</Username><PIN1>${xe(pin1)}</PIN1><PIN2>${xe(pin2)}</PIN2><Language>${xe(lang)}</Language></GetVehicleStatusV3></soap:Body></soap:Envelope>`;
  const r = await fetch(WS_URL, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://www.arvento.com/GetVehicleStatusV3" }, body });
  const t = await r.text();
  if (!r.ok) throw new Error(`Arvento HTTP ${r.status}`);
  const fault = t.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  if (fault) throw new Error(`Arvento: ${fault[1]}`);
  const m = t.match(/<GetVehicleStatusV3Result>([\s\S]*?)<\/GetVehicleStatusV3Result>/i);
  const inner = (m ? m[1] : "").trim();
  if (/access denied/i.test(inner)) throw new Error("Access denied — bu makinenin IP'si Arvento web servisinde İZİNLİ DEĞİL. Senkronu izinli ağdaki (şirket) bir makinede çalıştırın.");
  const out = [];
  for (const blok of inner.match(/<LastPacket\b[\s\S]*?<\/LastPacket>/gi) ?? []) {
    const h = {};
    for (const mm of blok.matchAll(/<([A-Za-z0-9_]+)\s*\/>/g)) h[mm[1].toLowerCase()] = "";
    for (const mm of blok.matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)) h[mm[1].toLowerCase()] = mm[2].trim();
    const node = h.strnode || "";
    if (!node) continue;
    out.push({
      node,
      lat: sayi(h.dlatitude), lng: sayi(h.dlongitude),
      hiz: sayi(h.dspeed), yon: sayi(h.ncourse),
      tarih: h.dtlocaldatetime || h.dtgmtdatetime || null,
      adres: h.straddress || null,
      guncelleme: new Date().toISOString(),
    });
  }
  return out;
}

async function birKez() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase bilgileri eksik (.env.local: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  const sb = createClient(url, key);
  const satirlar = await cekAnlik();
  if (satirlar.length === 0) { console.log(new Date().toLocaleTimeString(), "→ konum gelmedi (boş)"); return; }
  const { error } = await sb.from("arvento_anlik").upsert(satirlar, { onConflict: "node" });
  if (error) throw new Error(`Supabase yazma hatası: ${error.message}`);
  // Anlık konumları bugünün güzergahına da işle (Reglaj/Serme/Sıkıştırma/Tümü haritaları okur)
  let rotaSayi = 0;
  try { rotaSayi = await rotaBirik(sb, satirlar); } catch (e) { console.error("  rota uyarı:", e.message); }
  console.log(new Date().toLocaleTimeString(), `→ ${satirlar.length} araç konumu yazıldı, ${rotaSayi} araç rotası güncellendi.`);
}

const loop = process.argv.includes("--loop");
const ARALIK_SN = parseInt(process.env.ARVENTO_ANLIK_ARALIK_SN || "60", 10);
if (loop) {
  console.log(`Sürekli mod: her ${ARALIK_SN} sn. Durdurmak için Ctrl+C.`);
  for (;;) {
    try { await birKez(); } catch (e) { console.error(new Date().toLocaleTimeString(), "HATA:", e.message); }
    await new Promise((r) => setTimeout(r, ARALIK_SN * 1000));
  }
} else {
  let kod = 0;
  try { await birKez(); }
  catch (e) { console.error("HATA:", e.message); kod = 1; }
  // Açık kalan HTTP soketlerinin kapanması için kısa bekleme, sonra temiz çık
  // (Windows'ta process.exit'i hemen çağırınca libuv "Assertion failed" verebiliyor).
  setTimeout(() => process.exit(kod), 300);
}
