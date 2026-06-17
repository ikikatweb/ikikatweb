// Leaflet harita temel katmanları — Sokak (OpenStreetMap) ve Uydu (Esri World Imagery,
// Google Earth tarzı uydu görüntüsü). Reglaj/Stabilize/Serme/Sıkıştırma/Tümü haritalarında
// ortak kullanılır. Sağ üstte katman seçici (Uydu / Sokak + etiket) çıkar.
import type { Map as LeafletMap } from "leaflet";

type LeafletStatic = typeof import("leaflet");

export function ekleHaritaKatmanlari(L: LeafletStatic, map: LeafletMap, varsayilan: "uydu" | "sokak" = "uydu"): void {
  // maxZoom: haritanın çıkabileceği en üst zoom. maxNativeZoom: kaynağın gerçek karo sağladığı
  // son seviye — üstünde "veri yok" placeholder yerine son karo büyütülür (overzoom).
  const sokak = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap", maxZoom: 19, maxNativeZoom: 19,
  });
  // Esri World Imagery — Google Earth benzeri uydu görüntüsü (kırsalda ~18'e kadar karo var)
  const uydu = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Uydu: Esri, Maxar, Earthstar Geographics", maxZoom: 19, maxNativeZoom: 18,
  });
  // Uydu üzerine yol/yer adı etiketleri (hibrit görünüm)
  const etiketler = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, maxNativeZoom: 18,
  });
  if (varsayilan === "uydu") { uydu.addTo(map); etiketler.addTo(map); }
  else sokak.addTo(map);
  L.control.layers(
    { "🛰️ Uydu (Earth)": uydu, "🗺️ Sokak": sokak },
    { "Yol/yer etiketleri": etiketler },
    { collapsed: true },
  ).addTo(map);
}
