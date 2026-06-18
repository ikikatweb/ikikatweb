// Arvento Stabilize sekmesi — KAMYONLARIN damper indirmelerini gösterir.
// Kamyonlar yan yana chip olarak listelenir (şoför ismiyle); tıklayarak çoklu seçim yapılır.
// Seçili kamyonların damper noktaları haritada turuncu yuvarlak çizilir. Greyder REGLAJ
// çizgileri arka planda referans olarak durur.
//
// Damper: arac_arvento_rapor.damper_olaylar (kamyonlar). Çizgi: arac_arvento_guzergah (greyder).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari } from "@/lib/arvento/harita-katman";
import { sinifEslesir } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Layers, Download, MapPin } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

type DamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
type DamperNokta = DamperOlay & { plaka: string; surucu: string | null };

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function formatAralik(bas: string, bitis: string): string {
  if (!bas) return "—";
  return bas === bitis ? formatTarih(bas) : `${formatTarih(bas)} – ${formatTarih(bitis)}`;
}
function damperOlaylariniAl(r: AracArventoRapor): DamperOlay[] {
  return (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[];
}

// Her kamyona ayırt edici sabit renk — uydu görüntüsünde okunur, parlak tonlar.
// Sıralama hue olarak en uzaktan başlar: az sayıda kamyonda bile renkler net ayrılsın
// (örn. 2 kamyon → kırmızı + camgöbeği). Reglaj çizgisi mavi olduğundan onun tonundan kaçınıldı.
const KAMYON_RENKLERI = [
  "#ef4444", // kırmızı
  "#06b6d4", // camgöbeği
  "#84cc16", // fıstık yeşili
  "#a855f7", // mor
  "#f59e0b", // amber
  "#ec4899", // pembe
  "#10b981", // zümrüt
  "#f97316", // turuncu
  "#3b82f6", // mavi
  "#d946ef", // fuşya
  "#14b8a6", // turkuaz
  "#eab308", // sarı
  "#8b5cf6", // menekşe
  "#22c55e", // yeşil
  "#f43f5e", // gül
  "#0ea5e9", // gök
];

export default function ArventoStabilize({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, refreshKey = 0 }: { bas: string; bitis: string; tekrarEsigi?: number; gridMesafe?: number; refreshKey?: number }) {
  const [tumGuzergah, setTumGuzergah] = useState<AracArventoGuzergah[]>([]); // reglaj çizgileri (referans)
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);          // kamyon damper olayları
  const [seciliPlakalar, setSeciliPlakalar] = useState<Set<string>>(new Set()); // çoklu seçim (boş→hepsi varsayılan effect ile dolar)
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bas || !bitis) { setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([getGuzergahByRange(bas, bitis), getArventoRaporByRange(bas, bitis)])
      .then(([g, r]) => { setTumGuzergah(g); setRaporlar(r); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => setLoading(false));
  }, [bas, bitis, refreshKey]);

  // Referans çizgiler: greyder (reglaj) güzergahları
  const greyderler = useMemo(() => tumGuzergah.filter((k) => sinifEslesir(k.arac_sinifi, "reglaj", k.plaka)), [tumGuzergah]);

  // Damper indiren kamyonlar (damper_olaylar veya damper_sayisi olan araçlar)
  const kamyonlar = useMemo(
    () => raporlar.filter((r) => damperOlaylariniAl(r).length > 0 || (r.damper_sayisi ?? 0) > 0),
    [raporlar],
  );

  // Her kamyona sabit renk ata — chip ↔ harita ↔ liste hep aynı renk
  const plakaRenk = useMemo(() => {
    const m = new Map<string, string>();
    kamyonlar.forEach((r, i) => m.set(r.plaka, KAMYON_RENKLERI[i % KAMYON_RENKLERI.length]));
    return m;
  }, [kamyonlar]);
  const renkAl = (plaka: string) => plakaRenk.get(plaka) ?? "#f97316";

  // Veri değişince varsayılan: tüm kamyonlar seçili
  useEffect(() => {
    setSeciliPlakalar(new Set(kamyonlar.map((r) => r.plaka)));
  }, [kamyonlar]);

  const toggle = (plaka: string) => setSeciliPlakalar((s) => {
    const n = new Set(s); if (n.has(plaka)) n.delete(plaka); else n.add(plaka); return n;
  });
  const hepsiSecili = kamyonlar.length > 0 && kamyonlar.every((r) => seciliPlakalar.has(r.plaka));

  // Gösterilecek damper noktaları: seçili kamyonların damperleri
  const damperOlaylar = useMemo<DamperNokta[]>(() => {
    const out: DamperNokta[] = [];
    for (const r of kamyonlar) {
      if (!seciliPlakalar.has(r.plaka)) continue;
      for (const o of damperOlaylariniAl(r)) out.push({ ...o, plaka: r.plaka, surucu: r.surucu });
    }
    return out;
  }, [kamyonlar, seciliPlakalar]);

  const damperKoordlu = useMemo(() => damperOlaylar.filter((o) => o.lat != null && o.lng != null), [damperOlaylar]);

  // Harita: greyder çizgileri (referans) + kamyon damper yuvarlakları
  useEffect(() => {
    if (!bas || !bitis) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      map = L.map(mapRef.current).setView([39, 35], 6);
      ekleHaritaKatmanlari(L, map, "uydu");
      const bounds: [number, number][] = [];
      greyderler.forEach((k) => {
        const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) return;
        const cizim: [number, number][][] = tekrarEsigi >= 1
          ? sadelesGuzergah(noktalar, tekrarEsigi, gridMesafe).parcalar
          : [latlngs];
        L.polyline(cizim.length ? cizim : [latlngs], { color: "#2563eb", weight: 3, opacity: 0.6 })
          .addTo(map!).bindPopup(`<b>${k.plaka}</b> (reglaj çizgisi)<br>${k.arac_sinifi ?? ""}`);
        for (const ll of latlngs) bounds.push(ll);
      });
      damperKoordlu.forEach((o, i) => {
        const lat = o.lat as number, lng = o.lng as number;
        const renk = renkAl(o.plaka);
        L.circleMarker([lat, lng], { radius: 8, color: "#ffffff", fillColor: renk, fillOpacity: 0.95, weight: 2 })
          .addTo(map!)
          .bindPopup(`<b>🔻 ${o.surucu ?? o.plaka}</b> · Damper ${i + 1}<br>${o.plaka}<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
        bounds.push([lat, lng]);
      });
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return () => { iptal = true; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [bas, bitis, greyderler, damperKoordlu, tekrarEsigi, gridMesafe, plakaRenk]);

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
    // KML rengi aabbggrr formatında — #rrggbb → ff bb gg rr
    const kmlRenk = (hex: string) => "ff" + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
    const renkStilId = (hex: string) => "d" + hex.slice(1);
    const kullanilanRenkler = Array.from(new Set(damperKoordlu.map((o) => renkAl(o.plaka))));
    const damperStilleri = kullanilanRenkler.map((hex) =>
      `<Style id="${renkStilId(hex)}"><IconStyle><color>${kmlRenk(hex)}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`,
    ).join("");
    const damperPlacemarks = damperKoordlu.map((o, i) => `
    <Placemark><name>${esc((o.surucu ?? o.plaka) + " damper " + (i + 1))}</name><description>${esc([o.plaka, o.saat ?? "", o.adres ?? ""].filter(Boolean).join(" · "))}</description><styleUrl>#${renkStilId(renkAl(o.plaka))}</styleUrl><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`).join("");
    if (!cizgiler && !damperPlacemarks) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `Stabilize ${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>
    <Style id="rota"><LineStyle><color>ffeb6326</color><width>4</width></LineStyle></Style>${damperStilleri}${cizgiler}${damperPlacemarks}
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
  if (!bas || !bitis) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Layers size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">Yukarıdan bir tarih aralığı seçin.</p>
      </div>
    );
  }
  if (kamyonlar.length === 0 && greyderler.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Layers size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">
          {formatAralik(bas, bitis)} için kamyon damper verisi ya da reglaj çizgisi yok.
          <br />Damper (Genel) raporunu ve/veya greyder Mesafe Bilgisi raporunu yükleyin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Kamyon chip'leri (yan yana, çoklu seçim — şoför ismiyle) + özet + KML */}
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-gray-500">Kamyonlar (Damper)</Label>
            {kamyonlar.length > 0 && (
              <button type="button"
                onClick={() => setSeciliPlakalar(hepsiSecili ? new Set() : new Set(kamyonlar.map((r) => r.plaka)))}
                className="text-[10px] text-blue-600 hover:underline">
                {hepsiSecili ? "Hiçbiri" : "Tümünü seç"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
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
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
              <Download size={14} /> KML İndir
            </Button>
          </div>
        </div>
        {/* Kamyon chip'leri */}
        <div className="flex flex-wrap gap-1.5">
          {kamyonlar.length === 0 && <span className="text-xs text-gray-400">Bu aralıkta damper indiren kamyon yok.</span>}
          {kamyonlar.map((r) => {
            const secili = seciliPlakalar.has(r.plaka);
            const renk = renkAl(r.plaka);
            const ad = r.surucu?.trim() || r.plaka;
            const adet = damperOlaylariniAl(r).length || (r.damper_sayisi ?? 0);
            return (
              <button key={r.plaka} type="button" onClick={() => toggle(r.plaka)}
                title={`${r.plaka}${r.marka ? " · " + r.marka : ""}`}
                style={secili ? { borderColor: renk, background: renk + "14" } : undefined}
                className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors ${
                  secili ? "text-gray-800" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                }`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renk, opacity: secili ? 1 : 0.4 }} />
                <span className="font-semibold">{ad}</span>
                {r.surucu?.trim() && <span className="text-[10px] opacity-70">{r.plaka}</span>}
                <span className="text-[10px] px-1 rounded" style={{ background: secili ? renk + "2e" : "#f3f4f6" }}>🔻{adet}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Harita */}
      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "60vh" }} />

      {/* Damper indirme listesi (seçili kamyonlar) */}
      {damperOlaylar.length > 0 && (
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs font-semibold text-gray-600 mb-2">
            🔻 {seciliPlakalar.size === kamyonlar.length ? "Tüm kamyonlar" : `${seciliPlakalar.size} kamyon`} — {damperOlaylar.length} damper indirme
            {damperOlaylar.length > damperKoordlu.length && <span className="text-gray-400 font-normal"> ({damperKoordlu.length} tanesi haritada konumlu)</span>}
          </div>
          <ol className="space-y-0.5 max-h-[28vh] overflow-auto">
            {damperOlaylar.map((o, i) => (
              <li key={i} className="text-xs flex items-center gap-2">
                <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renkAl(o.plaka) }} />
                <span className="font-bold text-[#1E3A5F] w-32 truncate">{o.surucu?.trim() || o.plaka}</span>
                <span className="text-gray-400 w-20 truncate">{o.plaka}</span>
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
    </div>
  );
}
