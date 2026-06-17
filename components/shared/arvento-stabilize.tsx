// Arvento Stabilize sekmesi — KAMYONLARIN damper indirmelerini gösterir.
// Plaka seçici kamyonları listeler; seçilen kamyonun (veya tüm kamyonların) damper
// noktaları haritada turuncu yuvarlak olarak çizilir. Greyder REGLAJ çizgileri arka
// planda referans olarak durur — damperler bu çizgilerin üstüne düşerse üzerinde görünür.
//
// Damper: arac_arvento_rapor.damper_olaylar (kamyonlar). Çizgi: arac_arvento_guzergah (greyder).
// Çizgi tekrar eşiği (Tanımlamalar) ile sadeleşir; harita uydu (Google Earth) görünümünde.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByTarih, getArventoRaporByTarih } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari } from "@/lib/arvento/harita-katman";
import { sinifEslesir } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Layers, Download, MapPin, X } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

type DamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
type DamperNokta = DamperOlay & { plaka: string };

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function damperOlaylariniAl(r: AracArventoRapor): DamperOlay[] {
  return (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[];
}

export default function ArventoStabilize({ tarih, tekrarEsigi = 0, gridMesafe = 12, guzergahMesafe = 30, refreshKey = 0 }: { tarih: string; tekrarEsigi?: number; gridMesafe?: number; guzergahMesafe?: number; refreshKey?: number }) {
  const [tumGuzergah, setTumGuzergah] = useState<AracArventoGuzergah[]>([]); // reglaj çizgileri (referans)
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);          // kamyon damper olayları
  const [seciliPlaka, setSeciliPlaka] = useState(""); // "" = tüm kamyonlar
  const [loading, setLoading] = useState(true);
  const [tumHaritaAcik, setTumHaritaAcik] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const tumMapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tarih) { setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([getGuzergahByTarih(tarih), getArventoRaporByTarih(tarih)])
      .then(([g, r]) => { setTumGuzergah(g); setRaporlar(r); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => setLoading(false));
  }, [tarih, refreshKey]);

  // Referans çizgiler: greyder (reglaj) güzergahları
  const greyderler = useMemo(() => tumGuzergah.filter((k) => sinifEslesir(k.arac_sinifi, "reglaj", k.plaka)), [tumGuzergah]);

  // Damper indiren kamyonlar (damper_olaylar veya damper_sayisi olan araçlar)
  const kamyonlar = useMemo(
    () => raporlar.filter((r) => damperOlaylariniAl(r).length > 0 || (r.damper_sayisi ?? 0) > 0),
    [raporlar],
  );

  // Seçili kamyon listede yoksa "tümü"ne (boş) düş
  useEffect(() => {
    setSeciliPlaka((prev) => (prev && kamyonlar.some((r) => r.plaka === prev) ? prev : ""));
  }, [kamyonlar]);

  // Gösterilecek damper noktaları: seçili kamyon (boşsa tüm kamyonlar)
  const damperOlaylar = useMemo<DamperNokta[]>(() => {
    const out: DamperNokta[] = [];
    for (const r of kamyonlar) {
      if (seciliPlaka && r.plaka !== seciliPlaka) continue;
      for (const o of damperOlaylariniAl(r)) out.push({ ...o, plaka: r.plaka });
    }
    return out;
  }, [kamyonlar, seciliPlaka]);

  const damperKoordlu = useMemo(() => damperOlaylar.filter((o) => o.lat != null && o.lng != null), [damperOlaylar]);

  // Harita: greyder çizgileri (referans) + kamyon damper yuvarlakları
  useEffect(() => {
    if (!tarih) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      map = L.map(mapRef.current).setView([39, 35], 6);
      ekleHaritaKatmanlari(L, map, "uydu");
      const bounds: [number, number][] = [];
      // Reglaj çizgileri (greyder) — arka plan referansı
      greyderler.forEach((k) => {
        const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) return;
        const cizim: [number, number][][] = gridMesafe > 0
          ? sadelesGuzergah(noktalar, tekrarEsigi, gridMesafe, guzergahMesafe).parcalar
          : [latlngs];
        L.polyline(cizim.length ? cizim : [latlngs], { color: "#2563eb", weight: 3, opacity: 0.6 })
          .addTo(map!).bindPopup(`<b>${k.plaka}</b> (reglaj çizgisi)<br>${k.arac_sinifi ?? ""}`);
        for (const ll of latlngs) bounds.push(ll);
      });
      // Kamyon damperleri — üst katman
      damperKoordlu.forEach((o, i) => {
        const lat = o.lat as number, lng = o.lng as number;
        L.circleMarker([lat, lng], { radius: 8, color: "#9a3412", fillColor: "#f97316", fillOpacity: 0.9, weight: 2 })
          .addTo(map!)
          .bindPopup(`<b>🔻 ${o.plaka}</b> · Damper ${i + 1}<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
        bounds.push([lat, lng]);
      });
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return () => { iptal = true; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [tarih, greyderler, damperKoordlu, tekrarEsigi, gridMesafe, guzergahMesafe]);

  // Tam ekran modal — aynı içerik (referans çizgiler + damperler)
  useEffect(() => {
    if (!tumHaritaAcik) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !tumMapRef.current) return;
      map = L.map(tumMapRef.current).setView([39, 35], 6);
      ekleHaritaKatmanlari(L, map, "uydu");
      const bounds: [number, number][] = [];
      greyderler.forEach((k) => {
        const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) return;
        const cizim: [number, number][][] = gridMesafe > 0
          ? sadelesGuzergah(noktalar, tekrarEsigi, gridMesafe, guzergahMesafe).parcalar
          : [latlngs];
        L.polyline(cizim.length ? cizim : [latlngs], { color: "#2563eb", weight: 3, opacity: 0.55 }).addTo(map!);
        for (const ll of latlngs) bounds.push(ll);
      });
      damperKoordlu.forEach((o) => {
        L.circleMarker([o.lat as number, o.lng as number], { radius: 6, color: "#9a3412", fillColor: "#f97316", fillOpacity: 0.9, weight: 1 })
          .addTo(map!).bindPopup(`<b>🔻 ${o.plaka}</b><br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
        bounds.push([o.lat as number, o.lng as number]);
      });
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 200);
    })();
    return () => { iptal = true; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [tumHaritaAcik, greyderler, damperKoordlu, tekrarEsigi, gridMesafe, guzergahMesafe]);

  // KML: kamyon damper noktaları (+ referans greyder çizgileri)
  function exportKML() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cizgiler = greyderler.map((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return "";
      const coords = noktalar.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      return `
    <Placemark><name>${esc(k.plaka)} reglaj</name><styleUrl>#rota</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }).join("");
    const damperPlacemarks = damperKoordlu.map((o, i) => `
    <Placemark><name>${esc(o.plaka)} damper ${i + 1}</name><description>${esc([o.saat ?? "", o.adres ?? ""].filter(Boolean).join(" · "))}</description><styleUrl>#damper</styleUrl><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`).join("");
    if (!cizgiler && !damperPlacemarks) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `Stabilize ${tarih}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>
    <Style id="rota"><LineStyle><color>ffeb6326</color><width>4</width></LineStyle></Style>
    <Style id="damper"><IconStyle><color>ff167cf9</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>${cizgiler}${damperPlacemarks}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Stabilize KML olarak indirildi.", { duration: toastSuresi() });
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!tarih) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Layers size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">Yukarıdan bir tarih seçin.</p>
      </div>
    );
  }
  if (kamyonlar.length === 0 && greyderler.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Layers size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">
          {formatTarih(tarih)} için kamyon damper verisi ya da reglaj çizgisi yok.
          <br />Damper (Genel) raporunu ve/veya greyder Mesafe Bilgisi raporunu yükleyin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filtre: Kamyon seçici + özet + butonlar */}
      <div className="bg-white rounded-lg border p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Kamyon (Damper)</Label>
          <select value={seciliPlaka} onChange={(e) => setSeciliPlaka(e.target.value)} className={selectClass + " min-w-[180px]"}>
            <option value="">Tüm kamyonlar ({kamyonlar.length})</option>
            {kamyonlar.map((r) => (
              <option key={r.plaka} value={r.plaka}>{r.plaka}{r.marka ? ` · ${r.marka}` : ""}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div className="text-xs text-gray-600 text-right leading-relaxed">
            <div className="text-gray-400">
              <span className="inline-block w-3 h-1 rounded align-middle mr-1" style={{ background: "#2563eb", opacity: 0.6 }} />
              {greyderler.length} reglaj çizgisi (referans)
            </div>
            <div>
              <span className="text-orange-600 font-semibold">🔻 {damperKoordlu.length} damper</span>
              {damperOlaylar.length > damperKoordlu.length && (
                <span className="text-gray-400"> (+{damperOlaylar.length - damperKoordlu.length} konumsuz)</span>
              )}
              {seciliPlaka && <span className="text-gray-500"> · {seciliPlaka}</span>}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTumHaritaAcik(true)} disabled={kamyonlar.length === 0 && greyderler.length === 0}
            className="h-9 gap-1 text-xs" title="Tam ekranda göster">
            <MapPin size={14} /> Tümünü Haritada Göster
          </Button>
          <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
            <Download size={14} /> KML İndir
          </Button>
        </div>
      </div>

      {/* Harita */}
      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "60vh" }} />

      {/* Damper indirme listesi (gösterilen) */}
      {damperOlaylar.length > 0 && (
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs font-semibold text-gray-600 mb-2">
            🔻 {seciliPlaka || "Tüm kamyonlar"} — {damperOlaylar.length} damper indirme
            {damperOlaylar.length > damperKoordlu.length && <span className="text-gray-400 font-normal"> ({damperKoordlu.length} tanesi haritada konumlu)</span>}
          </div>
          <ol className="space-y-0.5 max-h-[28vh] overflow-auto">
            {damperOlaylar.map((o, i) => (
              <li key={i} className="text-xs flex items-center gap-2">
                <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                <span className="font-bold text-[#1E3A5F] w-24 truncate">{o.plaka}</span>
                <span className="font-mono whitespace-nowrap font-semibold text-orange-700">🔻 {o.saat ?? "—"}</span>
                <span className="flex-1 truncate text-gray-600">{o.adres ?? "—"}</span>
                {o.lat != null && o.lng != null
                  ? <span className="text-[10px] text-emerald-600 flex items-center gap-0.5"><MapPin size={10} /> konumlu</span>
                  : <span className="text-[10px] text-gray-400">konumsuz</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Tam ekran modal */}
      {tumHaritaAcik && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex flex-col" onClick={() => setTumHaritaAcik(false)}>
          <div className="bg-[#1E3A5F] text-white px-4 py-2 flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Layers size={18} className="flex-shrink-0" />
              <span className="text-sm truncate">Stabilize — {formatTarih(tarih)} · {damperKoordlu.length} damper · {greyderler.length} reglaj çizgisi</span>
            </div>
            <button type="button" onClick={() => setTumHaritaAcik(false)} className="p-1.5 hover:bg-white/10 rounded flex-shrink-0" title="Kapat">
              <X size={18} />
            </button>
          </div>
          <div ref={tumMapRef} className="flex-1 bg-gray-100" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
