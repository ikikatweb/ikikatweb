// Evrak yazdırma — platforma göre iki yol:
//  - Masaüstü / Android: bilinen akış, window.print(). (@page margin:0 sayesinde Chrome alt bilgi basmaz.)
//  - iOS (iPhone/iPad): Safari, WEB SAYFASI yazdırmasına alt bilgi (sol altta URL, sağ altta tarih/sayfa)
//    DAMGALAR ve bunu kapatan bir ayar YOKTUR — @page margin:0 bile kaldırmıyor (içeriğin üstüne biner).
//    Tek temiz çözüm: evrağı PDF'e çevirip PDF'i açmak — PDF yazdırmada Safari damga basmaz.
//    Print portalı (.evrak-print-portal) globals.css sayesinde ekran DIŞINDA tam A4 layout'uyla zaten
//    hazır: html2canvas ile rasterize → jsPDF A4 → PDF'i aç (oradan Yazdır/Paylaş).
//
// PDF AYNI SEKMEDE açılır, kapatmak geri tuşudur. Ayrı sekmede açılırken Safari arkadaki
// sayfayı bellekten atıyor, geri dönülünce yazışma listesi baştan yükleniyordu. Tek istisna
// Hızlı Talimat: orada ekranda KAYDEDİLMEMİŞ yazı var, sayfadan çıkılamaz (yeniSekme: true).

export function iosMu(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS kendini "Mac" gösterir
}

// SAYFA KENAR BOŞLUKLARI — @page kuralıyla (globals.css @media print) BİREBİR aynı olmalı,
// yoksa aynı evrak yazıcıdan ve telefondan farklı sayfa sayısıyla çıkar.
const UST_MM = 12.5, ALT_MM = 25, YAN_MM = 22.5;
const ICERIK_GENISLIK_MM = 210 - YAN_MM * 2;        // 165
const ICERIK_YUKSEKLIK_MM = 297 - UST_MM - ALT_MM;  // 259.5

/**
 * Sayfa kesiminin metnin ORTASINDAN geçmemesi için: ideal noktadan yukarı doğru
 * tamamen boş (beyaz) bir piksel satırı arar, bulursa orayı kesim yeri verir.
 *
 * NEDEN: tarayıcı yazdırırken satırı ASLA ikiye bölmez, sayfayı satır arasından
 * böler. Resim dilimlerken bu kendiliğinden olmaz — düz geometrik kesim harflerin
 * tam ortasından geçip üst yarısını bir sayfada, alt yarısını öbüründe bırakır.
 * Tablo/çerçeve gibi kesintisiz bir şey varsa boş satır bulunamaz → ideal nokta.
 */
function kesimNoktasi(canvas: HTMLCanvasElement, ideal: number, enAz: number): number {
  const ctx = canvas.getContext("2d");
  if (!ctx || ideal <= enAz) return ideal;
  const bandBas = Math.max(enAz, ideal - Math.round((ideal - enAz) * 0.3));
  const yukseklik = ideal - bandBas;
  if (yukseklik <= 0) return ideal;
  let veri: Uint8ClampedArray;
  try {
    veri = ctx.getImageData(0, bandBas, canvas.width, yukseklik).data;
  } catch {
    return ideal; // tuval okunamıyorsa (kirlendiyse) geometrik kes — PDF yine çıksın
  }
  const g = canvas.width;
  for (let satir = yukseklik - 1; satir >= 0; satir--) {
    let bos = true;
    // Her pikseli taramaya gerek yok: harf gövdesi iki pikselden geniş.
    for (let x = 0; x < g; x += 2) {
      const i = (satir * g + x) * 4;
      if (veri[i] < 245 || veri[i + 1] < 245 || veri[i + 2] < 245) { bos = false; break; }
    }
    if (bos) return bandBas + satir;
  }
  return ideal;
}

/**
 * Aynı sekmede PDF üretilirken sayfanın üstüne konan bekleme örtüsü.
 * Olmasaydı kullanıcı düğmeye basıp hiçbir şey olmadığını sanırdı.
 */
function bekleOrtusuAc(): HTMLElement {
  const ortu = document.createElement("div");
  ortu.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;"
    + "align-items:center;justify-content:center;gap:12px;background:rgba(255,255,255,.93);"
    + "font:16px/1.5 -apple-system,system-ui,sans-serif;color:#1E3A5F";
  const halka = document.createElement("div");
  halka.style.cssText = "width:34px;height:34px;border:3px solid #dbe3ec;border-top-color:#1E3A5F;"
    + "border-radius:50%;animation:evrakDon .8s linear infinite";
  const stil = document.createElement("style");
  stil.textContent = "@keyframes evrakDon{to{transform:rotate(360deg)}}";
  const yazi = document.createElement("div");
  yazi.textContent = "Evrak PDF'e çevriliyor…";
  ortu.append(stil, halka, yazi);
  document.body.appendChild(ortu);
  // GERİ DÖNÜLDÜĞÜNDE KALMASIN: Safari sayfayı bellekten geri yüklüyorsa (bfcache) DOM
  // olduğu gibi döner — örtü ekranı kaplamış halde karşılardı.
  window.addEventListener("pageshow", () => ortu.remove(), { once: true });
  return ortu;
}

// dosyaAdi: PDF'in kaydedilme adı (ör. "KAT-26/DİD.001 Hakediş") — uzantısız ver, ".pdf" eklenir.
// Verilmezse "evrak.pdf". Ad, isimli File nesnesiyle taşınır; çıplak Blob URL'si Safari'de
// "unknown.pdf" oluyordu.
export async function evrakYazdir(
  dosyaAdi?: string,
  secenek?: { /** PDF ayrı sekmede açılsın — sayfada kaydedilmemiş veri varsa ŞART. */ yeniSekme?: boolean },
): Promise<void> {
  if (!iosMu()) { window.print(); return; }
  const portal = document.querySelector<HTMLElement>(".evrak-print-portal");
  const hedef = portal?.querySelector<HTMLElement>(".evrak-onizleme") ?? portal;
  if (!portal || !hedef) { window.print(); return; }
  const yeniSekme = secenek?.yeniSekme === true;
  // Yeni sekme gerekiyorsa SENKRON aç (henüz kullanıcı jesti içindeyken) — adresi PDF hazır
  // olunca verilir. Beklemeden sonra açılsaydı Safari "otomatik açılan pencere" saydığı için
  // engellerdi. Aynı sekmede açılırken böyle bir kısıt yok, bekleme örtüyle gösterilir.
  const sekme = yeniSekme ? window.open("", "_blank") : null;
  const ortu = yeniSekme ? null : bekleOrtusuAc();
  // … ama BOŞ KALMASIN: kullanıcı bir süre bembeyaz "about:blank" görüyordu ve
  // bir şey açılmadı sanıyordu. PDF gelene kadar ne olduğunu yaz.
  if (sekme) {
    try {
      sekme.document.write(
        '<!doctype html><html lang="tr"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + "<title>Evrak hazırlanıyor</title><style>"
        + "body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;"
        + "font:16px/1.5 -apple-system,system-ui,sans-serif;color:#1E3A5F;background:#fff}"
        + ".k{text-align:center}"
        + ".d{width:34px;height:34px;margin:0 auto 14px;border:3px solid #dbe3ec;"
        + "border-top-color:#1E3A5F;border-radius:50%;animation:d .8s linear infinite}"
        + "@keyframes d{to{transform:rotate(360deg)}}</style></head>"
        + `<body><div class="k"><div class="d"></div>Evrak PDF'e çevriliyor…</div></body></html>`,
      );
      sekme.document.close();
    } catch { /* yazamıyorsak sekme boş kalır, PDF yine de gelir */ }
  }
  // Portal ekranda visibility:hidden !important (globals.css) — html2canvas gizli içeriği BOŞ çizer.
  // Geçici olarak görünür yap (yine ekran dışında, kullanıcı görmez); important şart (kural important).
  portal.style.setProperty("visibility", "visible", "important");
  // Evrağı YAZICININ gördüğü geometriye sok (bkz. globals.css .evrak-pdf-cikti):
  // kutunun kendi boşlukları sıfırlanır, sayfa boşluklarını aşağıda biz koyarız.
  portal.classList.add("evrak-pdf-cikti");
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const canvas = await html2canvas(hedef, {
      scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false,
      // HIZ — html2canvas çizeceği parçayı değil BELGENİN TAMAMINI kopyalıyor ve her
      // düğüm için :before/:after hesaplanmış stillerini ayrı ayrı soruyor. 100+ satırlık
      // yazışma listesinde bu tek başına 3,4 sn sürüyordu (ölçüldü; PDF'in kendisi 0,2 sn).
      // Telefon masaüstünden yavaş olduğu için bekleme oradan kat kat uzundu.
      // Yazdırma portalı dışındaki kök dalları kopyalama — çizime hiç girmiyorlar.
      ignoreElements: (el) => el.parentElement === document.body && !el.contains(hedef),
    });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    // Tuval artık SADECE içerik sütunu (165mm). Sayfa boşluklarını addImage'in konumu koyar.
    const pxPerMm = canvas.width / ICERIK_GENISLIK_MM;
    const sayfaPx = Math.round(ICERIK_YUKSEKLIK_MM * pxPerMm);
    let y = 0, sayfa = 0;
    while (y < canvas.height) {
      const kalan = canvas.height - y;
      // 3mm'den kısa artık gerçek içerik değil, yuvarlama payıdır → bomboş son sayfa açma.
      if (sayfa > 0 && kalan < pxPerMm * 3) break;
      // Sayfa dolacaksa kesimi satır arasına denk getir; son sayfada kesim yok.
      const h = kalan <= sayfaPx
        ? kalan
        : kesimNoktasi(canvas, y + sayfaPx, y + Math.round(sayfaPx * 0.5)) - y;
      const dilim = document.createElement("canvas");
      dilim.width = canvas.width; dilim.height = h;
      const ctx = dilim.getContext("2d");
      if (!ctx) throw new Error("canvas 2d yok");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, dilim.width, h);
      ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (sayfa > 0) pdf.addPage();
      pdf.addImage(dilim.toDataURL("image/jpeg", 0.92), "JPEG", YAN_MM, UST_MM, ICERIK_GENISLIK_MM, h / pxPerMm);
      y += h; sayfa++;
    }
    // Dosya adı: yasak karakterleri temizle ("sayı no konu" gibi / içerebilir) → isimli File.
    // Safari, File'lı object URL'de kaydet/paylaşta bu adı kullanır (çıplak Blob → "unknown.pdf").
    const ad = (dosyaAdi ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "evrak";
    const file = new File([pdf.output("blob")], `${ad}.pdf`, { type: "application/pdf" });
    const url = URL.createObjectURL(file);
    // Aynı sekmede: örtü yerinde kalsın, sayfa birazdan PDF'e gidiyor zaten.
    if (sekme && !sekme.closed) {
      sekme.location.href = url;
      ortu?.remove();
    } else {
      window.location.href = url; // (geri tuşu ile sayfaya dönülür)
      // EMNİYET: adres bir sebeple açılmazsa kullanıcı dönen halkanın altında KİLİTLİ kalır,
      // sayfaya dokunamaz. Açılırsa bu zamanlayıcı zaten sayfayla birlikte gider.
      setTimeout(() => ortu?.remove(), 6000);
    }
  } catch (e) {
    // SESSİZ DÜŞME YOK: PDF üretilemezse normal yazdırmaya geçilir ama kullanıcı bunu BİLMELİ.
    // 24.11.2026'da bu catch sessizdi: geçit değişikliği antet görselini başka kökene taşıyınca
    // toDataURL SecurityError atmaya başladı, iPhone'da PDF önizlemesi haftalarca açılmadı ve
    // ekranda hiçbir işaret yoktu — "yazdıra basıyorum bir şey olmuyor" diye fark edildi.
    const sebep = e instanceof Error ? e.message : String(e);
    console.error("[evrakYazdir] PDF üretilemedi:", e);
    try { sekme?.close(); } catch { /* yoksay */ }
    ortu?.remove();
    const { default: toast } = await import("react-hot-toast");
    toast.error(
      "Evrak PDF'e çevrilemedi, tarayıcının kendi yazdırması açılıyor "
      + "(sayfa kenarında adres/tarih damgası çıkabilir). Sebep: " + sebep,
      { duration: 10000 },
    );
    window.print();
  } finally {
    portal.classList.remove("evrak-pdf-cikti");
    portal.style.removeProperty("visibility");
  }
}
