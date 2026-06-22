// Canlı araç konumlarını HERHANGİ bir Arvento haritasının üzerine ayrı bir Leaflet
// katmanı (LayerGroup) olarak bindirir. Temel harita yeniden kurulmadan, yalnız bu
// katman güncellenir → "Canlı" butonu açıkken araçlar periyodik olarak tazelenir.
import { useEffect, type RefObject } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { CANLI_PANE } from "@/lib/arvento/harita-katman";

type LeafletStatic = typeof import("leaflet");

export type CanliKonum = {
  node: string | null;
  lat: number | null;
  lng: number | null;
  hiz: number | null;
  yon: number | null; // gidiş yönü (derece, 0=kuzey, saat yönü) — hareket eden araçta ok için
  tarih: string | null;
  adres: string | null;
};
export type CihazBilgi = { plaka: string | null; surucu: string | null; model?: string | null };

// Harita görünümü (merkez + zoom) — sekmeler arası PAYLAŞILAN görünüm hafızası için.
export type HaritaGorunum = { merkez: [number, number]; zoom: number };
export type CihazMap = Map<string, CihazBilgi>;

function formatSaat(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Katmanı temizleyip güncel konumlarla yeniden doldurur.
export function cizCanliKatman(L: LeafletStatic, layer: LayerGroup, konumlar: CanliKonum[], cihazMap?: CihazMap): void {
  layer.clearLayers();
  for (const k of konumlar) {
    if (k.lat == null || k.lng == null) continue;
    const c = k.node ? cihazMap?.get(k.node.trim()) : undefined;
    const ad = c?.plaka ?? k.node ?? "—";
    const model = c?.model?.trim();
    const sof = c?.surucu ? ` · ${c.surucu}` : "";
    const hareket = (k.hiz ?? 0) > 3;
    const renk = hareket ? "#16a34a" : "#dc2626"; // hareket=yeşil, durağan=kırmızı
    // Kalıcı etiket: plaka (kalın) + model (alt satır) — haritada hep görünür, Arvento'daki gibi.
    const etiket = `<span class="ce-plaka">${ad}</span>${model ? `<span class="ce-model">${model}</span>` : ""}`;
    // Hareket eden + yönü bilinen araç → gittiği yöne dönük OK; aksi halde nokta.
    const marker = (hareket && k.yon != null)
      ? L.marker([k.lat, k.lng], {
          pane: CANLI_PANE, // EN ÜST katman (damper ve KML'nin üstünde)
          icon: L.divIcon({
            className: "canli-ok-wrap",
            iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -12],
            // İç div yön kadar döner (Leaflet'in konum transform'una karışmaz). 0°=kuzey, saat yönü.
            html: `<div class="canli-ok" style="transform:rotate(${k.yon}deg)"><svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 2 L23 25 L15 19.5 L7 25 Z" fill="${renk}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`,
          }),
        })
      : L.circleMarker([k.lat, k.lng], { pane: CANLI_PANE, radius: 7, color: "#ffffff", weight: 2, fillColor: renk, fillOpacity: 1 });
    marker
      .addTo(layer)
      .bindPopup(
        `<b>${ad}</b>${c ? "" : " <i>(eşlenmemiş)</i>"}${sof}<br>` +
        `${hareket ? "🟢 hareket" : "🔴 durağan"} · ${k.hiz ?? 0} km/s${k.yon != null ? ` · ${Math.round(k.yon)}°` : ""}<br>` +
        `${formatSaat(k.tarih)}<br>${k.adres ?? ""}`,
      )
      .bindTooltip(etiket, { permanent: true, direction: "top", offset: [0, -9], className: "canli-etiket", opacity: 1, pane: CANLI_PANE });
  }
}

// Harita kurulduktan sonra çağrılır: canlı LayerGroup oluşturup haritaya ekler, ilk çizimi yapar.
export function canliKatmanKur(L: LeafletStatic, map: LeafletMap, konumlar: CanliKonum[] | undefined, cihazMap?: CihazMap): LayerGroup {
  const layer = L.layerGroup().addTo(map);
  cizCanliKatman(L, layer, konumlar ?? [], cihazMap);
  return layer;
}

// Canlı veri değişince (her yenileme) yalnız katmanı tazeleyen hook — temel haritaya dokunmaz.
export function useCanliKatman(
  layerRef: RefObject<LayerGroup | null>,
  konumlar: CanliKonum[] | undefined,
  cihazMap: CihazMap | undefined,
): void {
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    let iptal = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!iptal && layerRef.current) cizCanliKatman(L, layerRef.current, konumlar ?? [], cihazMap);
    })();
    return () => { iptal = true; };
  }, [layerRef, konumlar, cihazMap]);
}
