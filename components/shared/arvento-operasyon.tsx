// Arvento Serme & Sıkıştırma haritaları.
// Temel: greyder (reglaj) güzergahı ALTLI ÜSTLÜ (paralel çift) çizgi olarak çizilir.
//   - Serme      → altlı üstlü çizgi (yeşil) + ortada kamyon damper ikonları
//   - Sıkıştırma → altlı üstlü çizgi (yeşil, soluk referans) + ortada silindir ZİKZAK (mor)
// Greyder çizgisi "Güzergah Tekrar Eşiği", silindir zikzak "Silindir Tekrar Eşiği" ile sadeleşir.
// Harita uydu (Google Earth) görünümünde.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByTarih, getArventoRaporByTarih } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari } from "@/lib/arvento/harita-katman";
import { OPERASYONLAR, sinifEslesir, zikzakla, paralelCizgi, type OperasyonTip } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Layers, Download, MapPin, X } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";
const OFFSET_M = 4; // altlı üstlü çizgi yarı-aralığı (m)
const ALTUST_RENK = OPERASYONLAR.serme.renk;      // yeşil — greyder serme alanı çizgisi
const ZIGZAK_RENK = OPERASYONLAR.sikistirma.renk; // mor — silindir zikzak
const DAMPER_RENK = "#f97316";

type DamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
type DamperNokta = DamperOlay & { plaka: string };
type LeafletStatic = typeof import("leaflet");

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// Greyder hattının herhangi bir noktası bir damper noktasına esikM metre içinde mi?
// (Serme = reglaj hattı + üzerinde damper kontrolü için.)
function yakinDamperVar(noktalar: { lat: number; lng: number }[], damperler: DamperNokta[], esikM = 80): boolean {
  const R = 111320;
  for (const d of damperler) {
    if (d.lat == null || d.lng == null) continue;
    const cosL = Math.max(0.1, Math.cos((d.lat * Math.PI) / 180));
    for (const p of noktalar) {
      if (p.lat == null || p.lng == null) continue;
      const dx = (p.lng - d.lng) * R * cosL;
      const dy = (p.lat - d.lat) * R;
      if (Math.hypot(dx, dy) < esikM) return true;
    }
  }
  return false;
}

// Bir güzergahı sadeleştirip çizilecek parça (latlng dizisi) listesine çevirir.
function parcalar(noktalar: { lat: number; lng: number }[], esik: number, gridM: number, kopruM: number): [number, number][][] {
  const latlngs: [number, number][] = noktalar.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng]);
  if (latlngs.length === 0) return [];
  if (gridM > 0) return sadelesGuzergah(noktalar, esik, gridM, kopruM).parcalar; // sadeleştirme bant (gridM) ile açılır

  return [latlngs];
}

// Altlı üstlü (paralel çift) çizgi çiz
function cizAltUst(L: LeafletStatic, map: LeafletMap, segler: [number, number][][], renk: string, opacity: number, bounds: [number, number][]) {
  for (const seg of segler) {
    if (seg.length < 2) continue;
    L.polyline(paralelCizgi(seg, OFFSET_M), { color: renk, weight: 3, opacity }).addTo(map);
    L.polyline(paralelCizgi(seg, -OFFSET_M), { color: renk, weight: 3, opacity }).addTo(map);
    for (const ll of seg) bounds.push(ll);
  }
}

export default function ArventoOperasyon({ tarih, operasyon, tekrarEsigi = 0, silindirEsik = 0, gridMesafe = 12, guzergahMesafe = 30, refreshKey = 0 }: {
  tarih: string; operasyon: OperasyonTip; tekrarEsigi?: number; silindirEsik?: number; gridMesafe?: number; guzergahMesafe?: number; refreshKey?: number;
}) {
  const def = OPERASYONLAR[operasyon];
  const sermeMi = operasyon === "serme";
  const [tumGuzergah, setTumGuzergah] = useState<AracArventoGuzergah[]>([]);
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);
  const [seciliGreyder, setSeciliGreyder] = useState(""); // "" = tüm greyderler
  const [loading, setLoading] = useState(true);
  const [tumHaritaAcik, setTumHaritaAcik] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const tumMapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tarih) { setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([getGuzergahByTarih(tarih), sermeMi ? getArventoRaporByTarih(tarih) : Promise.resolve([])])
      .then(([g, r]) => { setTumGuzergah(g); setRaporlar(r as AracArventoRapor[]); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => setLoading(false));
  }, [tarih, refreshKey, sermeMi]);

  const greyderler = useMemo(() => tumGuzergah.filter((k) => sinifEslesir(k.arac_sinifi, "reglaj", k.plaka)), [tumGuzergah]);
  const silindirler = useMemo(() => tumGuzergah.filter((k) => sinifEslesir(k.arac_sinifi, "sikistirma", k.plaka)), [tumGuzergah]);

  useEffect(() => {
    setSeciliGreyder((prev) => (prev && greyderler.some((k) => k.plaka === prev) ? prev : ""));
  }, [greyderler]);

  // Kamyon damperleri (serme'de ortada gösterilir)
  const damperKoordlu = useMemo<DamperNokta[]>(() => {
    if (!sermeMi) return [];
    const out: DamperNokta[] = [];
    for (const r of raporlar) {
      for (const o of (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[]) {
        if (o.lat != null && o.lng != null) out.push({ ...o, plaka: r.plaka });
      }
    }
    return out;
  }, [sermeMi, raporlar]);

  // Serme: greyder hattı yalnızca ÜZERİNDE/yakınında damper varsa gösterilir
  // (reglaj→damper→reglaj). Damper yoksa serme yapılmamıştır → boş.
  const gosterilenGreyder = useMemo(() => {
    const liste = seciliGreyder ? greyderler.filter((k) => k.plaka === seciliGreyder) : greyderler;
    if (!sermeMi) return liste;
    return liste.filter((k) => yakinDamperVar(k.noktalar ?? [], damperKoordlu));
  }, [greyderler, seciliGreyder, sermeMi, damperKoordlu]);

  function harita(hedef: HTMLDivElement): { iptal: () => void } {
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !hedef) return;
      map = L.map(hedef).setView([39, 35], 6);
      ekleHaritaKatmanlari(L, map, "uydu");
      const bounds: [number, number][] = [];
      // Altlı üstlü greyder çizgisi (sıkıştırmada soluk referans)
      gosterilenGreyder.forEach((k) =>
        cizAltUst(L, map!, parcalar(k.noktalar ?? [], tekrarEsigi, gridMesafe, guzergahMesafe), ALTUST_RENK, sermeMi ? 0.85 : 0.45, bounds));
      if (sermeMi) {
        // Ortada damper ikonları
        damperKoordlu.forEach((o, i) => {
          L.circleMarker([o.lat as number, o.lng as number], { radius: 7, color: "#9a3412", fillColor: DAMPER_RENK, fillOpacity: 0.9, weight: 2 })
            .addTo(map!).bindPopup(`<b>🔻 ${o.plaka}</b> · Damper ${i + 1}<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
          bounds.push([o.lat as number, o.lng as number]);
        });
      } else {
        // Ortada silindir zikzak (silindir tekrar eşiğiyle sadeleşir)
        silindirler.forEach((k) =>
          parcalar(k.noktalar ?? [], silindirEsik, gridMesafe, guzergahMesafe).forEach((seg) => {
            if (seg.length < 2) return;
            L.polyline(zikzakla(seg), { color: ZIGZAK_RENK, weight: 3, opacity: 0.9 })
              .addTo(map!).bindPopup(`<b>${k.plaka}</b> (silindir)<br>${k.arac_sinifi ?? ""}`);
            for (const ll of seg) bounds.push(ll);
          }));
      }
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return { iptal: () => { iptal = true; if (map) { try { map.remove(); } catch { /* sessiz */ } } } };
  }

  useEffect(() => {
    if (!tarih || !mapRef.current) return;
    const h = harita(mapRef.current);
    return h.iptal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarih, gosterilenGreyder, silindirler, damperKoordlu, tekrarEsigi, silindirEsik, gridMesafe, guzergahMesafe, sermeMi]);

  useEffect(() => {
    if (!tumHaritaAcik || !tumMapRef.current) return;
    const h = harita(tumMapRef.current);
    return h.iptal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tumHaritaAcik, gosterilenGreyder, silindirler, damperKoordlu, tekrarEsigi, silindirEsik, gridMesafe, guzergahMesafe, sermeMi]);

  function exportKML() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cizgiler = gosterilenGreyder.map((k) => {
      const n = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (n.length === 0) return "";
      const coords = n.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      return `
    <Placemark><name>${esc(k.plaka)} ${esc(def.ad)}</name><styleUrl>#rota</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }).join("");
    const orta = sermeMi
      ? damperKoordlu.map((o, i) => `
    <Placemark><name>${esc(o.plaka)} damper ${i + 1}</name><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`).join("")
      : silindirler.map((k) => {
          const n = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
          if (n.length === 0) return "";
          const coords = n.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
          return `
    <Placemark><name>${esc(k.plaka)} silindir</name><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
        }).join("");
    if (!cizgiler && !orta) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `${def.ad} ${tarih}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>
    <Style id="rota"><LineStyle><color>ff69b005</color><width>4</width></LineStyle></Style>${cizgiler}${orta}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${def.ad} KML olarak indirildi.`, { duration: toastSuresi() });
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
  const veriYok = sermeMi
    ? greyderler.length === 0 && damperKoordlu.length === 0
    : greyderler.length === 0 && silindirler.length === 0;
  if (veriYok) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Layers size={48} className="mx-auto mb-4" style={{ color: def.renk, opacity: 0.5 }} />
        <p className="text-gray-500">
          {formatTarih(tarih)} için <strong style={{ color: def.renk }}>{def.ad}</strong> verisi yok.
          <br />{sermeMi
            ? "Greyder Mesafe Bilgisi ve/veya damper raporunu yükleyin."
            : "Greyder Mesafe Bilgisi (alan) ve silindir Mesafe Bilgisi raporunu yükleyin."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Greyder Alanı</Label>
          <select value={seciliGreyder} onChange={(e) => setSeciliGreyder(e.target.value)} className={selectClass + " min-w-[180px]"}>
            <option value="">Tüm greyderler ({greyderler.length})</option>
            {greyderler.map((k) => (
              <option key={k.plaka} value={k.plaka}>{k.plaka}{k.arac_sinifi ? ` · ${k.arac_sinifi}` : ""}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div className="text-xs text-gray-600 text-right leading-relaxed">
            <div className="flex items-center justify-end gap-1">
              <span className="inline-flex flex-col gap-0.5">
                <span className="inline-block w-4 h-0.5 rounded" style={{ background: ALTUST_RENK }} />
                <span className="inline-block w-4 h-0.5 rounded" style={{ background: ALTUST_RENK }} />
              </span>
              <strong style={{ color: def.renk }}>{def.ad}</strong>
              <span className="text-gray-400">· {gosterilenGreyder.length} greyder alanı</span>
            </div>
            <div>
              {sermeMi
                ? <span className="text-orange-600 font-semibold">🔻 {damperKoordlu.length} damper</span>
                : <span style={{ color: ZIGZAK_RENK }} className="font-semibold">⩘ {silindirler.length} silindir zikzak</span>}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTumHaritaAcik(true)} className="h-9 gap-1 text-xs" title="Tam ekranda göster">
            <MapPin size={14} /> Tümünü Haritada Göster
          </Button>
          <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
            <Download size={14} /> KML İndir
          </Button>
        </div>
      </div>

      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "62vh" }} />

      {tumHaritaAcik && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex flex-col" onClick={() => setTumHaritaAcik(false)}>
          <div className="bg-[#1E3A5F] text-white px-4 py-2 flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Layers size={18} className="flex-shrink-0" />
              <span className="text-sm truncate">{def.ad} — {formatTarih(tarih)}</span>
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
