// Arvento Serme & Sıkıştırma haritaları.
// Temel: greyder (reglaj) güzergahı ALTLI ÜSTLÜ (paralel çift) çizgi olarak çizilir.
//   - Serme      → altlı üstlü çizgi (yeşil) + ortada kamyon damper ikonları
//   - Sıkıştırma → altlı üstlü çizgi (yeşil, soluk referans) + ortada silindir ZİKZAK (mor)
// Greyder çizgisi "Güzergah Tekrar Eşiği", silindir zikzak "Silindir Tekrar Eşiği" ile sadeleşir.
// Harita uydu (Google Earth) görünümünde.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange, plakaNorm } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, type CanliKonum, type CihazMap } from "@/lib/arvento/canli-katman";
import { OPERASYONLAR, operasyondaGorunur, atananSekmeleriHesapla, zikzakla, paralelCizgi, type OperasyonTip, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Layers, Download } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

const OFFSET_M = 4; // altlı üstlü çizgi yarı-aralığı (m)
const DAMPER_RENK = "#f97316";
// Her silindir aracına ayırt edici sabit renk (Stabilize kamyon paletiyle aynı).
const ARAC_RENKLERI = [
  "#ef4444", "#06b6d4", "#84cc16", "#a855f7", "#f59e0b", "#ec4899",
  "#10b981", "#f97316", "#3b82f6", "#d946ef", "#14b8a6", "#eab308",
  "#8b5cf6", "#22c55e", "#f43f5e", "#0ea5e9",
];

// saniye → "2sa 15dk" / "0"
function formatSure(sn: number): string {
  if (!sn) return "0";
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  return sa > 0 ? `${sa}sa ${dk}dk` : `${dk}dk`;
}

type DamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
type DamperNokta = DamperOlay & { plaka: string };
type LeafletStatic = typeof import("leaflet");

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function formatAralik(bas: string, bitis: string): string {
  if (!bas) return "—";
  return bas === bitis ? formatTarih(bas) : `${formatTarih(bas)} – ${formatTarih(bitis)}`;
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
function parcalar(noktalar: { lat: number; lng: number }[], esik: number, gridM: number): [number, number][][] {
  const latlngs: [number, number][] = noktalar.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng]);
  if (latlngs.length === 0) return [];
  if (esik >= 1) return sadelesGuzergah(noktalar, esik, gridM).parcalar; // eşik (tekrar) ile açılır

  return [latlngs];
}

// Altlı üstlü (paralel çift) çizgi çiz
function cizAltUst(L: LeafletStatic, map: LeafletMap, segler: [number, number][][], renk: string, opacity: number, kalinlik: number, bounds: [number, number][]) {
  for (const seg of segler) {
    if (seg.length < 2) continue;
    L.polyline(paralelCizgi(seg, OFFSET_M), { color: renk, weight: kalinlik, opacity }).addTo(map);
    L.polyline(paralelCizgi(seg, -OFFSET_M), { color: renk, weight: kalinlik, opacity }).addTo(map);
    for (const ll of seg) bounds.push(ll);
  }
}

export default function ArventoOperasyon({ bas, bitis, operasyon, tekrarEsigi = 0, silindirEsik = 0, gridMesafe = 12, kalinliklar, renkler, kontakRolantiMap, sekmeMap, canliKonumlar, canliCihazMap, refreshKey = 0 }: {
  bas: string; bitis: string; operasyon: OperasyonTip; tekrarEsigi?: number; silindirEsik?: number; gridMesafe?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; kontakRolantiMap?: Map<string, { kontak: number; rolanti: number }>; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; refreshKey?: number;
}) {
  const def = OPERASYONLAR[operasyon];
  const sermeMi = operasyon === "serme";
  const sermeKal = kalinliklar?.serme ?? 3;
  const silindirKal = kalinliklar?.silindir ?? 3;
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const sermeRenkV = renkler?.serme ?? OPERASYONLAR.serme.renk;
  const silindirRenkV = renkler?.silindir ?? OPERASYONLAR.sikistirma.renk;
  const reglajRenkV = renkler?.reglaj ?? OPERASYONLAR.reglaj.renk;
  const [hamGoster, setHamGoster] = useState(false); // "Güzergahı Göster": açıkken tekrar eşikleri yok sayılır (ham rota)
  const etkinTekrar = hamGoster ? 0 : tekrarEsigi;
  const etkinSilindir = hamGoster ? 0 : silindirEsik;
  const [tumGuzergah, setTumGuzergah] = useState<AracArventoGuzergah[]>([]);
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const gorunumRef = useRef<{ merkez: [number, number]; zoom: number } | null>(null); // harita yeniden kurulurken görünüm korunur
  const canliLayerRef = useRef<LayerGroup | null>(null);
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliKonumlar, cihazMap: canliCihazMap };
  useCanliKatman(canliLayerRef, canliKonumlar, canliCihazMap);

  useEffect(() => {
    if (!bas || !bitis) { setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([getGuzergahByRange(bas, bitis), getArventoRaporByRange(bas, bitis)])
      .then(([g, r]) => { setTumGuzergah(g); setRaporlar(r as AracArventoRapor[]); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => setLoading(false));
  }, [bas, bitis, refreshKey, sermeMi]);

  const atananSekmeler = useMemo(() => atananSekmeleriHesapla(sekmeMap), [sekmeMap]);
  // Serme = greyder hattı; atama varsa "serme" ataması esas alınır, yoksa otomatik sınıf tespiti.
  const greyderler = useMemo(() => tumGuzergah.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi, "serme", k.plaka)), [tumGuzergah, sekmeMap, atananSekmeler]);
  const silindirler = useMemo(() => tumGuzergah.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi, "sikistirma", k.plaka)), [tumGuzergah, sekmeMap, atananSekmeler]);

  // Sıkıştırma chip listesi: güzergahı olan silindirler + rapordaki silindirler (o gün hareketsiz
  // olsa da plakası görünsün). Plakaya göre tekilleştirilir; km güzergahtan/rapordan gelir.
  const silindirChipler = useMemo<{ plaka: string; arac_sinifi: string | null; toplam_mesafe: number | null }[]>(() => {
    if (sermeMi) return [];
    const m = new Map<string, { plaka: string; arac_sinifi: string | null; toplam_mesafe: number | null }>();
    for (const k of silindirler) m.set(k.plaka, { plaka: k.plaka, arac_sinifi: k.arac_sinifi, toplam_mesafe: k.toplam_mesafe ?? 0 });
    for (const r of raporlar) {
      if (!operasyondaGorunur(sekmeMap, atananSekmeler, null, "sikistirma", r.plaka)) continue; // silindir plakası (atama/config) eşleşmesi
      if (!m.has(r.plaka)) m.set(r.plaka, { plaka: r.plaka, arac_sinifi: "Silindir", toplam_mesafe: r.mesafe_km ?? 0 });
    }
    return Array.from(m.values());
  }, [sermeMi, silindirler, raporlar, sekmeMap, atananSekmeler]);

  // Sıkıştırma: silindirler renkli chip'ler — çoklu seçim (chip listesi = silindirChipler)
  const [seciliSilindirler, setSeciliSilindirler] = useState<Set<string>>(new Set());
  useEffect(() => { setSeciliSilindirler(new Set(silindirChipler.map((k) => k.plaka))); }, [silindirChipler]);
  const silindirRenk = useMemo(() => {
    const m = new Map<string, string>();
    silindirChipler.forEach((k, i) => m.set(k.plaka, ARAC_RENKLERI[i % ARAC_RENKLERI.length]));
    return m;
  }, [silindirChipler]);
  const silindirRenkAl = useCallback((p: string) => silindirRenk.get(p) ?? silindirRenkV, [silindirRenk, silindirRenkV]);
  const secilenSilindirler = useMemo(() => silindirler.filter((k) => seciliSilindirler.has(k.plaka)), [silindirler, seciliSilindirler]);
  const silindirToggle = (p: string) => setSeciliSilindirler((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  // Serme: greyderler de Stabilize kamyonları gibi renkli chip — çoklu seçim
  const [seciliGreyderler, setSeciliGreyderler] = useState<Set<string>>(new Set());
  useEffect(() => { setSeciliGreyderler(new Set(greyderler.map((k) => k.plaka))); }, [greyderler]);
  const greyderRenk = useMemo(() => {
    const m = new Map<string, string>();
    greyderler.forEach((k, i) => m.set(k.plaka, ARAC_RENKLERI[i % ARAC_RENKLERI.length]));
    return m;
  }, [greyderler]);
  const greyderRenkAl = useCallback((p: string) => greyderRenk.get(p) ?? sermeRenkV, [greyderRenk, sermeRenkV]);
  const greyderToggle = (p: string) => setSeciliGreyderler((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  // Chip kaynağı: serme → greyderler, sıkıştırma → silindirChipler (tek tip normalize liste)
  const chipler = useMemo<{ plaka: string; arac_sinifi: string | null; toplam_mesafe: number | null }[]>(
    () => (sermeMi ? greyderler.map((k) => ({ plaka: k.plaka, arac_sinifi: k.arac_sinifi, toplam_mesafe: k.toplam_mesafe ?? 0 })) : silindirChipler),
    [sermeMi, greyderler, silindirChipler],
  );

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
    // Sıkıştırma: greyder yalnızca soluk referans → tüm greyderler
    if (!sermeMi) return greyderler;
    // Serme: çoklu chip seçimi + yakınında damper olan greyder hatları
    return greyderler
      .filter((k) => seciliGreyderler.has(k.plaka))
      .filter((k) => yakinDamperVar(k.noktalar ?? [], damperKoordlu));
  }, [greyderler, seciliGreyderler, sermeMi, damperKoordlu]);

  function harita(hedef: HTMLDivElement): { iptal: () => void } {
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !hedef) return;
      map = L.map(hedef).setView(gorunumRef.current?.merkez ?? [39, 35], gorunumRef.current?.zoom ?? 6);
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
      canliLayerRef.current = canliKatmanKur(L, map, canliVeriRef.current.konumlar, canliVeriRef.current.cihazMap);
      const bounds: [number, number][] = [];
      // Altlı üstlü greyder çizgisi (sıkıştırmada soluk referans)
      gosterilenGreyder.forEach((k) =>
        cizAltUst(L, map!, parcalar(k.noktalar ?? [], etkinTekrar, gridMesafe), sermeMi ? greyderRenkAl(k.plaka) : reglajRenkV, sermeMi ? 0.85 : 0.45, sermeMi ? sermeKal : reglajKal, bounds));
      if (sermeMi) {
        // Ortada damper ikonları
        damperKoordlu.forEach((o, i) => {
          L.circleMarker([o.lat as number, o.lng as number], { radius: 7, color: "#9a3412", fillColor: DAMPER_RENK, fillOpacity: 0.9, weight: 2 })
            .addTo(map!).bindPopup(`<b>🔻 ${o.plaka}</b> · Damper ${i + 1}<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
          bounds.push([o.lat as number, o.lng as number]);
        });
      } else {
        // Ortada silindir zikzak (silindir tekrar eşiğiyle sadeleşir)
        secilenSilindirler.forEach((k) =>
          parcalar(k.noktalar ?? [], etkinSilindir, gridMesafe).forEach((seg) => {
            if (seg.length < 2) return;
            L.polyline(zikzakla(seg), { color: silindirRenkAl(k.plaka), weight: silindirKal, opacity: 0.9 })
              .addTo(map!).bindPopup(`<b>${k.plaka}</b> (silindir)<br>${k.arac_sinifi ?? ""}`);
            for (const ll of seg) bounds.push(ll);
          }));
      }
      // Yalnızca İLK açılışta otomatik ortala; sonrasında (tarih/seçim/toggle dahil) mevcut görünümü KORU
      if (gorunumRef.current) {
        map.setView(gorunumRef.current.merkez, gorunumRef.current.zoom, { animate: false });
      } else if (bounds.length) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      }
      setTimeout(() => { oto = false; }, 600); // programatik hareketler bitti → kullanıcı hareketlerini dinle
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return { iptal: () => { iptal = true; canliLayerRef.current = null; if (map) { try { map.remove(); } catch { /* sessiz */ } } } };
  }

  useEffect(() => {
    if (!bas || !bitis || !mapRef.current) return;
    const h = harita(mapRef.current);
    return h.iptal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bas, bitis, gosterilenGreyder, greyderRenkAl, secilenSilindirler, silindirRenkAl, damperKoordlu, etkinTekrar, etkinSilindir, gridMesafe, sermeMi, sermeKal, silindirKal, reglajKal, sermeRenkV, silindirRenkV, reglajRenkV]);

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
    const baslik = `${def.ad} ${bas === bitis ? bas : `${bas}_${bitis}`}`;
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
  if (!bas || !bitis) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Layers size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">Yukarıdan bir tarih aralığı seçin.</p>
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
          {formatAralik(bas, bitis)} için <strong style={{ color: def.renk }}>{def.ad}</strong> verisi yok.
          <br />{sermeMi
            ? "Greyder Mesafe Bilgisi ve/veya damper raporunu yükleyin."
            : "Greyder Mesafe Bilgisi (alan) ve silindir Mesafe Bilgisi raporunu yükleyin."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Sol: araç chip'leri (serme→greyder, sıkıştırma→silindir) + Güzergahı Göster */}
          <div className="flex flex-wrap items-center gap-1.5">
            {chipler.length === 0 && <span className="text-xs text-gray-400">{sermeMi ? "Greyder yok." : "Silindir yok."}</span>}
            {chipler.map((k) => {
              const secili = sermeMi ? seciliGreyderler.has(k.plaka) : seciliSilindirler.has(k.plaka);
              const renk = sermeMi ? greyderRenkAl(k.plaka) : silindirRenkAl(k.plaka);
              return (
                <button key={k.plaka} type="button" onClick={() => (sermeMi ? greyderToggle(k.plaka) : silindirToggle(k.plaka))}
                  title={`${k.plaka}${k.arac_sinifi ? " · " + k.arac_sinifi : ""}`}
                  style={secili ? { borderColor: renk, background: renk + "14" } : undefined}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors ${secili ? "text-gray-800" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renk, opacity: secili ? 1 : 0.4 }} />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="font-semibold flex items-center gap-1">{k.plaka}{k.arac_sinifi && <span className="text-[10px] font-normal opacity-60">{k.arac_sinifi}</span>}</span>
                    <span className="text-[10px] opacity-90">{Math.round(k.toplam_mesafe ?? 0)} km</span>
                    {/* Kontak açık + rölanti — alt alta */}
                    {kontakRolantiMap && (
                      <>
                        <span className="text-[10px] opacity-80">⏱ {formatSure(kontakRolantiMap.get(plakaNorm(k.plaka))?.kontak ?? 0)} kontak açık</span>
                        <span className="text-[10px] opacity-80">⏳ {formatSure(kontakRolantiMap.get(plakaNorm(k.plaka))?.rolanti ?? 0)} rölanti</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
            <button type="button" onClick={() => setHamGoster((v) => !v)}
              title="Açıkken tüm Tanımlamalar filtreleri (tekrar + silindir eşiği) yok sayılır — ham veri gösterilir"
              className={`self-center px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${hamGoster ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {hamGoster ? "✓ Güzergahı Göster" : "Güzergahı Göster"}
            </button>
          </div>
          {/* Sağ: özet + KML */}
          <div className="flex items-start gap-3">
            <div className="text-xs text-gray-600 text-right leading-relaxed">
              <div className="flex items-center justify-end gap-1">
                <span className="inline-flex flex-col gap-0.5">
                  <span className="inline-block w-4 h-0.5 rounded" style={{ background: sermeMi ? sermeRenkV : reglajRenkV }} />
                  <span className="inline-block w-4 h-0.5 rounded" style={{ background: sermeMi ? sermeRenkV : reglajRenkV }} />
                </span>
                <strong style={{ color: sermeMi ? sermeRenkV : silindirRenkV }}>{def.ad}</strong>
                <span className="text-gray-400">· {gosterilenGreyder.length} greyder alanı</span>
              </div>
              <div>
                {sermeMi
                  ? <span className="text-orange-600 font-semibold">🔻 {damperKoordlu.length} damper</span>
                  : <span style={{ color: silindirRenkV }} className="font-semibold">⩘ {secilenSilindirler.length} silindir zikzak</span>}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
              <Download size={14} /> KML İndir
            </Button>
          </div>
        </div>
      </div>

      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "62vh" }} />
    </div>
  );
}
