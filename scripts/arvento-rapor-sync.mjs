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
const sayi = (v) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const deco = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const ymd = (g) => g.replace(/-/g, "") ; // 2026-06-19 -> 20260619
const trBugun = () => { const n = new Date(); const tr = new Date(n.getTime() + (3 * 60 - n.getTimezoneOffset()) * 60000); return tr.toISOString().slice(0, 10); };
const trDun = () => { const n = new Date(); const tr = new Date(n.getTime() + (3 * 60 - n.getTimezoneOffset()) * 60000 - 86400000); return tr.toISOString().slice(0, 10); };
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
  const r = await fetch(WS_URL, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://www.arvento.com/VehicleOperatingReport" }, body });
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
    const satirlar = [];
    for (const c of liste) {
      try {
        const d = await aracGun(c.node, gun);
        if (d && (d.plaka || c.plaka)) {
          satirlar.push({
            rapor_tarihi: gun, plaka: c.plaka || d.plaka,
            mesafe_km: d.mesafe_km, maks_hiz: d.maks_hiz != null ? Math.round(d.maks_hiz) : null,
            kontak_sn: d.kontak_sn, rolanti_sn: d.rolanti_sn, hareket_sn: d.hareket_sn,
            ilk_kontak: d.ilk_kontak, son_kontak: d.son_kontak,
            surucu: c.surucu || null, marka: c.marka || null, model: c.model || null,
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

// Varsayılan günler: HER ZAMAN bugün; dünü yalnız gece yarısı–03:00 arası (dünün final
// değerlerini bir kez yakala). Gündüz sadece bugün → yük düşük, sık çalıştırılabilir.
function varsayilanGunler() {
  const n = new Date();
  const tr = new Date(n.getTime() + (3 * 60 - n.getTimezoneOffset()) * 60000);
  return tr.getHours() < 3 ? [trBugun(), trDun()] : [trBugun()];
}
const args = process.argv.slice(2).filter((a) => a !== "--loop");
const loop = process.argv.includes("--loop");
const gunler = args.length ? args : varsayilanGunler();
if (loop) {
  console.log(`Sürekli mod: her 5 dk. Ctrl+C ile durur.`);
  for (;;) {
    try { await birKez(varsayilanGunler()); } catch (e) { console.error("HATA:", e.message); }
    await uyku(5 * 60 * 1000);
  }
} else {
  let kod = 0;
  try { await birKez(gunler); } catch (e) { console.error("HATA:", e.message); kod = 1; }
  setTimeout(() => process.exit(kod), 400);
}
