// Evrak yazdırma — platforma göre iki yol:
//  - Masaüstü / Android: bilinen akış, window.print(). (@page margin:0 sayesinde Chrome alt bilgi basmaz.)
//  - iOS (iPhone/iPad): Safari, WEB SAYFASI yazdırmasına alt bilgi (sol altta URL, sağ altta tarih/sayfa)
//    DAMGALAR ve bunu kapatan bir ayar YOKTUR — @page margin:0 bile kaldırmıyor (içeriğin üstüne biner).
//    Tek temiz çözüm: evrağı PDF'e çevirip PDF'i açmak — PDF yazdırmada Safari damga basmaz.
//    Print portalı (.evrak-print-portal) globals.css sayesinde ekran DIŞINDA tam A4 layout'uyla zaten
//    hazır: html2canvas ile rasterize → jsPDF A4 → yeni sekmede aç (oradan Yazdır/Paylaş).

export function iosMu(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS kendini "Mac" gösterir
}

// dosyaAdi: PDF'in kaydedilme adı (ör. "KAT-26/DİD.001 Hakediş") — uzantısız ver, ".pdf" eklenir.
// Verilmezse "evrak.pdf". Ad, isimli File nesnesiyle taşınır; çıplak Blob URL'si Safari'de
// "unknown.pdf" oluyordu.
export async function evrakYazdir(dosyaAdi?: string): Promise<void> {
  if (!iosMu()) { window.print(); return; }
  const portal = document.querySelector<HTMLElement>(".evrak-print-portal");
  const hedef = portal?.querySelector<HTMLElement>(".evrak-onizleme") ?? portal;
  if (!portal || !hedef) { window.print(); return; }
  // Yeni sekmeyi SENKRON aç (henüz kullanıcı jesti içindeyken) — PDF hazır olunca adresi verilir.
  // Beklemeden sonra açılsaydı Safari "otomatik açılan pencere" saydığı için engellerdi.
  const sekme = window.open("", "_blank");
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
    const sayfaPx = Math.floor((canvas.width * 297) / 210); // bir A4 sayfasına düşen kaynak piksel yüksekliği
    let y = 0, sayfa = 0;
    while (y < canvas.height) {
      const kalan = canvas.height - y;
      // Evrak kutusu tam A4 boyunda (min-height 297mm); mm→px çevriminin yuvarlama artığı (birkaç
      // piksel-yarım cm) döngüde fazladan tur açıp BOMBOŞ ikinci sayfa üretiyordu. Bir sayfanın
      // %5'inden (≈15mm) küçük artık gerçek içerik olamaz (evrağın alt boşluğu zaten 2.5cm) → atla.
      if (sayfa > 0 && kalan < sayfaPx * 0.05) break;
      const h = Math.min(sayfaPx, kalan);
      const dilim = document.createElement("canvas");
      dilim.width = canvas.width; dilim.height = h;
      const ctx = dilim.getContext("2d");
      if (!ctx) throw new Error("canvas 2d yok");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, dilim.width, h);
      ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (sayfa > 0) pdf.addPage();
      pdf.addImage(dilim.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, (h * 210) / canvas.width);
      y += sayfaPx; sayfa++;
    }
    // Dosya adı: yasak karakterleri temizle ("sayı no konu" gibi / içerebilir) → isimli File.
    // Safari, File'lı object URL'de kaydet/paylaşta bu adı kullanır (çıplak Blob → "unknown.pdf").
    const ad = (dosyaAdi ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "evrak";
    const file = new File([pdf.output("blob")], `${ad}.pdf`, { type: "application/pdf" });
    const url = URL.createObjectURL(file);
    if (sekme && !sekme.closed) sekme.location.href = url;
    else window.location.href = url; // popup engellendiyse aynı sekmede aç (geri ile dönülür)
  } catch (e) {
    // SESSİZ DÜŞME YOK: PDF üretilemezse normal yazdırmaya geçilir ama kullanıcı bunu BİLMELİ.
    // 24.11.2026'da bu catch sessizdi: geçit değişikliği antet görselini başka kökene taşıyınca
    // toDataURL SecurityError atmaya başladı, iPhone'da PDF önizlemesi haftalarca açılmadı ve
    // ekranda hiçbir işaret yoktu — "yazdıra basıyorum bir şey olmuyor" diye fark edildi.
    const sebep = e instanceof Error ? e.message : String(e);
    console.error("[evrakYazdir] PDF üretilemedi:", e);
    try { sekme?.close(); } catch { /* yoksay */ }
    const { default: toast } = await import("react-hot-toast");
    toast.error(
      "Evrak PDF'e çevrilemedi, tarayıcının kendi yazdırması açılıyor "
      + "(sayfa kenarında adres/tarih damgası çıkabilir). Sebep: " + sebep,
      { duration: 10000 },
    );
    window.print();
  } finally {
    portal.style.removeProperty("visibility");
  }
}
