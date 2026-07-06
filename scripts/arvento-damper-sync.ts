// Arvento DAMPER senkronu — TAM OTOMATİK, E-POSTA/PERİYODİK BAĞIMSIZ.
// web.arvento.com'a Playwright (gerçek tarayıcı, WAF'ı geçer) ile girer → "Genel Rapor"u UI'dan tetikler
// (tüm cihazlar + Enlem/Boylam kolonları + "Damper İndi" alarmı + bugün + XLS) → rapor birkaç saniyede üretilir →
// rest/reporting/requests'ten YENİ general_report çıktısını bulur → .xls'i indirir → ingestArventoBuffer ile
// arac_arvento_rapor'a yazar (damper sayısı + KOORDİNATLI olaylar; mail akışıyla AYNI parse/hedef).
//
// Böylece Arvento'da periyodik rapor kurmaya / mail beklemeye GEREK YOK — script raporu kendisi çalıştırır.
//
// Çalıştırma (proje klasöründe):
//   npx tsx scripts/arvento-damper-sync.ts           → saat penceresi içindeyse tetikle+işle
//   npx tsx scripts/arvento-damper-sync.ts --force    → saat penceresini yok say (elle test)
//
// GEREKLİ .env.local: ARVENTO_WEB_USER, ARVENTO_WEB_PASS (web.arvento.com giriş bilgileri)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, type Page, type BrowserContext } from "playwright";
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

const BASE = "https://web.arvento.com";
const bekle = (p: Page, ms: number) => p.waitForTimeout(ms);

// SESSION çerezi (sid) al. WAF (NetScaler) düz HTTP login'i reddettiği için gerçek tarayıcı şart.
async function login(ctx: BrowserContext, page: Page, user: string, pass: string): Promise<string> {
  await page.goto(`${BASE}/signin.aspx`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[field="u"] input', { timeout: 30000 });
  await page.locator('[field="u"] input').first().fill(user);
  await page.locator('[field="p"] input').first().fill(pass);
  await page.locator('[field="p"] input').first().press("Enter");
  for (let i = 0; i < 30; i++) {
    await bekle(page, 1000);
    const s = (await ctx.cookies()).find((c) => c.name === "SESSION");
    if (s?.value && s.value.length > 10) return s.value;
  }
  throw new Error("Giriş başarısız — SESSION çerezi alınamadı (kullanıcı adı/şifre veya 2FA?).");
}

// Genel Rapor'u UI'dan tetikle: tüm cihazlar + Enlem/Boylam + Damper İndi + bugün + XLS → Çalıştır.
// NOT: koordinatlar 1500x950 sabit viewport'a göredir; DOM tabanlı adımlar (kolon/alarm/XLS/Çalıştır) daha sağlamdır.
async function tetikleGenelRapor(page: Page): Promise<void> {
  await page.goto(`${BASE}/reports.aspx`, { waitUntil: "networkidle", timeout: 60000 });
  await bekle(page, 4000);
  await page.mouse.click(519, 474); // "Genel Rapor" kartı → Raporu Aç (sol üst kart)
  await bekle(page, 6000);

  // 1) Tüm cihazlar — "Cihaz seçiniz" aç → başlık checkbox'ı (tümünü seç)
  await page.mouse.click(230, 220); await bekle(page, 2500);
  await page.mouse.click(126, 276); await bekle(page, 1500);
  await page.keyboard.press("Escape"); await bekle(page, 1200);

  // 2) Kolonlara Enlem + Boylam ekle (koordinat için) — tek açılışta ikisini seç
  const kolonBox = page.locator('.dx-tagbox:has(.dx-tag:has-text("Cihaz Numarası"))').first();
  await kolonBox.click(); await bekle(page, 1500);
  for (const kol of ["Enlem", "Boylam"]) {
    const it = page.locator(".dx-list-item").filter({ hasText: new RegExp(`^\\s*${kol}\\s*$`) }).first();
    if (await it.count()) { await it.scrollIntoViewIfNeeded().catch(() => {}); await it.click({ force: true }); }
    await bekle(page, 700);
  }
  await page.keyboard.press("Escape"); await bekle(page, 800);

  // 3) Alarmlar → "Damper İndi" (aranabilir tagbox)
  await page.mouse.click(972, 163); await bekle(page, 1500);
  await page.keyboard.type("Damper İndi", { delay: 60 }); await bekle(page, 2500);
  const al = page.locator(".dx-list-item").filter({ hasText: /^Damper İndi$/ }).first();
  if (await al.count()) await al.click();
  await bekle(page, 1200); await page.keyboard.press("Escape"); await bekle(page, 800);

  // 4) Çıktı türü → XLS
  await page.mouse.click(870, 580); await bekle(page, 1500);
  const xls = page.locator(".dx-list-item, .dx-item-content").filter({ hasText: /^XLS$/ }).first();
  if (await xls.count()) await xls.click();
  await bekle(page, 1200);

  // 5) Çalıştır
  const calistir = page.getByText("Çalıştır", { exact: true }).first();
  if (await calistir.count()) await calistir.click({ force: true }).catch(() => page.mouse.click(1040, 580));
  else await page.mouse.click(1040, 580);
  await bekle(page, 2000);
}

async function main() {
  const user = process.env.ARVENTO_WEB_USER, pass = process.env.ARVENTO_WEB_PASS;
  if (!user || !pass) throw new Error(".env.local'da ARVENTO_WEB_USER / ARVENTO_WEB_PASS tanımlı değil.");
  const zaman = () => new Date().toLocaleString("tr-TR");
  const force = process.argv.includes("--force"); // saat penceresini yok say (elle test için)

  // SAAT PENCERESİ: Tanımlamalar'daki damper_sync_bas/bit_saat aralığı dışındaysa hiç çalışma (Playwright bile açma).
  if (!force) {
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { data } = await sb.from("arvento_ayarlar").select("damper_sync_bas_saat, damper_sync_bit_saat").eq("id", "global").maybeSingle();
      const bas = data?.damper_sync_bas_saat ?? 6, bit = data?.damper_sync_bit_saat ?? 21;
      const saat = new Date().getHours();
      if (saat < bas || saat > bit) { console.log(`${zaman()} → saat ${saat}:xx, çalışma penceresi (${bas}–${bit}) DIŞINDA — atlanıyor.`); return; }
    } catch { /* ayar okunamazsa yine de dene (varsayılan davranış) */ }
  }

  const browser = await chromium.launch({ headless: true });
  let buf: Buffer | null = null;
  let uretilenTarih = "";
  try {
    const ctx = await browser.newContext({ locale: "tr-TR", viewport: { width: 1500, height: 950 } });
    const page = await ctx.newPage();
    const sid = await login(ctx, page, user, pass);
    const H = {
      "AAPI-Reference": "1", "Accept": "*/*", "Authorization": "sid " + sid,
      "Content-Type": "application/json", "Origin": BASE, "Referer": `${BASE}/reports.aspx`, "Cookie": "SESSION=" + sid,
    };
    const reqList = async (): Promise<{ REPORT_NAME: string; STATUS: string; OUTPUT_URL: string | null; START_DATE: string }[]> => {
      const r = await fetch(`${BASE}/rest/reporting/requests`, { method: "POST", headers: H, body: "null" });
      if (!r.ok) throw new Error(`requests HTTP ${r.status}`);
      const j = (await r.json()) as { Data?: { REPORT_NAME: string; STATUS: string; OUTPUT_URL: string | null; START_DATE: string }[] };
      return j.Data ?? [];
    };
    const anahtar = (d: { REPORT_NAME: string; START_DATE: string }) => `${d.REPORT_NAME}|${d.START_DATE}`;

    // Tetikten ÖNCE mevcut istekleri işaretle → sonra SADECE bu koşumun ürettiği yeni general_report'u al.
    const oncekiler = new Set((await reqList()).map(anahtar));
    await tetikleGenelRapor(page);
    console.log(`${zaman()} → rapor tetiklendi, çıktı bekleniyor...`);

    // Yeni, tamamlanmış general_report çıktısını yokla (rapor genelde ~5 sn'de biter; 120 sn tavan).
    let outUrl: string | null = null;
    for (let i = 0; i < 24; i++) {
      await bekle(page, 5000);
      const yeni = (await reqList()).filter((d) => !oncekiler.has(anahtar(d)) && d.REPORT_NAME === "general_report" && d.STATUS === "Finished" && d.OUTPUT_URL);
      if (yeni.length) {
        yeni.sort((a, b) => (b.START_DATE ?? "").localeCompare(a.START_DATE ?? ""));
        outUrl = yeni[0].OUTPUT_URL; uretilenTarih = yeni[0].START_DATE;
        break;
      }
    }
    if (!outUrl) { console.log(`${zaman()} → ÇIKTI YOK | rapor süresinde tamamlanmadı (Arvento gecikmesi olabilir).`); return; }

    const url = outUrl.startsWith("//") ? "https:" + outUrl : outUrl;
    const res = await fetch(url, { headers: { "Authorization": "sid " + sid, "Cookie": "SESSION=" + sid, "Referer": `${BASE}/` } });
    if (!res.ok) throw new Error(`indirme HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } finally {
    await browser.close();
  }

  const { ingestArventoBuffer } = await import("@/lib/arvento/ingest");
  const sonuc = await ingestArventoBuffer(buf!);
  console.log(`${zaman()} → OK | ${uretilenTarih} raporu işlendi · ${sonuc.damperGunler.map((g) => `${g.tarih}:${g.sayi}`).join(", ") || "damper olayı yok"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("HATA:", e instanceof Error ? e.message : String(e)); process.exit(1); });
