// z11–z13 ARASINDA YERLEŞİM ADLARINI KENDİMİZ YAZAN KATMAN.
//
// Uydu etiket kaynağı (Esri) adları kendi kademesine göre açıyor ve ŞEHİR MAHALLELERİ z11'de
// başlıyor: 10–20 km'lik görüntüde Tokat'ın çevresi Yeniyurt/Çağgölü/Mahmutpaşa ile doluyor,
// şehrin kendi adı aralarında kayboluyordu. Kaynağı "geriden" çizerek bastırmak (zoomOffset)
// z13'te yazıyı 8 kat büyütüp bulanıklaştırıyor. Bu yüzden o bantta kaynağı kapatıp adları
// buradan yazıyoruz; mahalle adları z14'te yine Esri'den, net olarak gelir.
//
// NE GÖSTERİLİR: il merkezi + ilçe (paket içinde, yerlesim-tr.ts) ve KÖY (public/veri/koyler-tr.json,
// 37 bin kayıt → ilk gerek duyulduğunda indirilir). Köy önemli: makineler tarlada çalışıyor, orada
// "burası neresi" sorusunun cevabı köy adıdır. Şehir mahalleleri bu veride YOK (OSM'de ayrı tür).
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { YERLESIMLER } from "@/lib/arvento/yerlesim-tr";

type LeafletStatic = typeof import("leaflet");

/** Bu aralıkta (dahil) kendi adlarımız çizilir; dışında Esri katmanı devrededir. */
export const YERLESIM_EN_AZ_ZOOM = 11;
export const YERLESIM_EN_COK_ZOOM = 13;
/** Köy adları bu zoomdan itibaren eklenir — z11'de (≈20 km) onlarca köy adı kalabalık yapıyor. */
const KOY_EN_AZ_ZOOM = 12;
/** Ekranda en çok kaç ad yazılsın — uzakta daha az, yaklaştıkça daha çok (okunabilirlik).
 *  z11 ≈ 20 km'lik görüntü: 70 köy adı üst üste binip okunmaz oluyordu. */
const EN_COK_AD: Record<number, number> = { 11: 30, 12: 50, 13: 70 };

type Koy = [string, number, number];
let koyler: Koy[] | null = null;
let koyIstek: Promise<void> | null = null;

function koyleriYukle(): Promise<void> {
  if (koyIstek) return koyIstek;
  koyIstek = fetch("/veri/koyler-tr.json", { cache: "force-cache" })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => { koyler = Array.isArray(d) ? (d as Koy[]) : []; })
    .catch((e) => {
      // Köy listesi gelmezse harita ÇALIŞMAYA DEVAM ETSİN: il/ilçe adları yine yazılır.
      // Sessiz geçmiyoruz — konsolda sebebi görünsün, "köy adları neden yok" sorusu cevapsız kalmasın.
      console.warn("[yerleşim] köy listesi indirilemedi, yalnız il/ilçe adları yazılacak:", e?.message ?? e);
      koyler = [];
    });
  return koyIstek;
}

export function ekleYerlesimAdlari(L: LeafletStatic, map: LeafletMap): () => void {
  // Kendi pane'i: KML/rota çizgilerinin üstünde ama canlı araç markerlarının altında.
  const PANE = "yerlesimPane";
  if (!map.getPane(PANE)) {
    const p = map.createPane(PANE);
    p.style.zIndex = "620";
    p.style.pointerEvents = "none"; // yazılar tıklamayı engellemesin (altındaki rota tıklanır)
  }
  const grup: LayerGroup = L.layerGroup([], { pane: PANE }).addTo(map);
  let atif = false;
  let kapandi = false;

  function yaz(ad: string, lat: number, lng: number, buyuk: boolean) {
    L.marker([lat, lng], {
      pane: PANE,
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "yerlesim-ad",
        iconSize: [0, 0], // boyutu içerik belirlesin; çapa tam koordinatta kalsın
        html: `<span class="ya-nokta"></span><span class="ya-yazi${buyuk ? " ya-buyuk" : ""}">${
          ad.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        }</span>`,
      }),
    }).addTo(grup);
  }

  function ciz() {
    if (kapandi) return;
    grup.clearLayers();
    const z = map.getZoom();
    if (z < YERLESIM_EN_AZ_ZOOM || z > YERLESIM_EN_COK_ZOOM) return;
    const sinir = map.getBounds().pad(0.15); // kenara yakın adlar da çizilsin
    const sinirAdet = EN_COK_AD[z] ?? 50;
    let sayi = 0;
    for (const [ad, lat, lng, tip] of YERLESIMLER) {
      if (!sinir.contains([lat, lng])) continue;
      if (++sayi > sinirAdet) break;
      yaz(ad, lat, lng, tip === 0);
    }
    // KÖYLER — z12+'da, ayrıca z11'de ekranda HİÇ ad yoksa (kırsalda boş ekran kalmasın).
    const koyGerek = z >= KOY_EN_AZ_ZOOM || sayi === 0;
    if (koyGerek) {
      if (koyler === null) { koyleriYukle().then(() => { if (!kapandi) ciz(); }); }
      else {
        for (const [ad, lat, lng] of koyler) {
          if (!sinir.contains([lat, lng])) continue;
          if (++sayi > sinirAdet) break;
          yaz(ad, lat, lng, false);
        }
      }
    }
    if (sayi > 0 && !atif) {
      // OSM verisi (ODbL) → atıf zorunlu. Yalnız bir kez ve adlar gerçekten çizilince eklenir.
      try { map.attributionControl.addAttribution("Yerleşim adları © OpenStreetMap"); atif = true; } catch { /* atıf kontrolü kapalı olabilir */ }
    }
  }

  ciz();
  map.on("moveend zoomend", ciz);
  return () => {
    kapandi = true;
    map.off("moveend zoomend", ciz);
    try { map.removeLayer(grup); } catch { /* harita zaten silinmiş */ }
    if (atif) { try { map.attributionControl.removeAttribution("Yerleşim adları © OpenStreetMap"); } catch { /* yok say */ } }
  };
}
