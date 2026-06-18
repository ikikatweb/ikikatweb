// Arvento Güzergah (Reglaj) sekmesi — "Mesafe Bilgisi" raporundan aracın
// günlük GPS noktalarını haritada rota çizgisi (polyline) olarak gösterir.
// Greyder vb. araçların gittiği güzergahı izlemek için.
// TARİH SEÇİMİ YOK: tarih, sayfanın üstündeki ana tarihten (prop) gelir.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar } from "@/lib/arvento/harita-katman";
import type { AracArventoGuzergah } from "@/lib/supabase/types";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Route, Download, Gauge, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function formatAralik(bas: string, bitis: string): string {
  if (!bas) return "—";
  return bas === bitis ? formatTarih(bas) : `${formatTarih(bas)} – ${formatTarih(bitis)}`;
}

export default function ArventoGuzergah({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, kalinliklar, renkler, refreshKey = 0 }: { bas: string; bitis: string; tekrarEsigi?: number; gridMesafe?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; refreshKey?: number }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const reglajRenkV = renkler?.reglaj ?? "#2563eb";
  const [kayitlar, setKayitlar] = useState<AracArventoGuzergah[]>([]);
  const [seciliPlaka, setSeciliPlaka] = useState("");
  const [hamGoster, setHamGoster] = useState(false); // "Güzergahı Göster": açıkken tekrar eşiği yok sayılır (ham rota)
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const gorunumRef = useRef<{ merkez: [number, number]; zoom: number } | null>(null); // harita yeniden kurulurken görünüm korunur
  const fitAnahtarRef = useRef<string>(""); // sadece bu anahtar (plaka/tarih) değişince yeniden ortala
  const etkinTekrar = hamGoster ? 0 : tekrarEsigi; // açıkken sadeleştirme kapalı

  // Seçili aralığın kayıtlarını yükle (bas–bitis); aralık değişince / yeni yükleme sonrası
  useEffect(() => {
    if (!bas || !bitis) { setKayitlar([]); setLoading(false); return; }
    setLoading(true);
    getGuzergahByRange(bas, bitis)
      .then((k) => {
        setKayitlar(k);
        setSeciliPlaka((prev) => (k.some((x) => x.plaka === prev) ? prev : (k[0]?.plaka ?? "")));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist") || msg.includes("arac_arvento_guzergah")) {
          toast.error("arac_arvento_guzergah tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
        }
      })
      .finally(() => setLoading(false));
  }, [bas, bitis, refreshKey]);

  const seciliKayit = useMemo(() => kayitlar.find((k) => k.plaka === seciliPlaka) ?? null, [kayitlar, seciliPlaka]);

  // Özet bilgi (mesafe, nokta, saat aralığı, maks hız + sadeleştirme istatistiği)
  const ozet = useMemo(() => {
    if (!seciliKayit) return null;
    const n = seciliKayit.noktalar ?? [];
    const ilkSaat = n[0]?.saat ?? null;
    const sonSaat = n[n.length - 1]?.saat ?? null;
    const maksHiz = n.reduce((m, p) => Math.max(m, p.hiz ?? 0), 0);
    let sade: { gosterilen: number; toplam: number; maksGecis: number } | null = null;
    if (etkinTekrar >= 1) {
      const s = sadelesGuzergah(n, etkinTekrar, gridMesafe);
      sade = { gosterilen: s.gosterilenSegment, toplam: s.toplamSegment, maksGecis: s.maksGecis };
    }
    return { nokta: n.length, mesafe: seciliKayit.toplam_mesafe ?? 0, ilkSaat, sonSaat, maksHiz, sade };
  }, [seciliKayit, etkinTekrar, gridMesafe]);

  // Haritayı çiz — seçili plaka rotası (polyline + başlangıç/bitiş işareti)
  useEffect(() => {
    if (!seciliKayit || !seciliKayit.noktalar?.length) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      // Önceki harita varsa temizle (mapRef yeniden kullanılıyor)
      map = L.map(mapRef.current).setView(gorunumRef.current?.merkez ?? [39, 35], gorunumRef.current?.zoom ?? 6);
      map.on("moveend zoomend", () => {
        if (!map) return;
        const c = map.getCenter();
        gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
      });
      ekleHaritaKatmanlari(L, map, "uydu");
      ekleOlcumKontrolu(L, map);
      await ekleKayitliKatmanlar(L, map);
      if (iptal || !map) return; // await sırasında harita silinmiş olabilir
      const noktalar = seciliKayit.noktalar.filter((p) => p.lat != null && p.lng != null);
      const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
      if (latlngs.length === 0) return;
      if (etkinTekrar >= 1) {
        // SADELEŞTİRİLMİŞ: eşiği geçen yol parçaları GERÇEK koordinatlarla çizilir
        const cizgiler = sadelesGuzergah(noktalar, etkinTekrar, gridMesafe).parcalar;
        if (cizgiler.length > 0) L.polyline(cizgiler, { color: reglajRenkV, weight: reglajKal, opacity: 0.85 }).addTo(map);
        else L.polyline(latlngs, { color: reglajRenkV, weight: reglajKal, opacity: 0.85 }).addTo(map); // eşik çok yüksek → ham yedek
        // Ara noktalar gizli (sadeleştirme modunda temiz tek çizgi)
      } else {
        // HAM rota: tüm noktalar sırayla + ara noktalar
        L.polyline(latlngs, { color: reglajRenkV, weight: reglajKal, opacity: 0.8 }).addTo(map);
        for (let i = 0; i < noktalar.length; i++) {
          const p = noktalar[i];
          L.circleMarker([p.lat, p.lng], { radius: 3, color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.7, weight: 1 })
            .addTo(map)
            .bindPopup(`${p.saat ?? ""}<br>Hız: ${p.hiz ?? "—"} km/s`);
        }
      }
      // Başlangıç (yeşil) ve bitiş (kırmızı) işaretleri
      const bas = latlngs[0], son = latlngs[latlngs.length - 1];
      L.circleMarker(bas, { radius: 8, color: "#15803d", fillColor: "#22c55e", fillOpacity: 0.9, weight: 2 })
        .addTo(map).bindPopup(`<b>BAŞLANGIÇ</b><br>${noktalar[0].saat ?? ""}`);
      L.circleMarker(son, { radius: 8, color: "#991b1b", fillColor: "#ef4444", fillOpacity: 0.9, weight: 2 })
        .addTo(map).bindPopup(`<b>BİTİŞ</b><br>${noktalar[noktalar.length - 1].saat ?? ""}`);
      // Sadece plaka/tarih değişince yeniden ortala; toggle/filtre değişiminde mevcut görünümü koru
      const fitAnahtar = `${bas}|${bitis}|${seciliKayit.plaka}`;
      if (gorunumRef.current && fitAnahtarRef.current === fitAnahtar) {
        map.setView(gorunumRef.current.merkez, gorunumRef.current.zoom, { animate: false });
      } else {
        map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 17 });
      }
      fitAnahtarRef.current = fitAnahtar;
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return () => { iptal = true; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [seciliKayit, etkinTekrar, gridMesafe, reglajKal, reglajRenkV, bas, bitis]);

  // KML export — rota LineString + başlangıç/bitiş noktaları (Google Earth)
  function exportKML() {
    if (!seciliKayit || !seciliKayit.noktalar?.length) {
      toast.error("Rota verisi yok.", { duration: toastSuresi() });
      return;
    }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const noktalar = seciliKayit.noktalar.filter((p) => p.lat != null && p.lng != null);
    // KML koordinat sırası: LNG,LAT,YÜKSEKLİK
    const coords = noktalar.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
    const baslik = `Guzergah ${seciliKayit.plaka} ${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const ilkN = noktalar[0], sonN = noktalar[noktalar.length - 1];
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>
    <Style id="rota"><LineStyle><color>ffeb6326</color><width>4</width></LineStyle></Style>
    <Placemark>
      <name>${esc(seciliKayit.plaka)} rotası</name>
      <description>${esc(`${seciliKayit.arac_sinifi ?? ""} ${seciliKayit.marka ?? ""} ${seciliKayit.model ?? ""} · ${noktalar.length} nokta · ${seciliKayit.toplam_mesafe ?? 0} km`)}</description>
      <styleUrl>#rota</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
    </Placemark>
    <Placemark><name>Başlangıç</name><Point><coordinates>${ilkN.lng.toFixed(6)},${ilkN.lat.toFixed(6)},0</coordinates></Point></Placemark>
    <Placemark><name>Bitiş</name><Point><coordinates>${sonN.lng.toFixed(6)},${sonN.lat.toFixed(6)},0</coordinates></Point></Placemark>
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Rota KML olarak indirildi.", { duration: toastSuresi() });
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!bas || !bitis) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Route size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">Yukarıdan bir tarih aralığı seçin.</p>
      </div>
    );
  }
  if (kayitlar.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Route size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">
          {formatAralik(bas, bitis)} için güzergah (Mesafe Bilgisi) verisi yok.
          <br />Üstteki tarihi değiştirin ya da &quot;Excel Yükle&quot; ile Mesafe Bilgisi raporu yükleyin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filtreler: Plaka + özet + KML (Tarih üstteki ana seçiciden gelir) */}
      <div className="bg-white rounded-lg border p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Araç (Plaka)</Label>
          <select value={seciliPlaka} onChange={(e) => setSeciliPlaka(e.target.value)} className={selectClass + " min-w-[160px]"}>
            {kayitlar.length === 0 && <option value="">Kayıt yok</option>}
            {kayitlar.map((k) => (
              <option key={k.plaka} value={k.plaka}>
                {k.plaka}{k.arac_sinifi ? ` · ${k.arac_sinifi}` : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => setHamGoster((v) => !v)}
          title="Açıkken tüm Tanımlamalar filtreleri yok sayılır — tam (ham) rota gösterilir"
          className={`h-9 px-3 rounded-lg border text-xs font-medium self-end transition-colors ${hamGoster ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
          {hamGoster ? "✓ Güzergahı Göster" : "Güzergahı Göster"}
        </button>
        {ozet && (
          <div className="ml-auto flex items-end gap-3">
            <div className="text-xs text-gray-600 text-right leading-relaxed">
              <div>
                {seciliKayit?.marka} {seciliKayit?.model}
                {seciliKayit?.arac_sinifi ? ` (${seciliKayit.arac_sinifi})` : ""}
              </div>
              <div>
                <Route size={12} className="inline" /> <strong className="text-[#1E3A5F]">{ozet.mesafe} km</strong> ·{" "}
                <Clock size={12} className="inline" /> {ozet.ilkSaat}–{ozet.sonSaat} ·{" "}
                <Gauge size={12} className="inline" /> maks {ozet.maksHiz} km/s · {ozet.nokta} nokta
              </div>
              {ozet.sade && (
                <div className="text-[10px] text-emerald-700">
                  Tek çizgi: {ozet.sade.gosterilen}/{ozet.sade.toplam} parça (≥{etkinTekrar} geçiş · en çok {ozet.sade.maksGecis}×)
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
              <Download size={14} /> KML İndir
            </Button>
          </div>
        )}
      </div>

      {/* Harita */}
      {seciliKayit ? (
        <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "65vh" }} />
      ) : (
        <div className="text-center py-16 bg-white rounded-lg border text-gray-500">
          Bu tarihte güzergah kaydı bulunamadı.
        </div>
      )}
    </div>
  );
}
