// Arvento GERÇEK çalışma raporu senkronu — VehicleOperatingReport metodunu (Language=1033,
// Compress=0 → düz XML) araç (node) bazında çağırıp km/kontak açık/rölanti/hareket/maks hız +
// ilk-son kontak değerlerini Supabase `arac_arvento_rapor`'a yazar. Bu, panelinizdeki
// "Araç Çalışma Raporu" ile BİREBİR aynı gerçek veridir (tahmin değil).
//
// IMAP'ın değil, Arvento WS'nin İZİNLİ olduğu makinede çalışır (Türkiye/şirket IP).
// Çalıştırma:
//   npx? hayır — düz node:  node scripts/arvento-rapor-sync.mjs           → bugün + dün
//   node scripts/arvento-rapor-sync.mjs --loop                            → her 15 dk sürekli
//   node scripts/arvento-rapor-sync.mjs 2026-06-19                        → belirli gün
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(__dirname, "..");
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

const WS_URL = "https://ws.arvento.com/v1/report.asmx";
const xe = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const uyku = (ms) => new Promise((r) => setTimeout(r, ms));
// Zaman aşımlı fetch — Arvento yanıt vermezse ~25 sn'de iptal eder (tek takılı istek tüm senkronu dondurmasın).
async function fetchTimeout(url, opts, ms = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}
const sayi = (v) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const deco = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const ymd = (g) => g.replace(/-/g, "") ; // 2026-06-19 -> 20260619
// TR = UTC+3: mutlak epoch'a +3 saat ekle (makine saat dilimine bağımsız → 21:00'de güne atlamaz, gece 00:00'da atlar).
const trBugun = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const trDun = () => new Date(Date.now() + 3 * 3600000 - 86400000).toISOString().slice(0, 10);
const saatAl = (t) => { const m = String(t || "").match(/\d{1,2}:\d{2}:\d{2}/); if (!m) return null; const [h, mi, s] = m[0].split(":"); return `${h.padStart(2, "0")}:${mi}:${s}`; };

// Bir araç-gün için VehicleOperatingReport satırını çek (düz XML).
async function aracGun(node, gun) {
  const user = process.env.ARVENTO_WS_USERNAME, pin1 = process.env.ARVENTO_WS_PIN1, pin2 = process.env.ARVENTO_WS_PIN2;
  const g = ymd(gun);
  const P = {
    Username: user, PIN1: pin1, PIN2: pin2,
    StartDate: `${g}000000`, EndDate: `${g}235959`,
    Node: node, Group: "", Compress: "0", Locale: "", Language: "1033",
    ShowDayByDay: "true", ShowLastLocationInformation: "false", ShowDistance: "true",
    ShowStandStill: "true", ShowIdling: "true", ShowIgnition: "true", ShowMaxSpeed: "true",
    ShowAlarmCounts: "true", ShowAlarmInformation: "true", ShowMotionDuration: "true",
  };
  const inner = Object.entries(P).map(([k, v]) => `<${k}>${xe(v)}</${k}>`).join("");
  const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><VehicleOperatingReport xmlns="http://www.arvento.com/">${inner}</VehicleOperatingReport></soap:Body></soap:Envelope>`;
  const r = await fetchTimeout(WS_URL, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://www.arvento.com/VehicleOperatingReport" }, body });
  let t = await r.text();
  t = t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const row = t.match(/<Calisma\s+diffgr:id="[^"]*1"[\s\S]*?<\/Calisma>/);
  if (!row) return null; // o gün veri yok
  const o = {};
  for (const mm of row[0].matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)) o[deco(mm[1])] = mm[2];
  const sn = (pre) => (parseInt(o[`${pre} hr`] || 0, 10) * 3600) + (parseInt(o[`${pre} min`] || 0, 10) * 60) + parseInt(o[`${pre} sec`] || 0, 10);
  return {
    plaka: o["License Plate"],
    mesafe_km: sayi(o["Distance km"]),
    maks_hiz: sayi(o["Maximum Speed km/h"]),
    kontak_sn: sn("Ignition On Duration"),
    rolanti_sn: sn("Idling Duration"),
    hareket_sn: sn("Motion Time"),
    ilk_kontak: saatAl(o["First Ignition On Alarm"]),
    son_kontak: saatAl(o["Last Ignition Off Alarm"]),
  };
}

async function birKez(gunler) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase bilgileri eksik");
  const sb = createClient(url, key);
  const { data: cihazlar } = await sb.from("arvento_cihaz").select("node, plaka, marka, model, surucu");
  const liste = (cihazlar || []).filter((c) => c.node);
  let yazildi = 0;
  for (const gun of gunler) {
    // O güne ait mevcut satırları çek → MONOTON birleştirme için (değer asla düşmesin).
    // Günlük km/kontak/hareket/rölanti kümülatiftir; Arvento anlık 0/eksik dönerse
    // önceki doğru değeri EZMEYELİM. ilk_kontak en erken, son_kontak en geç kalsın.
    const { data: mevcutSatir } = await sb
      .from("arac_arvento_rapor")
      .select("plaka, mesafe_km, maks_hiz, kontak_sn, rolanti_sn, hareket_sn, ilk_kontak, son_kontak")
      .eq("rapor_tarihi", gun);
    const mevcut = new Map((mevcutSatir || []).map((r) => [r.plaka, r]));
    // GPS güzergah mesafesi (yedek). Arvento resmi raporu bazı araçlara 0 km döndürüyor
    // (ör. 60 BP 843: hareket var, mesafe 0). O durumda anlık senkronun biriktirdiği
    // gerçek GPS yolunu taban olarak kullan. GPS kiriş-örneklemesi gerçek yolu hafife
    // alır, bu yüzden resmi km doluysa hep o kazanır (en büyük seçilir).
    const { data: rotaSatir } = await sb
      .from("arac_arvento_guzergah")
      .select("plaka, toplam_mesafe")
      .eq("rapor_tarihi", gun);
    const rotaKm = new Map((rotaSatir || []).map((r) => [r.plaka, r.toplam_mesafe]));
    const enBuyuk = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));
    const enErken = (a, b) => (!a ? b : !b ? a : a <= b ? a : b);
    const enGec = (a, b) => (!a ? b : !b ? a : a >= b ? a : b);

    const satirlar = [];
    for (const c of liste) {
      try {
        const d = await aracGun(c.node, gun);
        if (d && (d.plaka || c.plaka)) {
          const plaka = c.plaka || d.plaka;
          const v = mevcut.get(plaka) || {};
          satirlar.push({
            rapor_tarihi: gun, plaka,
            // Kümülatif alanlar: yeni ile eskinin BÜYÜĞÜ (anlık 0/eksik cevabı ezemez).
            // mesafe için ayrıca GPS güzergah mesafesi taban (resmi 0 dönerse devreye girer).
            mesafe_km: enBuyuk(enBuyuk(d.mesafe_km, v.mesafe_km), rotaKm.get(plaka)),
            maks_hiz: enBuyuk(d.maks_hiz != null ? Math.round(d.maks_hiz) : null, v.maks_hiz),
            kontak_sn: enBuyuk(d.kontak_sn, v.kontak_sn),
            rolanti_sn: enBuyuk(d.rolanti_sn, v.rolanti_sn),
            hareket_sn: enBuyuk(d.hareket_sn, v.hareket_sn),
            ilk_kontak: enErken(d.ilk_kontak, v.ilk_kontak),
            son_kontak: enGec(d.son_kontak, v.son_kontak),
            surucu: c.surucu || null, marka: c.marka || null, model: c.model || null,
            // Her yazımda güncellenir → "rapor verisinin en son güncellenme zamanı" (haritada gösterilir).
            // Günde tek satır/plaka upsert edildiği için created_at'i son yazım zamanı olarak kullanıyoruz.
            created_at: new Date().toISOString(),
          });
        }
      } catch (e) { /* sonraki araç */ }
      await uyku(700); // rate-limit'e karşı aralık
    }
    if (satirlar.length) {
      // Yalnız bu sütunlar güncellenir; damper_olaylar vb. korunur (upsert).
      const { error } = await sb.from("arac_arvento_rapor").upsert(satirlar, { onConflict: "rapor_tarihi,plaka" });
      if (error) throw new Error(`Rapor yazma hatası: ${error.message}`);
      yazildi += satirlar.length;
    }
    console.log(`${new Date().toLocaleTimeString("tr-TR")} → ${gun}: ${satirlar.length} araç çalışma raporu yazıldı.`);
  }
  return yazildi;
}

// Varsayılan günler: HER ZAMAN bugün + dün. Böylece dünün geç finalize olan değerleri (Arvento
// raporu gün içinde güncelliyor — ör. son kontak) her 5 dk'da otomatik yakalanır; ayrı bir "09:00
// dün güncelle" görevine GEREK KALMAZ. Monoton birleştirme zaten en doğru değeri tutar.
function varsayilanGunler() {
  return [trBugun(), trDun()];
}
// Çekme aralığı (dk): UI'daki "Rapor Çekme Süresi" (arvento_ayarlar.rapor_cekme_dk) yönetir.
// Okunamazsa env ARVENTO_RAPOR_ARALIK_DK, o da yoksa 6 dk. 6–120 dk arasına sıkıştırılır (bir çekim ~6 dk sürer).
async function araligiOkuDk() {
  const envDk = parseInt(process.env.ARVENTO_RAPOR_ARALIK_DK || "0", 10) || null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const { data } = await createClient(url, key)
        .from("arvento_ayarlar").select("rapor_cekme_dk").eq("id", "global").maybeSingle();
      const dk = data?.rapor_cekme_dk;
      if (dk && dk > 0) return Math.max(6, Math.min(120, dk)); // taban 6 dk: bir çekim döngüsü zaten ~6 dk
    }
  } catch { /* DB okunamadı → alta düş */ }
  return Math.max(6, Math.min(120, envDk || 6));
}

// "Son çalışma" damgası — makine-yerel dosyada. Zamanlanmış görev her 1 dk ateşlenir; bu damga
// ile yalnız ayardaki dakika dolduğunda gerçek çekim yapılır (aradaki tetiklemeler ucuz çıkar).
const DAMGA = path.join(__dirname, ".rapor-son.txt");
function sonCalismaOku() { try { return new Date(fs.readFileSync(DAMGA, "utf8").trim()).getTime() || 0; } catch { return 0; } }
function sonCalismaYaz() { try { fs.writeFileSync(DAMGA, new Date().toISOString()); } catch { /* yoksay */ } }

const args = process.argv.slice(2).filter((a) => a !== "--loop" && a !== "--dun");
const loop = process.argv.includes("--loop");
const dunMod = process.argv.includes("--dun"); // --dun → BİR ÖNCEKİ günü çek (gate yok). Günlük 09:00 görevi için.
const elle = args.length > 0 || dunMod;        // belirli gün VEYA --dun → gate uygulanmaz, hemen çek
const gunler = dunMod ? [trDun()] : (args.length ? args : varsayilanGunler());
if (loop) {
  console.log(`Sürekli mod: aralık ayardan okunur (Rapor Çekme Süresi). Ctrl+C ile durur.`);
  for (;;) {
    try { await birKez(varsayilanGunler()); } catch (e) { console.error("HATA:", e.message); }
    const dk = await araligiOkuDk();
    await uyku(dk * 60 * 1000);
  }
} else if (elle) {
  // Elle (gün argümanlı) çalıştırma: gate yok, hemen çek.
  let kod = 0;
  try { await birKez(gunler); } catch (e) { console.error("HATA:", e.message); kod = 1; }
  setTimeout(() => process.exit(kod), 400);
} else {
  // Zamanlanmış Görev modu: görev belirli aralıkla ateşlenir; ayardaki dakika dolmadıysa ucuz çık.
  // PAY (100 sn): çekim ~25 sn sürdüğü için damga fire'dan geç düşer; sonraki fire eşiğin hemen
  // ALTINDA gelip atlanmasın diye eşiği 100 sn düşürürüz (yoksa efektif aralık ~2 katına çıkar).
  let kod = 0;
  const dk = await araligiOkuDk();
  const esikMs = Math.max(0, dk * 60 - 100) * 1000;
  const gecen = Date.now() - sonCalismaOku();
  if (sonCalismaOku() && gecen < esikMs) {
    console.log(`${new Date().toLocaleTimeString("tr-TR")} → erken (${Math.round(gecen / 60000)}/${dk} dk), çekim atlandı.`);
    setTimeout(() => process.exit(0), 200);
  } else {
    try { await birKez(gunler); sonCalismaYaz(); } catch (e) { console.error("HATA:", e.message); kod = 1; }
    setTimeout(() => process.exit(kod), 400);
  }
}
