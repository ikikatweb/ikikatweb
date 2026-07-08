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

// Kontak (ignition) durumu — Arvento'nun canlı metodu (GetVehicleStatusV3) kontak alanı GÖNDERMEZ.
// Bu yüzden PROXY: son paket tazeliği. Kontak açıkken cihaz sık (saniyede bir) paket gönderir; kontak
// kapanınca gönderim kesilir → son paket eskir. Son paket KONTAK_TAZE_DK dakikadan yeniyse "açık", aksi
// halde "kapalı". GMT zamanı (dtgmtdatetime, UTC) kullanılır → makine saat diliminden bağımsız doğru.
const KONTAK_TAZE_DK = 5;
const kontakTazelik = (h) => {
  const g = h.dtgmtdatetime;
  if (!g) return null;
  const ms = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(g) ? g : g + "Z"); // UTC olarak ayrıştır
  if (!Number.isFinite(ms)) return null;
  return (Date.now() - ms) / 60000 < KONTAK_TAZE_DK; // taze=açık(true), eski=kapalı(false)
};

// Zaman aşımlı fetch — Arvento yanıt vermezse ~20 sn'de iptal eder (ASILI KALMAYI önler).
// Aksi halde tek bir takılı istek tüm senkronu (ve görevi) sonsuza dek dondurabilir.
async function fetchTimeout(url, opts, ms = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

// --- Bugünün güzergahını anlık konumlardan biriktirme yardımcıları ---
const R_METRE = 111320;
function mesafeM(la1, lo1, la2, lo2) {
  const cosL = Math.max(0.1, Math.cos(((la1 + la2) / 2) * Math.PI / 180));
  return Math.hypot((lo2 - lo1) * R_METRE * cosL, (la2 - la1) * R_METRE);
}
function trBugun() {
  const n = new Date();
  const tr = new Date(n.getTime() + 3 * 3600000); // TR = UTC+3: mutlak epoch'a +3 saat (makine saat dilimine bağımsız → 21:00'de güne atlamaz)
  return tr.toISOString().slice(0, 10);
}
const saatAl = (t) => { const m = String(t || "").match(/\d{2}:\d{2}:\d{2}/); return m ? m[0] : null; };

// Bellek: --loop modunda gün boyu birikir; one-shot'ta her çalıştırmada DB'den yüklenir.
let rotaBellek = new Map(); // plaka -> noktalar[]
let rotaGun = null;
let cihazCache = null, cihazZaman = 0;

async function cihazlariYukle(sb) {
  if (cihazCache && Date.now() - cihazZaman < 600000) return cihazCache; // 10 dk önbellek
  const { data } = await sb.from("arvento_cihaz").select("node, plaka, sinif, marka, model, surucu");
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
  const yazRota = [];
  for (const k of konumlar) {
    if (k.lat == null || k.lng == null) continue;
    const c = cihaz.get((k.node || "").trim());
    if (!c || !c.plaka) continue;
    const noktalar = rotaBellek.get(c.plaka) || [];
    const son = noktalar[noktalar.length - 1];
    if (son && mesafeM(son.lat, son.lng, k.lat, k.lng) <= 12) continue; // hareket yok → ekleme
    noktalar.push({ lat: k.lat, lng: k.lng, saat: saatAl(k.tarih), hiz: k.hiz, odo: k.odo });
    rotaBellek.set(c.plaka, noktalar);
    // Rota toplam mesafe (polyline). ÇÖP GPS koruması: 50 km+ ardışık sıçramalar (hatalı GPS okuması
    // — ör. araç bir an 731 km öteye "ışınlanıyor") km'ye KATILMAZ, yoksa toplam mesafe şişer.
    let polyKm = 0;
    for (let i = 1; i < noktalar.length; i++) {
      const seg = mesafeM(noktalar[i - 1].lat, noktalar[i - 1].lng, noktalar[i].lat, noktalar[i].lng);
      if (seg > 50000) continue; // 50 km+ sıçrama → çöp segment, atla
      polyKm += seg;
    }
    polyKm = polyKm / 1000;
    // Günlük km: odometre delta (ilk↔son nokta odometresi) daha doğru; yoksa polyline
    const ilkOdo = noktalar.find((p) => p.odo != null)?.odo;
    const sonOdo = [...noktalar].reverse().find((p) => p.odo != null)?.odo;
    const odoKm = (ilkOdo != null && sonOdo != null) ? Math.max(0, sonOdo - ilkOdo) : 0;
    // Odometre gerçek mesafe; gecikirse GPS polyline'ı kullan → ikisinin büyüğü
    const mesafeKm = Math.round(Math.max(odoKm, polyKm) * 100) / 100;
    // NOT: Araç Çalışma metriklerini (km full-day, kontak açık, rölanti, hareket) API'den
    // DOĞRU üretemiyoruz (ignition yok + senkron gün ortasında başlayabilir + rapor metotları
    // Arvento'da bozuk). Bu yüzden arac_arvento_rapor'a YAZMIYORUZ — yanlış sayı göstermektense
    // boş bırakıp gerçek değeri mail/Excel "Araç Çalışma Raporu"ndan alıyoruz. Sadece ROTA + konum.
    void mesafeKm;
    yazRota.push({ rapor_tarihi: gun, plaka: c.plaka, arac_sinifi: c.sinif || null, marka: c.marka || null, model: c.model || null, toplam_mesafe: Math.round(polyKm * 100) / 100, nokta_sayisi: noktalar.length, noktalar });
  }
  if (yazRota.length) {
    const { error } = await sb.from("arac_arvento_guzergah").upsert(yazRota, { onConflict: "rapor_tarihi,plaka" });
    if (error) throw new Error(`Rota yazma hatası: ${error.message}`);
  }
  return yazRota.length;
}

// --- EKSKAVATÖR çalışma noktaları: yerinde çalışan makineler iz bırakmadığı için, kontak açıkken
// Tanımlamalar'daki "Ekskavatör Nokta Sıklığı" (ekskavator_nokta_dk) aralığında bir konum kaydedilir. ---
let ekskCache = null; // { plakalar:Set, aralikDk, sonZaman:Map<plaka,ms>, gun, yuklendi }
async function ekskYukle(sb) {
  const gun = trBugun();
  if (ekskCache && ekskCache.gun === gun && Date.now() - ekskCache.yuklendi < 600000) return ekskCache; // 10 dk önbellek (plaka listesi + aralık)
  const [{ data: ar }, { data: ay }] = await Promise.all([
    sb.from("araclar").select("plaka, cinsi"),
    sb.from("arvento_ayarlar").select("ekskavator_nokta_dk").eq("id", "global").maybeSingle(),
  ]);
  const plakalar = new Set((ar || []).filter((a) => /(ekskavat|eskavat)/i.test(a.cinsi || "")).map((a) => a.plaka).filter(Boolean));
  const aralikDk = Math.max(1, ay?.ekskavator_nokta_dk ?? 10);
  // Bugün GERÇEK kapanış (son_kontak) kaydı olan ekskavatörler → kontak proxy'si (heartbeat) yanılsa da DURUYORSA
  // nokta yazma (öğle molası noktaları birikmesin). Her cache turunda (10 dk) tazelenir.
  const kapali = new Set();
  if (plakalar.size) {
    const { data: rap } = await sb.from("arac_arvento_rapor").select("plaka, son_kontak").eq("rapor_tarihi", gun).in("plaka", [...plakalar]);
    for (const r of (rap || [])) if (r.son_kontak) kapali.add(r.plaka);
  }
  // Son nokta zamanlarını (bugün) koru; gün değiştiyse veya ilk yüklemede DB'den doldur.
  const sonZaman = (ekskCache && ekskCache.gun === gun) ? ekskCache.sonZaman : new Map();
  if (sonZaman.size === 0 && plakalar.size) {
    const { data: pts } = await sb.from("makine_calisma_noktasi").select("plaka, created_at").eq("rapor_tarihi", gun).in("plaka", [...plakalar]);
    for (const p of (pts || [])) { const ms = Date.parse(p.created_at); const ex = sonZaman.get(p.plaka) || 0; if (ms > ex) sonZaman.set(p.plaka, ms); }
  }
  ekskCache = { plakalar, aralikDk, kapali, sonZaman, gun, yuklendi: Date.now() };
  return ekskCache;
}
async function ekskNoktaBirik(sb, konumlar) {
  const c = await ekskYukle(sb);
  if (!c.plakalar.size) return 0;
  const cihaz = await cihazlariYukle(sb);
  const now = Date.now(), aralikMs = c.aralikDk * 60000, gun = trBugun();
  const yaz = [];
  for (const k of konumlar) {
    if (k.lat == null || k.lng == null || !k.kontak) continue;          // kontak KAPALI (çalışmıyor) → nokta yok
    const plaka = cihaz.get((k.node || "").trim())?.plaka;
    if (!plaka || !c.plakalar.has(plaka)) continue;                     // ekskavatör değil
    if (c.kapali.has(plaka) && (k.hiz ?? 0) <= 5) continue;             // rapor GERÇEK kapanış + duruyor (mola) → yazma
    if (now - (c.sonZaman.get(plaka) || 0) < aralikMs) continue;        // sıklık aralığı henüz dolmadı
    yaz.push({ rapor_tarihi: gun, plaka, saat: saatAl(k.tarih), lat: k.lat, lng: k.lng });
    c.sonZaman.set(plaka, now);
  }
  if (yaz.length) {
    const { error } = await sb.from("makine_calisma_noktasi").insert(yaz);
    if (error) throw new Error(`Ekskavatör nokta yazma: ${error.message}`);
  }
  return yaz.length;
}

async function cekAnlik() {
  const user = process.env.ARVENTO_WS_USERNAME, pin1 = process.env.ARVENTO_WS_PIN1,
        pin2 = process.env.ARVENTO_WS_PIN2, lang = process.env.ARVENTO_WS_LANG || "tr";
  if (!user || !pin1 || !pin2) throw new Error("Arvento WS bilgileri eksik (.env.local: ARVENTO_WS_USERNAME/PIN1/PIN2)");
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetVehicleStatusV3 xmlns="http://www.arvento.com/"><Username>${xe(user)}</Username><PIN1>${xe(pin1)}</PIN1><PIN2>${xe(pin2)}</PIN2><Language>${xe(lang)}</Language></GetVehicleStatusV3></soap:Body></soap:Envelope>`;
  const r = await fetchTimeout(WS_URL, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://www.arvento.com/GetVehicleStatusV3" }, body });
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
      odo: sayi(h.dodometer), // toplam km — günlük km için delta alınır
      tarih: h.dtlocaldatetime || h.dtgmtdatetime || null,
      adres: h.straddress || null,
      kontak: kontakTazelik(h), // son paket tazeliği → açık=true / kapalı=false (kontak proxy'si)
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
  // arvento_anlik'te 'odo' kolonu yok → yazımdan çıkar (odo yalnız rota/rapor için kullanılır)
  const anlikSatir = satirlar.map(({ odo, ...rest }) => rest); // eslint-disable-line no-unused-vars
  const { error } = await sb.from("arvento_anlik").upsert(anlikSatir, { onConflict: "node" });
  if (error) throw new Error(`Supabase yazma hatası: ${error.message}`);
  // Ekskavatör çalışma noktaları (kontak açıkken, ayar sıklığında) — hata olsa da canlı senkronu bozmasın.
  let ekskN = 0;
  try { ekskN = await ekskNoktaBirik(sb, satirlar); } catch (e) { console.error("  ekskavatör nokta:", e.message); }
  // ROTA ARTIK BURADA YAZILMIYOR. Sparse (dakikada 1 nokta) biriktirme hem düşük kaliteliydi hem de
  // (eksik okuma / iki süreç) rota uzunluğunu DÜŞÜRÜP geri çıkarıyordu. Rota (güzergah) artık YOĞUN +
  // DOĞRU + DALGALANMAYAN şekilde SpeedReport'tan geliyor (scripts/arvento-speed-sync.mjs, bugünü periyodik
  // çeker → her çalışma o ana kadarki TAM izi yazar, idempotent). anlik yalnız CANLI KONUM (arvento_anlik) yazar.
  console.log(new Date().toLocaleTimeString(), `→ ${satirlar.length} araç konumu yazıldı${ekskN ? ` · +${ekskN} ekskavatör çalışma noktası` : ""} (rota: SpeedReport senkronundan).`);
}

// Yenileme aralığı (sn): UI'daki "Canlı Yenileme Süresi" (arvento_ayarlar.canli_yenileme_sn)
// script'i de yönetir. Okunamazsa env ARVENTO_ANLIK_ARALIK_SN, o da yoksa 15 sn.
// 10–120 sn arasına sıkıştırılır (çok sık çağrı Arvento'yu hız-sınırlar).
async function araligiOku() {
  const envSn = parseInt(process.env.ARVENTO_ANLIK_ARALIK_SN || "0", 10) || null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const q = createClient(url, key).from("arvento_ayarlar").select("canli_yenileme_sn").eq("id", "global").maybeSingle();
      // 8 sn zaman aşımı — DB yanıt vermezse varsayılana düş (asılı kalma).
      const { data } = await Promise.race([q, new Promise((_, rej) => setTimeout(() => rej(new Error("ayar okuma zaman aşımı")), 8000))]);
      const sn = data?.canli_yenileme_sn;
      if (sn && sn > 0) return Math.max(10, Math.min(120, sn));
    }
  } catch { /* DB okunamadı → alta düş */ }
  return Math.max(10, Math.min(120, envSn || 15));
}

const loop = process.argv.includes("--loop");
if (loop) {
  // Elle/test: sonsuz döngü, aralığı her turda DB'den tazele (ayar değişince hemen uyar).
  console.log("Sürekli mod (--loop). Durdurmak için Ctrl+C.");
  for (;;) {
    try { await birKez(); } catch (e) { console.error(new Date().toLocaleTimeString(), "HATA:", e.message); }
    const sn = await araligiOku();
    await new Promise((r) => setTimeout(r, sn * 1000));
  }
} else {
  // Zamanlanmış Görev modu: görev HER 1 DK ateşlenir. Bu tek çalışma, dakikayı `sn` aralıkla
  // KAPLAYACAK kadar tekrar yazar (ör. 15 sn → dakikada 4 yazım: 0/15/30/45 sn). Böylece 1 dk
  // yerine `sn` tazelik olur; yapı her dakika yeni süreçle kendini onarır (S4U/oturum kapalı uyumlu).
  let kod = 0;
  const sn = await araligiOku();
  const adet = Math.max(1, Math.floor(60 / sn)); // dakikayı kaplayan yazım sayısı
  for (let i = 0; i < adet; i++) {
    try { await birKez(); } catch (e) { console.error("HATA:", e.message); kod = 1; }
    if (i < adet - 1) await new Promise((r) => setTimeout(r, sn * 1000)); // son turda bekleme yok
  }
  // Açık kalan HTTP soketlerinin kapanması için kısa bekleme, sonra temiz çık
  // (Windows'ta process.exit'i hemen çağırınca libuv "Assertion failed" verebiliyor).
  setTimeout(() => process.exit(kod), 300);
}
