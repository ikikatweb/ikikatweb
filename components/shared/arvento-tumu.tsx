// Arvento "Tümü" sekmesi — o gün içindeki bütün operasyonları (Reglaj/Serme greyder
// çizgisi, Sıkıştırma silindir zikzak çizgisi, Stabilize damper noktaları) TEK haritada
// üst üste gösterir. Renkli lejant ile hangi rengin hangi operasyon olduğu belirtilir.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject } from "react";
import { OPERASYONLAR, operasyondaGorunur, atananSekmeleriHesapla, zikzakla, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Layers, Download } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

type DamperOlay = { saat: string | null; adres: string | null; lat?: number | null; lng?: number | null };

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function formatAralik(bas: string, bitis: string): string {
  if (!bas) return "—";
  return bas === bitis ? formatTarih(bas) : `${formatTarih(bas)} – ${formatTarih(bitis)}`;
}

export default function ArventoTumu({ bas, bitis, tekrarEsigi = 0, silindirEsik = 0, gridMesafe = 12, kalinliklar, renkler, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, refreshKey = 0, sonGuncelleme }: { bas: string; bitis: string; tekrarEsigi?: number; silindirEsik?: number; gridMesafe?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; refreshKey?: number; sonGuncelleme?: Date | null }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const silindirKal = kalinliklar?.silindir ?? 3;
  const reglajRenkV = renkler?.reglaj ?? OPERASYONLAR.reglaj.renk;
  const silindirRenkV = renkler?.silindir ?? OPERASYONLAR.sikistirma.renk;
  const [guzergahlar, setGuzergahlar] = useState<AracArventoGuzergah[]>([]);
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const yerelGorunumRef = useRef<HaritaGorunum | null>(null);
  const gorunumRef = disGorunumRef ?? yerelGorunumRef; // dışarıdan verilirse sekmeler arası PAYLAŞILAN görünüm
  const canliLayerRef = useRef<LayerGroup | null>(null);
  // Harita BİR KEZ kurulur; veri ayrı LayerGroup'ta → veri değişince flicker olmaz (sadece grup yeniden çizilir).
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const veriKatmanRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [haritaHazir, setHaritaHazir] = useState(0);
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliKonumlar, cihazMap: canliCihazMap };
  useCanliKatman(canliLayerRef, canliKonumlar, canliCihazMap); // canlı katman pozisyon güncellemelerini kendi içinde yönetir

  // Yükleme göstergesi yalnız TARİH değişiminde; periyodik tazelemede sessiz çek.
  const yapiRef = useRef("");
  useEffect(() => {
    if (!bas || !bitis) { setGuzergahlar([]); setRaporlar([]); setLoading(false); return; }
    const yapi = `${bas}|${bitis}`;
    const yapisal = yapiRef.current !== yapi;
    if (yapisal) { yapiRef.current = yapi; setLoading(true); }
    Promise.all([getGuzergahByRange(bas, bitis), getArventoRaporByRange(bas, bitis)])
      .then(([g, r]) => { setGuzergahlar(g); setRaporlar(r); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => { if (yapisal) setLoading(false); });
  }, [bas, bitis, refreshKey]);

  const atananSekmeler = useMemo(() => atananSekmeleriHesapla(sekmeMap), [sekmeMap]);

  // Katman özeti (kaç greyder / silindir çizgisi, kaç damper)
  const ozet = useMemo(() => {
    const greyder = guzergahlar.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"reglaj", k.plaka)).length;
    const silindir = guzergahlar.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"sikistirma", k.plaka)).length;
    let damper = 0;
    for (const r of raporlar) for (const o of (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[]) if (o.lat != null && o.lng != null) damper++;
    return { greyder, silindir, damper };
  }, [guzergahlar, raporlar, sekmeMap, atananSekmeler]);

  // Haritayı BİR KEZ kur. Yeniden kurulmaz → veri değişince tile reload / flicker OLMAZ.
  useEffect(() => {
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      leafletRef.current = L as unknown as typeof import("leaflet");
      map = L.map(mapRef.current).setView(gorunumRef.current?.merkez ?? [39, 35], gorunumRef.current?.zoom ?? 6);
      mapInstanceRef.current = map;
      let oto = true; // programatik (setView/fitBounds) hareketleri kullanıcı hareketinden ayır — gorunumRef'i kirletmesin
      map.on("moveend zoomend", () => {
        if (oto || !map) return;
        const c = map.getCenter();
        gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
      });
      ekleHaritaKatmanlari(L, map, "uydu");
      ekleOlcumKontrolu(L, map);
      await ekleKayitliKatmanlar(L, map);
      if (iptal || !map) return; // await sırasında harita silinmiş olabilir
      veriKatmanRef.current = L.layerGroup().addTo(map);
      canliLayerRef.current = canliKatmanKur(L, map, canliVeriRef.current.konumlar, canliVeriRef.current.cihazMap);
      setTimeout(() => { oto = false; }, 800);
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
      setHaritaHazir((h) => h + 1);
    })();
    return () => {
      iptal = true;
      canliLayerRef.current = null;
      veriKatmanRef.current = null;
      mapInstanceRef.current = null;
      leafletRef.current = null;
      if (map) { try { map.remove(); } catch { /* sessiz */ } }
    };
    // loading: yükleme bitince (harita div'i DOM'a girince) kurulum çalışsın. Periyodik tazelemede değişmez.
  }, [gorunumRef, loading]);

  // Veri/ayar değişince YALNIZ veri katmanını yeniden çiz (harita yerinde kalır → flicker yok).
  useEffect(() => {
    const map = mapInstanceRef.current;
    const grup = veriKatmanRef.current;
    const L = leafletRef.current;
    if (!map || !grup || !L) return;
    grup.clearLayers();
    const bounds: [number, number][] = [];
    // Güzergah çizgileri — sınıfa göre operasyon rengi/stili
    guzergahlar.forEach((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
      if (latlngs.length === 0) return;
      const op = operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"sikistirma", k.plaka) ? "sikistirma"
        : operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"reglaj", k.plaka) ? "reglaj" : null;
      if (!op) return; // tanınmayan sınıf → çizme
      const def = OPERASYONLAR[op];
      // Greyder → Güzergah Tekrar Eşiği, Silindir → Silindir Tekrar Eşiği
      const esik = op === "sikistirma" ? silindirEsik : tekrarEsigi;
      const cizim: [number, number][][] = esik >= 1
        ? sadelesGuzergah(noktalar, esik, gridMesafe).parcalar
        : [latlngs];
      const kal = op === "sikistirma" ? silindirKal : reglajKal;
      const cizgiRenk = op === "sikistirma" ? silindirRenkV : reglajRenkV;
      (cizim.length ? cizim : [latlngs]).forEach((seg) =>
        L.polyline(def.zikzak ? zikzakla(seg) : seg, { color: cizgiRenk, weight: kal, opacity: 0.85 })
          .addTo(grup).bindPopup(`<b>${k.plaka}</b><br>${def.ad} · ${k.arac_sinifi ?? ""}`));
      for (const ll of latlngs) bounds.push(ll);
    });
    // Damper noktaları (Stabilize) — turuncu yuvarlak
    raporlar.forEach((r) => {
      const olaylar = (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[];
      olaylar.filter((o) => o.lat != null && o.lng != null).forEach((o) => {
        L.circleMarker([o.lat as number, o.lng as number], { radius: 6, color: "#9a3412", fillColor: OPERASYONLAR.stabilize.renk, fillOpacity: 0.9, weight: 1 })
          .addTo(grup).bindPopup(`<b>🔻 ${r.plaka}</b><br>Stabilize (damper)<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
        bounds.push([o.lat as number, o.lng as number]);
      });
    });
    // Canlı açıksa araç konumlarını da çerçeveye kat (operasyon verisi olmayan günde canlıya odaklan)
    for (const k of canliVeriRef.current.konumlar ?? []) {
      if (k.lat != null && k.lng != null) bounds.push([k.lat, k.lng]);
    }
    // Yalnızca İLK açılışta otomatik ortala; sonra mevcut görünümü KORU.
    if (!gorunumRef.current && bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      const c = map.getCenter();
      gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
    }
  }, [haritaHazir, guzergahlar, raporlar, tekrarEsigi, silindirEsik, gridMesafe, reglajKal, silindirKal, reglajRenkV, silindirRenkV, sekmeMap, atananSekmeler, gorunumRef]);

  // KML: greyder/silindir sadeleştirilmiş hatları + damper noktaları (haritadaki ile aynı)
  function exportKML() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const kmlRenk = (hex: string) => { const h = hex.replace("#", ""); return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; };
    let placemarks = "";
    guzergahlar.forEach((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return;
      const op = operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"sikistirma", k.plaka) ? "sikistirma"
        : operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"reglaj", k.plaka) ? "reglaj" : null;
      if (!op) return;
      const def = OPERASYONLAR[op];
      const esik = op === "sikistirma" ? silindirEsik : tekrarEsigi;
      const cizim: [number, number][][] = esik >= 1
        ? sadelesGuzergah(noktalar, esik, gridMesafe).parcalar
        : [noktalar.map((p) => [p.lat, p.lng] as [number, number])];
      cizim.forEach((seg) => {
        if (seg.length < 2) return;
        const coords = seg.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)},0`).join(" ");
        placemarks += `
    <Placemark><name>${esc(k.plaka)} ${esc(def.ad)}</name><Style><LineStyle><color>${kmlRenk(def.renk)}</color><width>4</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
      });
    });
    raporlar.forEach((r) => {
      ((Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[])
        .filter((o) => o.lat != null && o.lng != null)
        .forEach((o) => {
          placemarks += `
    <Placemark><name>${esc(r.plaka)} damper</name><description>${esc(o.saat ?? "")}</description><styleUrl>#damper</styleUrl><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`;
        });
    });
    if (!placemarks) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `Tumu ${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>
    <Style id="damper"><IconStyle><color>${kmlRenk(OPERASYONLAR.stabilize.renk)}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>${placemarks}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Tümü KML olarak indirildi.", { duration: toastSuresi() });
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
  const veriYok = guzergahlar.length === 0 && ozet.damper === 0 && !(canliKonumlar && canliKonumlar.length > 0);

  return (
    <div className="space-y-3">
      {/* Lejant + özet */}
      <div className="bg-white rounded-lg border p-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-xs font-semibold text-gray-600">{formatAralik(bas, bitis)} — Tüm operasyonlar</span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-4 h-1.5 rounded" style={{ background: OPERASYONLAR.reglaj.renk }} />
          Reglaj / Serme (greyder) <strong className="text-gray-500">· {ozet.greyder} çizgi</strong>
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-4 h-1.5 rounded" style={{ background: OPERASYONLAR.sikistirma.renk }} />
          Sıkıştırma (silindir, zikzak) <strong className="text-gray-500">· {ozet.silindir} çizgi</strong>
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-3 h-3 rounded-full border border-orange-800" style={{ background: OPERASYONLAR.stabilize.renk }} />
          Stabilize (damper) <strong className="text-gray-500">· {ozet.damper} nokta</strong>
        </span>
        {sonGuncelleme && (
          <span className="text-[10px] text-gray-400">🕒 Son güncelleme: <b className="text-gray-500">{sonGuncelleme.toLocaleTimeString("tr-TR")}</b></span>
        )}
        <Button variant="outline" size="sm" onClick={exportKML} disabled={veriYok}
          className="h-9 gap-1 text-xs ml-auto">
          <Download size={14} /> KML İndir
        </Button>
      </div>

      {veriYok ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Layers size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{formatAralik(bas, bitis)} için operasyon verisi yok. Mesafe Bilgisi / damper raporlarını yükleyin.</p>
        </div>
      ) : (
        <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "66vh" }} />
      )}
    </div>
  );
}
