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
const NL = String.fromCharCode(10);

// TANI: UI akışı (Arvento arayüzü değişince kırılabilir) patlarsa ekran görüntüsü + sayfa metni yaz.
// Görev VBS ile penceresiz koştuğu için konsol çıktısı kaybolur; dosya kalır → nerede takıldığı görülür.
async function hataDoku(page: Page, hata: unknown): Promise<void> {
  try {
    const dizin = path.join(kok, "logs");
    fs.mkdirSync(dizin, { recursive: true });
    await page.screenshot({ path: path.join(dizin, "damper-hata.png"), fullPage: false });
    const metin = await page.locator("body").innerText().catch(() => "(metin okunamadi)");
    // Ustte duran modal/overlay varsa HTML'ini de yaz -> kapatma secicisini bulmak icin.
    // Ustte duran modal/overlay: baslik/dugme metninden yukari yurunerek kapsayiciyi ve kapatma
    // dugmesini bul (z-index sabit degil, bu yuzden metin uzerinden gidiyoruz).
    const pencereler = await page.evaluate(() => {
      const cikti: string[] = [];
      const hepsi = Array.from(document.querySelectorAll("*")) as HTMLElement[];
      const isaret = hepsi.filter((el) => (el.textContent || "").includes("Bir Daha Gosterme")
        || (el.textContent || "").includes("Daha Goster") || (el.textContent || "").includes("Anketi"));
      const yaprak = isaret.filter((el) => !isaret.some((o) => o !== el && el.contains(o)));
      for (const el of yaprak.slice(0, 2)) {
        let n: HTMLElement | null = el; const yol: string[] = [];
        for (let i = 0; i < 10 && n; i++) {
          const r = n.getBoundingClientRect(); const st = getComputedStyle(n);
          yol.push(`${i}: <${n.tagName.toLowerCase()} class="${n.className}" id="${n.id}"> pos=${st.position} z=${st.zIndex} rect=${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          n = n.parentElement;
        }
        cikti.push(yol.join(String.fromCharCode(10)));
      }
      // Buyuk kapsayicinin ic HTML basligi (kapatma dugmesi genelde basliktadir)
      const buyuk = hepsi.find((el) => { const r = el.getBoundingClientRect(); return r.width > 700 && r.width < 1200 && r.height > 400 && getComputedStyle(el).position === "fixed"; });
      if (buyuk) cikti.push("BUYUK KAPSAYICI HTML: " + buyuk.outerHTML.slice(0, 2500));
      return cikti;
    }).catch(() => [] as string[]);
    const satirlar = [
      new Date().toLocaleString("tr-TR"),
      "URL: " + page.url(),
      "HATA: " + (hata instanceof Error ? hata.message : String(hata)),
      "",
      "--- ONDEKI PENCERELER (" + pencereler.length + ") ---",
      pencereler.join(NL + "======" + NL),
      "",
      "--- SAYFA METNI ---",
      metin,
    ];
    fs.writeFileSync(path.join(dizin, "damper-hata.txt"), satirlar.join(NL), "utf8");
    console.log("   tani dosyalari: logs/damper-hata.png + .txt");
  } catch { /* tani yazilamazsa asil hatayi golgeleme */ }
}

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


// Arvento, reports.aspx uzerine zaman zaman PAZARLAMA/ANKET modali aciyor ("Arvento Elektirikli Arac
// Anketi" gibi). Modal sayfayi tamamen orttugu icin asagidaki sabit koordinatli tiklamalar modalin
// uzerine dusuyor ve rapor hic acilmiyordu -> damper verisi gunlerce yalnizca e-posta akisindan ERTESI
// GUN geliyordu. Burada modal SADECE KAPATILIR: ankete cevap verilmez, "Bir Daha Gosterme" isaretlenmez
// (hesap ayari degistirmeyelim); her kosumda yeniden cikarsa yeniden kapatilir.
async function kapatEngelPencereler(page: Page): Promise<void> {
  for (let tur = 0; tur < 4; tur++) {
    // DevExtreme modal: .dx-overlay-wrapper.dx-overlay-shader > .dx-overlay-content > .dx-popup-title(.dx-has-close-button)
    const perde = page.locator(".dx-overlay-wrapper.dx-overlay-shader").filter({ has: page.locator(".dx-popup-title") }).first();
    if (!(await perde.isVisible().catch(() => false))) return; // modal yok / kapandi
    const kapat = perde.locator(".dx-popup-title .dx-closebutton, .dx-popup-title .dx-icon-close, .dx-popup-title [class*='close']").first();
    if (await kapat.count().catch(() => 0)) {
      await kapat.click({ force: true }).catch(() => {});
    } else {
      // Kapatma dugmesi secilemezse basligin sag ust kosesine tikla (X ikonu orada durur).
      const kutu = await perde.locator(".dx-overlay-content").first().boundingBox().catch(() => null);
      if (!kutu) return;
      await page.mouse.click(kutu.x + kutu.width - 24, kutu.y + 24);
    }
    await bekle(page, 1200);
    if (!(await perde.isVisible().catch(() => false))) { console.log("   engel pencere (anket/duyuru) kapatildi"); return; }
  }
  console.log("   UYARI: engel pencere kapatilamadi - rapor acilmayabilir");
}

async function tetikleGenelRapor(page: Page, gunTarih?: string): Promise<void> {
  // GEÇMİŞ GÜN: rapor tarihi Arvento'nun ÖZEL tarih bileşeninden geliyor (dxDateBox DEĞİL) → UI'dan
  // ayarlamak güvenilmez. Bunun yerine "Çalıştır"ın gönderdiği /reporting/execute isteğini UÇARKEN
  // yakalayıp payload.filter.date.dateRange'i istenen güne çeviriyoruz (UI tüm cihaz/kolon/alarm
  // seçimini doğru kurar; biz yalnız tarihi cerrahi olarak değiştiririz → en sağlam yol).
  if (gunTarih && /^\d{4}-\d{2}-\d{2}$/.test(gunTarih)) {
    const ymd = gunTarih.replace(/-/g, "");
    await page.route("**/reporting/execute", async (route) => {
      try {
        const body = route.request().postData();
        if (body) {
          const j = JSON.parse(body);
          if (j?.filter?.date?.dateRange) {
            j.filter.date.dateRange.start = `${ymd}000000`;
            j.filter.date.dateRange.end = `${ymd}235959`;
            if (typeof j.filter.date.dateType !== "undefined") j.filter.date.dateType = 0; // "Detaylı/aralık" modu
            console.log(`   execute isteği ${gunTarih} olarak yeniden yazıldı`);
            await route.continue({ postData: JSON.stringify(j) });
            return;
          }
        }
      } catch (e) { console.log("   execute yeniden yazma hatası:", e instanceof Error ? e.message : e); }
      await route.continue();
    });
  }

  await page.goto(`${BASE}/reports.aspx`, { waitUntil: "networkidle", timeout: 60000 });
  await bekle(page, 4000);
  await kapatEngelPencereler(page); // anket/duyuru modalı sayfayı örtüyorsa kapat (aksi halde tıklamalar boşa gider)
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

  // 5) Çalıştır (geçmiş gün istenmişse yukarıdaki route interceptor tarihi uçarken değiştirir)
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
  // Geçmiş gün: --gun YYYY-MM-DD → o günün raporunu çek (kaçan damperi geri getirme). Verilince
  // saat/periyot kapısı otomatik atlanır (force gibi) — geçmiş çekim her saat mümkün olmalı.
  const gunArg = process.argv.find((a) => /^--gun=\d{4}-\d{2}-\d{2}$/.test(a))?.split("=")[1]
    ?? (process.argv.includes("--gun") ? process.argv[process.argv.indexOf("--gun") + 1] : undefined);
  const gecmisGun = gunArg && /^\d{4}-\d{2}-\d{2}$/.test(gunArg) ? gunArg : undefined;
  const kapiyiAtla = force || !!gecmisGun;

  // Servis-rol client — saat/periyot kapısı okuması + başarıdan sonra "son çalışma" damgası için.
  const sb = (() => {
    try { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }); }
    catch { return null; }
  })();

  // MANUEL tetik (UI "Raporu şimdi çek" butonu): arvento_ayarlar.manuel_tetikle_istek yazılır. İstek son DAMPER
  // çekiminden sonraysa pencere/periyot kapısı ATLANIR → kullanıcı "şimdi çek" dedi, hemen çekilir. Çekim sonrası
  // damper_sync_son_calisma güncellenince istek≤son olur → kendi kapanır (tekrar tetiklemez).
  let manuelForce = false;
  if (!kapiyiAtla && sb) {
    try {
      const { data } = await sb.from("arvento_ayarlar")
        .select("manuel_tetikle_istek, damper_sync_son_calisma").eq("id", "global").maybeSingle();
      const istek = data?.manuel_tetikle_istek ? new Date(data.manuel_tetikle_istek as string).getTime() : 0;
      const sonD = data?.damper_sync_son_calisma ? new Date(data.damper_sync_son_calisma as string).getTime() : 0;
      if (istek && istek > sonD) { manuelForce = true; console.log(`${zaman()} → MANUEL tetik algılandı — pencere/periyot atlanıyor.`); }
    } catch { /* kolon yoksa manuel yok */ }
  }

  // KAPI (Tanımlamalar → "Damper Senkron Saatleri"): görev 5 dk'da bir tetiklenir; asıl sıklığı BU belirler.
  //  1) Saat penceresi (bas–bit) dışındaysa hiç çalışma.  2) Son başarılı çekimden PERİYOT kadar dk geçmediyse atla.
  // Her ikisi de Playwright açılmadan ÖNCE bakılır → boş tetiklerde ~1 sn'de çıkar (ucuz). MANUEL tetikte atlanır.
  if (!kapiyiAtla && !manuelForce && sb) {
    let bas = 6, bit = 21, periyot = 60, son = 0, periyotKolonVar = true;
    try {
      const { data, error } = await sb.from("arvento_ayarlar")
        .select("damper_sync_bas_saat, damper_sync_bit_saat, damper_sync_periyot_dk, damper_sync_son_calisma")
        .eq("id", "global").maybeSingle();
      if (error) throw error;
      bas = data?.damper_sync_bas_saat ?? 6; bit = data?.damper_sync_bit_saat ?? 21;
      periyot = Math.max(5, data?.damper_sync_periyot_dk ?? 60);
      son = data?.damper_sync_son_calisma ? new Date(data.damper_sync_son_calisma as string).getTime() : 0;
    } catch {
      // Periyot/son_calisma kolonları henüz yok (SQL çalışmadı) → sadece saat penceresini oku.
      periyotKolonVar = false;
      try {
        const { data } = await sb.from("arvento_ayarlar").select("damper_sync_bas_saat, damper_sync_bit_saat").eq("id", "global").maybeSingle();
        bas = data?.damper_sync_bas_saat ?? 6; bit = data?.damper_sync_bit_saat ?? 21;
      } catch { /* o da okunamazsa varsayılan 6–21 */ }
    }
    const saat = new Date().getHours();
    if (saat < bas || saat > bit) { console.log(`${zaman()} → saat ${saat}:xx, çalışma penceresi (${bas}–${bit}) DIŞINDA — atlanıyor.`); return; }
    if (periyotKolonVar) {
      // SAAT BAŞINA (periyot dilimine) HİZALI: periyot=60 → her saat başı (09:00, 10:00…); 30 → :00/:30; 120 → çift saatler.
      // "Son çekimden 60 dk" DEĞİL — o, elle tetikleme (--force) araya girince saati kaydırıyordu. Dilim mantığı:
      // son çalışmanın dilimi ≠ şimdiki dilim ise çalış → elle tetikleme olsa da sonraki saat başı kaçmaz. (TR = UTC+3
      // tam saat farkı olduğu için epoch-dilim sınırları yerel :00/:30 ile çakışır.)
      const dilim = (ms: number) => Math.floor(ms / 60000 / periyot);
      if (son && dilim(Date.now()) === dilim(son)) { console.log(`${zaman()} → bu ${periyot} dk'lık dilimde zaten çekildi — atlanıyor.`); return; }
    } else if (new Date().getMinutes() >= 5) {
      // SQL bekliyor: periyot bilinmiyor → 5 dk'lık tetikte spam olmasın diye saat başı davran (yalnız ilk 5 dk penceresi).
      console.log(`${zaman()} → periyot ayarı yok (SQL bekliyor), saat başı modunda — atlanıyor.`); return;
    }
  }

  // ÇAKIŞMA ÖNLEME: çekime karar verildi → damper_sync_son_calisma'yı Playwright açılmadan ÖNCE damgala.
  // Görev 1 dk'da ateşlenip damper çekimi ~1 dk sürdüğü için, damga yalnız sonda (satır ~225) yazılırsa aradaki
  // fire aynı dilimi görüp İKİNCİ bir headless tarayıcı + Arvento login başlatır. Başta damgalayınca sonraki
  // fire "bu dilimde çekildi" deyip atlar. (Geçmiş gün hariç — o damga yazmaz ki bugünkü periyodu kaydırmasın.)
  if (sb && !gecmisGun) { try { await sb.from("arvento_ayarlar").update({ damper_sync_son_calisma: new Date().toISOString() }).eq("id", "global"); } catch { /* damga yazılamazsa yine de çekmeyi dene */ } }

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
    try { await tetikleGenelRapor(page, gecmisGun); } catch (e) { await hataDoku(page, e); throw e; }
    console.log(`${zaman()} → rapor tetiklendi${gecmisGun ? ` (GEÇMİŞ GÜN: ${gecmisGun})` : ""}, çıktı bekleniyor...`);

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
  // Başarılı çekim damgası → periyot bir sonraki çalışmayı bu zamandan sayar. GEÇMİŞ GÜN çekiminde
  // damga YAZMA: aksi halde bugünkü periyodik akış "az önce çekildi" sanıp o saati atlar.
  if (sb && !gecmisGun) { try { await sb.from("arvento_ayarlar").update({ damper_sync_son_calisma: new Date().toISOString() }).eq("id", "global"); } catch { /* damga yazılamazsa sorun değil */ } }
  console.log(`${zaman()} → OK | ${uretilenTarih} raporu işlendi · ${sonuc.damperGunler.map((g) => `${g.tarih}:${g.sayi}`).join(", ") || "damper olayı yok"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("HATA:", e instanceof Error ? e.message : String(e)); process.exit(1); });
