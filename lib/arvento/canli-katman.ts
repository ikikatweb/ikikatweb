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
  kontak?: boolean | null; // kontak (ignition): açık=true → duruyorsa mavi, kapalı=false → kırmızı
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

// Bir önceki çizimdeki konum + son HAREKET zamanı (node bazlı). Arvento yön (nCourse) vermezse yönü
// buradan hesaplarız; ayrıca aracın en son ne zaman kımıldadığını izleyip "çalışmıyor" (uzun süre
// hareketsiz) tespiti yaparız (canlı feed kontak/ignition vermediği için en iyi yaklaşım budur).
const sonKonum = new Map<string, { lat: number; lng: number; sonHareket: number }>();
const CALISMIYOR_ESIK_MS = 20 * 60 * 1000; // bu süre boyunca hiç kımıldamayan araç "çalışmıyor" → kırmızı

// İki konum arası pusula yönü (derece, 0=kuzey, saat yönü). ~6 m altı kayma = GPS gürültüsü → null.
function yonHesap(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number | null {
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
  const mLat = dLat * 111320;
  const mLng = dLng * 111320 * Math.cos((a.lat * Math.PI) / 180);
  if (Math.hypot(mLat, mLng) < 6) return null; // gerçek hareket değil
  const f1 = (a.lat * Math.PI) / 180, f2 = (b.lat * Math.PI) / 180, dl = (dLng * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
    // Yön: Arvento nCourse (k.yon) varsa onu; yoksa bir önceki konuma göre hesapla (anlamlı kımıldadıysa).
    const anahtar = (k.node ?? `${k.lat},${k.lng}`).trim();
    const simdi = Date.now();
    const onceki = sonKonum.get(anahtar);
    const hesapYon = onceki ? yonHesap(onceki, { lat: k.lat, lng: k.lng }) : null;
    // Hareket: hız > 3 km/s VEYA son çizimden bu yana konum anlamlı kaydıysa (yavaş iş makineleri için).
    const hareket = (k.hiz ?? 0) > 3 || hesapYon != null;
    // Son hareket zamanını izle: hareket varsa (ya da ilk görülüyorsa) şimdi; yoksa öncekini koru.
    const sonHareket = (hareket || !onceki) ? simdi : onceki.sonHareket;
    sonKonum.set(anahtar, { lat: k.lat, lng: k.lng, sonHareket });
    const yon = k.yon ?? hesapYon;
    // "Çalışmıyor": uzun süredir hiç kımıldamadı (canlı feed kontak vermediği için hareket bazlı yaklaşım).
    const calismiyor = simdi - sonHareket > CALISMIYOR_ESIK_MS;
    // Renk: hareket=YEŞIL. Duruyorsa → kontak KAPALI ya da uzun süre HAREKETSİZ ise KIRMIZI; aksi halde MAVI.
    const renk = hareket ? "#16a34a" : ((k.kontak === false || calismiyor) ? "#dc2626" : "#2563eb");
    // Kalıcı etiket: plaka (kalın) + model (alt satır) — haritada hep görünür, Arvento'daki gibi.
    const etiket = `<span class="ce-plaka">${ad}</span>${model ? `<span class="ce-model">${model}</span>` : ""}`;
    // Hareket eden + yönü bilinen araç → gittiği yöne dönük OK; aksi halde (durağan/yön yok) nokta.
    const marker = (hareket && yon != null)
      ? L.marker([k.lat, k.lng], {
          pane: CANLI_PANE, // EN ÜST katman (damper ve KML'nin üstünde)
          icon: L.divIcon({
            className: "canli-ok-wrap",
            iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -11], // sabit boyut: 26px (zoom'dan bağımsız)
            // İç div yön kadar döner (Leaflet'in konum transform'una karışmaz). 0°=kuzey, saat yönü.
            html: `<div class="canli-ok" style="transform:rotate(${yon}deg)"><svg width="26" height="26" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M15 2 L23 25 L15 19.5 L7 25 Z" fill="${renk}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`,
          }),
        })
      : L.circleMarker([k.lat, k.lng], { pane: CANLI_PANE, radius: 6, color: "#ffffff", weight: 2, fillColor: renk, fillOpacity: 1 }); // ok ile orantılı
    marker
      .addTo(layer)
      .bindPopup(
        `<b>${ad}</b>${c ? "" : " <i>(eşlenmemiş)</i>"}${sof}<br>` +
        `${hareket ? "🟢 hareket" : (k.kontak === false ? "🔴 kontak kapalı" : calismiyor ? "🔴 çalışmıyor (uzun süre hareketsiz)" : "🔵 duruyor")} · ${k.hiz ?? 0} km/s${yon != null ? ` · ${Math.round(yon)}°` : ""}<br>` +
        `${formatSaat(k.tarih)}<br>${k.adres ?? ""}`,
      )
      .bindTooltip(etiket, { permanent: true, direction: "top", offset: [0, -9], className: "canli-etiket", opacity: 1, pane: CANLI_PANE });
  }
}

// Haritayı bir aracın ŞU ANKİ canlı konumuna (varsa) ya da güzergah noktalarına odaklar (sağ-tık "Araca odaklan").
// Canlı konum öncelikli (aracın o anki yeri); yoksa güzergaha fitBounds. Bulunamazsa false döner.
export function aracKonumunaOdaklan(
  map: LeafletMap,
  plaka: string,
  canli: { konumlar?: CanliKonum[]; cihazMap?: CihazMap },
  rotaNoktalari: { lat: number | null; lng: number | null }[] | undefined,
  plakaNorm: (p: string) => string,
): boolean {
  const n = plakaNorm(plaka);
  const c = (canli.konumlar ?? []).find((k) => {
    const p = k.node ? canli.cihazMap?.get(k.node.trim())?.plaka : null;
    return p != null && plakaNorm(p) === n && k.lat != null && k.lng != null;
  });
  if (c && c.lat != null && c.lng != null) {
    map.setView([c.lat, c.lng], Math.max(map.getZoom(), 16), { animate: true });
    return true;
  }
  const pts = (rotaNoktalari ?? [])
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => [p.lat as number, p.lng as number] as [number, number]);
  if (pts.length) { map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 }); return true; }
  return false;
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
