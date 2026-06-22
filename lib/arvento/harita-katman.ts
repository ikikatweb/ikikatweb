// Leaflet harita temel katmanları — Sokak (OpenStreetMap) ve Uydu (Esri World Imagery,
// Google Earth tarzı uydu görüntüsü). Reglaj/Stabilize/Serme/Sıkıştırma/Tümü haritalarında
// ortak kullanılır. Sağ üstte katman seçici (Uydu / Sokak + etiket) çıkar.
import type { Map as LeafletMap, Path } from "leaflet";
import { getHaritaKatmanlari } from "@/lib/supabase/queries/arvento-katman";

type LeafletStatic = typeof import("leaflet");

// Katman (z-index) sıralaması — ALTTAN ÜSTE: harita(tile ~200) < KML(420) < damper(marker 600) < canlı(640).
// Leaflet pane'leriyle kesinleştirilir; KML/canlı katmanları bu pane adlarını kullanır (ekleKayitliKatmanlar,
// canli-katman). Damperler varsayılan markerPane'de (600) → KML üstünde, canlının altında kalır.
export const KML_PANE = "kmlPane";
export const CANLI_PANE = "canliPane";
function panelleriKur(map: LeafletMap): void {
  if (!map.getPane(KML_PANE)) { const p = map.createPane(KML_PANE); p.style.zIndex = "420"; }
  if (!map.getPane(CANLI_PANE)) { const p = map.createPane(CANLI_PANE); p.style.zIndex = "640"; }
}

export function ekleHaritaKatmanlari(L: LeafletStatic, map: LeafletMap, varsayilan: "uydu" | "sokak" = "uydu"): void {
  panelleriKur(map);
  // maxZoom: haritanın çıkabileceği en üst zoom. maxNativeZoom: kaynağın gerçek karo sağladığı
  // son seviye — üstünde "veri yok" placeholder yerine son karo büyütülür (overzoom).
  const sokak = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap", maxZoom: 19, maxNativeZoom: 19,
  });
  // Esri World Imagery — Google Earth benzeri uydu görüntüsü (kırsalda ~18'e kadar karo var)
  const uydu = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Uydu: Esri, Maxar, Earthstar Geographics", maxZoom: 19, maxNativeZoom: 18,
  });
  // Uydu üzerine yol ÇİZGİLERİ (Esri) — yolların nerede olduğunu gösterir (etiket az)
  const etiketler = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 20, maxNativeZoom: 18,
  });
  // Uydu üzerine yol/yer İSİMLERİ — OpenStreetMap tabanlı şeffaf etiket katmanı (yol adları zengin,
  // beyaz haleli → uydu üzerinde okunur). Kırsal yol isimlerini bunda daha iyi görürsünüz.
  const isimler = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", {
    attribution: "Etiketler © OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 20, maxNativeZoom: 20,
  });
  if (varsayilan === "uydu") { uydu.addTo(map); etiketler.addTo(map); isimler.addTo(map); }
  else sokak.addTo(map);
  L.control.layers(
    { "🛰️ Uydu (Earth)": uydu, "🗺️ Sokak": sokak },
    { "Yol çizgileri": etiketler, "Yol/yer isimleri": isimler },
    { collapsed: true },
  ).addTo(map);
  ekleTamEkranKontrolu(L, map);
}

// Tam ekran butonu (sol üst) — haritayı tarayıcı Fullscreen API ile tam ekrana alır/çıkarır.
export function ekleTamEkranKontrolu(L: LeafletStatic, map: LeafletMap): void {
  const el = map.getContainer();
  let butonA: HTMLAnchorElement | null = null;
  const Buton = L.Control.extend({
    options: { position: "topleft" as const },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const a = L.DomUtil.create("a", "", div) as HTMLAnchorElement;
      a.href = "#"; a.title = "Tam ekran"; a.innerHTML = "⛶";
      a.style.cssText = "font-size:18px;line-height:30px;text-align:center;cursor:pointer";
      butonA = a;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, "click", (e) => {
        L.DomEvent.stop(e);
        if (document.fullscreenElement === el) document.exitFullscreen?.();
        else el.requestFullscreen?.().catch(() => { /* sessiz */ });
      });
      return div;
    },
  });
  map.addControl(new Buton());
  // Tam ekran değişiminde haritayı yeniden boyutlandır + buton ikonunu güncelle. Harita DOM'dan
  // kalkınca dinleyici kendini temizler (sızıntı olmaz).
  const handler = () => {
    if (!document.body.contains(el)) { document.removeEventListener("fullscreenchange", handler); return; }
    const tam = document.fullscreenElement === el;
    if (butonA) { butonA.innerHTML = tam ? "🗕" : "⛶"; butonA.title = tam ? "Tam ekrandan çık" : "Tam ekran"; }
    setTimeout(() => { try { map.invalidateSize(); } catch { /* sessiz */ } }, 120);
  };
  document.addEventListener("fullscreenchange", handler);
}

// Mesafe ölçüm kontrolü — sol üstte cetvel (📏) butonu. Tıklayınca ölçüm moduna girilir:
// haritaya tıklayarak nokta eklenir, çizgi ve canlı toplam (m/km) gösterilir; çift tıkla bitirilir.
// Çizgilerin (reglaj güzergahı vb.) boyunu ölçmek için kullanılır. Harici eklenti yok.
type LatLng = import("leaflet").LatLng;
type FareOlay = import("leaflet").LeafletMouseEvent;

export function ekleOlcumKontrolu(L: LeafletStatic, map: LeafletMap): void {
  let mod: "kapali" | "olcuyor" = "kapali";
  let noktalar: LatLng[] = [];
  const katman = L.layerGroup().addTo(map);
  let lastik: import("leaflet").Polyline | null = null; // imleci takip eden ön-izleme çizgisi
  let butonEl: HTMLAnchorElement | null = null;
  let kutuEl: HTMLDivElement | null = null;

  const fmt = (m: number) => (m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m");
  const toplam = (pts: LatLng[]) => {
    let t = 0;
    for (let i = 1; i < pts.length; i++) t += map.distance(pts[i - 1], pts[i]);
    return t;
  };

  // Cetvel butonu (sol üst, zoom altında)
  const Buton = L.Control.extend({
    options: { position: "topleft" as const },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const a = L.DomUtil.create("a", "", div) as HTMLAnchorElement;
      a.href = "#";
      a.title = "Mesafe ölç";
      a.innerHTML = "📏";
      a.style.cssText = "font-size:16px;line-height:30px;text-align:center;cursor:pointer";
      butonEl = a;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, "click", (e) => { L.DomEvent.stop(e); butonaTikla(); });
      return div;
    },
  });
  map.addControl(new Buton());

  // Sonuç/yardım kutusu (sol alt)
  const Kutu = L.Control.extend({
    options: { position: "bottomleft" as const },
    onAdd() {
      const d = L.DomUtil.create("div", "olcum-kutu") as HTMLDivElement;
      d.style.cssText = "display:none;background:rgba(30,58,95,.92);color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:240px";
      kutuEl = d;
      L.DomEvent.disableClickPropagation(d);
      return d;
    },
  });
  map.addControl(new Kutu());

  function kutuyuGuncelle(provizyonel?: number) {
    if (!kutuEl) return;
    if (mod === "kapali") { kutuEl.style.display = "none"; return; }
    const t = provizyonel != null ? provizyonel : toplam(noktalar);
    const ip = "Tıkla: ekle · Son noktaya tıkla: geri al · 📏: temizle";
    kutuEl.style.display = "block";
    kutuEl.innerHTML = `<b style="font-size:14px">${noktalar.length >= 2 || provizyonel != null ? fmt(t) : "0 m"}</b><br><span style="opacity:.85">${ip}</span>`;
  }

  function butonGorunumu() {
    if (!butonEl) return;
    const aktif = mod !== "kapali";
    butonEl.style.background = aktif ? "#1E3A5F" : "";
    butonEl.style.color = aktif ? "#fff" : "";
    butonEl.title = aktif ? "Ölçümü temizle" : "Mesafe ölç";
  }

  function ciz() {
    katman.clearLayers();
    lastik = null;
    if (noktalar.length >= 2) {
      L.polyline(noktalar, { color: "#facc15", weight: 3, opacity: 0.95, dashArray: "6 4" }).addTo(katman);
    }
    noktalar.forEach((p) =>
      L.circleMarker(p, { radius: 4, color: "#fff", weight: 2, fillColor: "#ca8a04", fillOpacity: 1 }).addTo(katman),
    );
  }

  function lastikTemizle() { if (lastik) { katman.removeLayer(lastik); lastik = null; } }

  function tikla(e: FareOlay) {
    // Son noktanın üzerine (≈12 px) tekrar tıklanırsa o noktayı GERİ AL (sil).
    if (noktalar.length > 0) {
      const sonPx = map.latLngToContainerPoint(noktalar[noktalar.length - 1]);
      const tikPx = map.latLngToContainerPoint(e.latlng);
      if (sonPx.distanceTo(tikPx) <= 12) { noktalar.pop(); ciz(); kutuyuGuncelle(); return; }
    }
    noktalar.push(e.latlng);
    ciz();
    kutuyuGuncelle();
  }
  function hareket(e: FareOlay) {
    if (mod !== "olcuyor" || noktalar.length === 0) return;
    lastikTemizle();
    const son = noktalar[noktalar.length - 1];
    lastik = L.polyline([son, e.latlng], { color: "#facc15", weight: 2, opacity: 0.6, dashArray: "4 4" }).addTo(katman);
    kutuyuGuncelle(toplam(noktalar) + map.distance(son, e.latlng));
  }

  function basla() {
    mod = "olcuyor";
    noktalar = [];
    katman.clearLayers();
    map.doubleClickZoom.disable();
    L.DomUtil.addClass(map.getContainer(), "olcum-modu");
    map.on("click", tikla);
    map.on("mousemove", hareket);
    butonGorunumu();
    kutuyuGuncelle();
  }
  function temizle() {
    mod = "kapali";
    noktalar = [];
    katman.clearLayers();
    lastik = null;
    map.doubleClickZoom.enable();
    L.DomUtil.removeClass(map.getContainer(), "olcum-modu");
    map.off("click", tikla);
    map.off("mousemove", hareket);
    butonGorunumu();
    kutuyuGuncelle();
  }
  function butonaTikla() { if (mod === "kapali") basla(); else temizle(); }
}

// Tanımlamalar'dan eklenmiş kalıcı katmanları (NetCAD/KML çizgileri) haritaya çizer.
// Tüm Arvento haritalarında çağrılır; veri yoksa/tabloyoksa sessizce geçer.
// Yol/çizgi isimlerinin (kalıcı etiketler) görüneceği EN DÜŞÜK zoom. Bu seviyenin ALTINDA (uzaklaşınca)
// etiketler gizlenir → harita çizgilerini/yollarını kapatmaz. Yakınlaşınca isimler çıkar. (Gerekirse ayarlanır.)
const ETIKET_MIN_ZOOM = 16;

export async function ekleKayitliKatmanlar(L: LeafletStatic, map: LeafletMap): Promise<void> {
  // Zoom'a göre etiket görünürlüğü: eşik altında map container'a sınıf eklenir, CSS o etiketleri gizler.
  const etiketGorunurluk = () => map.getContainer().classList.toggle("etiketleri-gizle", map.getZoom() < ETIKET_MIN_ZOOM);
  map.on("zoomend", etiketGorunurluk);
  etiketGorunurluk();
  // Tıklanan yolu vurgula — seçili yol KIRMIZI + kalınlaşır (baştan sona belli olur). Başka yola
  // tıklayınca öncekisi eskiye döner; aynı yola tekrar tıklayınca seçim kalkar (toggle).
  const SECIM_RENK = "#ff2d2d";
  type Stil = { color: string; weight: number; opacity: number };
  let secili: { yol: Path; stil: Stil } | null = null;
  const vurgula = (yol: Path, stil: Stil) => {
    if (secili) secili.yol.setStyle(secili.stil);            // öncekini sıfırla
    if (secili?.yol === yol) { secili = null; return; }      // aynı yol → seçimi kaldır
    yol.setStyle({ color: SECIM_RENK, weight: stil.weight + 3, opacity: 1 });
    yol.bringToFront();
    secili = { yol, stil };
  };
  // Boş alana (harita arka planı) tıklayınca seçimi kaldır. Leaflet'te bir yola tıklamak map "click"
  // olayını tetiklemez (interaktif katman olayı tüketir) → yol seçimi bu yüzden anında kapanmaz.
  map.on("click", () => { if (secili) { secili.yol.setStyle(secili.stil); secili = null; } });
  try {
    const katmanlar = await getHaritaKatmanlari();
    for (const k of katmanlar) {
      if (!k.gorunur) continue;
      const kalinlik = k.kalinlik ?? 3;
      for (const g of k.geometriler ?? []) {
        const baslik = `<b>${k.ad}</b>${g.ad ? " · " + g.ad : ""}`;
        const etiket = (g.ad || k.ad || "").trim(); // KALICI etiket içeriği (yol/çizgi adı)
        // Kalıcı (her zaman görünür) etiket — tıklamadan ismi gösterir. Boşsa eklenmez.
        const tipTooltip = (dir: "center" | "top") =>
          etiket ? { permanent: true as const, direction: dir, className: "yol-etiket", opacity: 1, pane: KML_PANE } : null;
        if (g.tip === "nokta") {
          const p = g.noktalar[0];
          if (!p) continue;
          const m = L.circleMarker(p, { radius: kalinlik + 2, color: "#fff", weight: 2, fillColor: k.renk, fillOpacity: 1, pane: KML_PANE, className: "kml-nokta" })
            .addTo(map).bindPopup(baslik);
          const tt = tipTooltip("top"); if (tt) m.bindTooltip(etiket, tt);
        } else if (g.tip === "alan") {
          // Alan (polygon) isimleri haritada gösterilmez — gerek yok. (Ada tıklayınca popup ile görünür.)
          const m = L.polygon(g.noktalar, { color: k.renk, weight: kalinlik, opacity: 0.9, fillColor: k.renk, fillOpacity: 0.12, pane: KML_PANE })
            .addTo(map).bindPopup(baslik);
          m.on("click", () => vurgula(m, { color: k.renk, weight: kalinlik, opacity: 0.9 }));
        } else {
          const m = L.polyline(g.noktalar, { color: k.renk, weight: kalinlik, opacity: 0.9, pane: KML_PANE })
            .addTo(map).bindPopup(baslik);
          m.on("click", () => vurgula(m, { color: k.renk, weight: kalinlik, opacity: 0.9 }));
          const tt = tipTooltip("center"); if (tt) m.bindTooltip(etiket, tt);
        }
      }
    }
  } catch {
    /* katman çizimi haritayı bozmasın */
  }
}
