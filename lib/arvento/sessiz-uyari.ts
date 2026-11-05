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
    const satirlar = acik
      ? `<div style="background:#fff;color:#111;font-weight:400;max-height:190px;overflow:auto">`
        + liste.map((s, i) =>
            `<div class="su-satir" data-i="${i}" style="padding:4px 8px;border-top:1px solid #eee;${s.lat != null ? "cursor:pointer" : ""}">`
            + `<b>${kacir(s.plaka)}</b>${s.model ? ` <span style="color:#666">${kacir(s.model)}</span>` : ""}<br>`
            + `<span style="color:#b91c1c">${sessizSure(s.saat)}</span>`
            + `<span style="color:#666"> · son: ${sessizSonZaman(s.son)}</span>`
            + `</div>`).join("")
        + `<div style="padding:4px 8px;border-top:1px solid #eee;color:#666;font-size:10px">`
        + `${SESSIZ_ESIK_SAAT} saattir tek paket göndermeyen cihazlar. Satıra tıkla → son bilinen konum.</div>`
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
  }

  ciz();
  return {
    tazele: ciz,
    temizle: () => { try { map.removeControl(kontrol); } catch { /* harita zaten silinmiş */ } kutu = null; },
  };
}
