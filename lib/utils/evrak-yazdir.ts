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

export async function evrakYazdir(): Promise<void> {
  if (!iosMu()) { window.print(); return; }
  const portal = document.querySelector<HTMLElement>(".evrak-print-portal");
  const hedef = portal?.querySelector<HTMLElement>(".evrak-onizleme") ?? portal;
  if (!portal || !hedef) { window.print(); return; }
  // Yeni sekmeyi SENKRON aç (henüz kullanıcı jesti içindeyken) — PDF hazır olunca adresi verilir.
  const sekme = window.open("", "_blank");
  // Portal ekranda visibility:hidden !important (globals.css) — html2canvas gizli içeriği BOŞ çizer.
  // Geçici olarak görünür yap (yine ekran dışında, kullanıcı görmez); important şart (kural important).
  portal.style.setProperty("visibility", "visible", "important");
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const canvas = await html2canvas(hedef, { scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const sayfaPx = Math.floor((canvas.width * 297) / 210); // bir A4 sayfasına düşen kaynak piksel yüksekliği
    let y = 0, sayfa = 0;
    while (y < canvas.height) {
      const h = Math.min(sayfaPx, canvas.height - y);
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
    const url = URL.createObjectURL(pdf.output("blob"));
    if (sekme && !sekme.closed) sekme.location.href = url;
    else window.location.href = url; // popup engellendiyse aynı sekmede aç (geri ile dönülür)
  } catch {
    // PDF üretilemedi (ör. görsel CORS engeli) → normal yazdırmaya düş: alt bilgili de olsa çalışsın.
    try { sekme?.close(); } catch { /* yoksay */ }
    window.print();
  } finally {
    portal.style.removeProperty("visibility");
  }
}
