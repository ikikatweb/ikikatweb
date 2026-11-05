// HARİTA ÜZERİNDE "CİHAZ SUSTU" UYARISI.
//
// Takip cihazı veri göndermeyi kesen araç haritada hiç çizilmiyor — yani SESSİZCE yok oluyor;
// bakan kişi "o makine çalışmamış" sanıyor. (05.11.2026: trencher 34-00-25-5586 üç gün boyunca
// böyle kayboldu.) Bu kontrol sağ üstte kırmızı bir rozet çıkarır, tıklanınca hangi araçtan ne
// zamandır veri gelmediğini listeler; satıra tıklayınca aracın son bilinen konumuna gider.
import type { Map as LeafletMap } from "leaflet";
import { sessizSure, sessizSonZaman, SESSIZ_ESIK_SAAT, type SessizCihaz } from "@/lib/arvento/cihaz-sessiz";

type LeafletStatic = typeof import("leaflet");

const kacir = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function ekleSessizUyarisi(
  L: LeafletStatic,
  map: LeafletMap,
  veriGetir: () => SessizCihaz[],
  /** "beklemede" düğmesi — verilmezse düğme çizilmez (uyarı yalnız bilgi olarak kalır). */
  onBeklemede?: (s: SessizCihaz) => void,
): { tazele: () => void; temizle: () => void } {
  let kutu: HTMLDivElement | null = null;
  let acik = false;

  const Kontrol = L.Control.extend({
    options: { position: "topright" as const },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar sessiz-uyari") as HTMLDivElement;
      div.style.cssText = "background:#b91c1c;color:#fff;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.3);"
        + "font:600 11px/1.35 system-ui;overflow:hidden;max-width:260px;display:none";
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      kutu = div;
      return div;
    },
  });
  const kontrol = new Kontrol();
  map.addControl(kontrol);

  function ciz() {
    if (!kutu) return;
    const liste = veriGetir();
    if (liste.length === 0) { kutu.style.display = "none"; kutu.innerHTML = ""; acik = false; return; }
    kutu.style.display = "";
    const baslik = `<div class="su-baslik" style="padding:4px 8px;cursor:pointer;display:flex;align-items:center;gap:6px">`
      + `<span>⚠</span><span>${liste.length} araçtan veri gelmiyor</span>`
      + `<span style="opacity:.75;font-weight:400">${acik ? "▲" : "▼"}</span></div>`;
    // "BEKLEMEDE" DÜĞMESİ: araç zaten çalışmıyorsa (park) cihazın susması arıza değildir.
    // Basılınca o aracın O ANKİ son paket zamanı kaydedilir ve satır uyarıdan düşer; cihaz
    // tekrar konuşup sonra yine susarsa uyarı kendiliğinden geri gelir (bkz. cihaz-sessiz.ts).
    const dugme = (s: SessizCihaz, i: number) =>
      onBeklemede && s.node
        ? `<button class="su-bekle" data-i="${i}" title="Bu araç zaten çalışmıyor — uyarıyı gizle"`
          + ` style="flex:none;border:1px solid #d4d4d4;background:#f5f5f5;color:#444;border-radius:3px;`
          + `font:400 10px/1 system-ui;padding:3px 5px;cursor:pointer">beklemede</button>`
        : "";
    const satirlar = acik
      ? `<div style="background:#fff;color:#111;font-weight:400;max-height:190px;overflow:auto">`
        + liste.map((s, i) =>
            `<div style="padding:4px 8px;border-top:1px solid #eee;display:flex;align-items:center;gap:6px">`
            + `<div class="su-satir" data-i="${i}" style="flex:1 1 auto;min-width:0;${s.lat != null ? "cursor:pointer" : ""}">`
            + `<b>${kacir(s.plaka)}</b>${s.model ? ` <span style="color:#666">${kacir(s.model)}</span>` : ""}<br>`
            + `<span style="color:#b91c1c">${sessizSure(s.saat)}</span>`
            + `<span style="color:#666"> · son: ${sessizSonZaman(s.son)}</span>`
            + `</div>${dugme(s, i)}</div>`).join("")
        + `<div style="padding:4px 8px;border-top:1px solid #eee;color:#666;font-size:10px">`
        + `${SESSIZ_ESIK_SAAT} saattir tek paket göndermeyen cihazlar. Satıra tıkla → son bilinen konum.`
        + `${onBeklemede ? ` Çalışmayan araç için “beklemede”ye bas; cihaz tekrar susarsa uyarı geri gelir.` : ""}</div>`
        + `</div>`
      : "";
    kutu.innerHTML = baslik + satirlar;
    kutu.querySelector<HTMLDivElement>(".su-baslik")?.addEventListener("click", () => { acik = !acik; ciz(); });
    kutu.querySelectorAll<HTMLDivElement>(".su-satir").forEach((el) => {
      el.addEventListener("click", () => {
        const s = liste[Number(el.dataset.i)];
        if (s?.lat != null && s.lng != null) map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15), { animate: true });
      });
    });
    kutu.querySelectorAll<HTMLButtonElement>(".su-bekle").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();                       // satıra tıklanmış sayılmasın (haritayı kaydırmasın)
        const s = liste[Number(el.dataset.i)];
        if (!s) return;
        el.disabled = true;
        el.textContent = "…";
        onBeklemede?.(s);
      });
    });
  }

  ciz();
  return {
    tazele: ciz,
    temizle: () => { try { map.removeControl(kontrol); } catch { /* harita zaten silinmiş */ } kutu = null; },
  };
}
