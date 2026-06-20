// Arvento Güzergah (Reglaj) sekmesi — "Mesafe Bilgisi" raporundan araçların
// günlük GPS noktalarını haritada rota çizgisi (polyline) olarak gösterir.
// Araçlar Stabilize'daki kamyonlar gibi yan yana renkli chip'ler olarak listelenir;
// tıklayarak çoklu seçim yapılır, her araç kendi renginde çizilir.
// TARİH SEÇİMİ YOK: tarih, sayfanın üstündeki ana tarihten (prop) gelir.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, plakaNorm } from "@/lib/supabase/queries/arvento";
import { atananSekmeleriHesapla, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject } from "react";
import type { AracArventoGuzergah } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Route, Download } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

// Her araca ayırt edici sabit renk (Stabilize kamyon paletiyle aynı).
const ARAC_RENKLERI = [
  "#ef4444", "#06b6d4", "#84cc16", "#a855f7", "#f59e0b", "#ec4899",
  "#10b981", "#f97316", "#3b82f6", "#d946ef", "#14b8a6", "#eab308",
  "#8b5cf6", "#22c55e", "#f43f5e", "#0ea5e9",
];

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
// saniye → "2sa 15dk" / "0"
function formatSure(sn: number): string {
  if (!sn) return "0";
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  return sa > 0 ? `${sa}sa ${dk}dk` : `${dk}dk`;
}
function formatAralik(bas: string, bitis: string): string {
  if (!bas) return "—";
  return bas === bitis ? formatTarih(bas) : `${formatTarih(bas)} – ${formatTarih(bitis)}`;
}
// #rrggbb → KML aabbggrr
function kmlRenk(hex: string): string {
  return "ff" + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
}

type GuzergahArac = {
  plaka: string;
  arac_sinifi: string | null;
  marka?: string | null;
  model?: string | null;
  toplam_mesafe: number | null;
  noktalar?: { saat: string | null; lat: number; lng: number; hiz: number | null }[];
};

export default function ArventoGuzergah({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, kalinliklar, plakaFiltre, ekstraAraclar, calismaSnMap, kontakRolantiMap, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, baslik = "Araçlar (Reglaj)", refreshKey = 0 }: { bas: string; bitis: string; tekrarEsigi?: number; gridMesafe?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; plakaFiltre?: string[]; ekstraAraclar?: { plaka: string; arac_sinifi: string | null; toplam_mesafe: number | null }[]; calismaSnMap?: Map<string, number>; kontakRolantiMap?: Map<string, { kontak: number; rolanti: number }>; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; baslik?: string; refreshKey?: number }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const [kayitlar, setKayitlar] = useState<AracArventoGuzergah[]>([]);
  const [seciliPlakalar, setSeciliPlakalar] = useState<Set<string>>(new Set());
  const [hamGoster, setHamGoster] = useState(false); // açıkken tüm Tanımlamalar filtreleri yok sayılır (ham rota)
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const yerelGorunumRef = useRef<HaritaGorunum | null>(null);
  const gorunumRef = disGorunumRef ?? yerelGorunumRef; // dışarıdan verilirse sekmeler arası PAYLAŞILAN görünüm
  const canliLayerRef = useRef<LayerGroup | null>(null);
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliKonumlar, cihazMap: canliCihazMap };
  const canliVar = (canliKonumlar?.length ?? 0) > 0; // toggle'da değişir, pozisyon güncellemesinde değişmez
  useCanliKatman(canliLayerRef, canliKonumlar, canliCihazMap);
  const etkinTekrar = hamGoster ? 0 : tekrarEsigi;

  // Aralığın kayıtlarını yükle
  useEffect(() => {
    if (!bas || !bitis) { setKayitlar([]); setLoading(false); return; }
    setLoading(true);
    getGuzergahByRange(bas, bitis)
      .then((k) => setKayitlar(k))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist") || msg.includes("arac_arvento_guzergah")) {
          toast.error("arac_arvento_guzergah tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
        }
      })
      .finally(() => setLoading(false));
  }, [bas, bitis, refreshKey]);

  // plakaFiltre verilmişse (İş Makineleri haritası) sadece o plakalar gösterilir.
  // ekstraAraclar: güzergahı OLMAYAN araçlar da chip olarak görünsün (rapordan; 0 km olsa da).
  const araclar = useMemo<GuzergahArac[]>(() => {
    // plakaFiltre (İş Makineleri haritası) verildiyse o liste kesin; verilmediyse Reglaj sekmesidir:
    // atama VARSA yalnız "reglaj" atanmışlar; atama YOKSA mevcut davranış (tüm güzergahlar).
    const atananSekmeler = atananSekmeleriHesapla(sekmeMap);
    const guzergahli: GuzergahArac[] = plakaFiltre
      ? kayitlar.filter((k) => new Set(plakaFiltre.map(plakaNorm)).has(plakaNorm(k.plaka)))
      : kayitlar.filter((k) => {
          const atama = sekmeMap?.get(plakaNorm(k.plaka));
          // Atama varsa kesin; yoksa "reglaj"a başka araç atanmışsa gizle, değilse tüm güzergahlar.
          return atama ? atama.includes("reglaj") : !atananSekmeler.has("reglaj");
        });
    if (!ekstraAraclar || ekstraAraclar.length === 0) return guzergahli;
    const varPlaka = new Set(guzergahli.map((k) => plakaNorm(k.plaka)));
    const ekstra: GuzergahArac[] = ekstraAraclar
      .filter((e) => !varPlaka.has(plakaNorm(e.plaka)))
      .map((e) => ({ plaka: e.plaka, arac_sinifi: e.arac_sinifi, toplam_mesafe: e.toplam_mesafe }));
    return [...guzergahli, ...ekstra];
  }, [kayitlar, plakaFiltre, ekstraAraclar, sekmeMap]);

  // Veri değişince varsayılan: tüm araçlar seçili
  useEffect(() => {
    setSeciliPlakalar(new Set(araclar.map((k) => k.plaka)));
  }, [araclar]);

  // Her araca sabit renk
  const plakaRenk = useMemo(() => {
    const m = new Map<string, string>();
    araclar.forEach((k, i) => m.set(k.plaka, ARAC_RENKLERI[i % ARAC_RENKLERI.length]));
    return m;
  }, [araclar]);
  const renkAl = useCallback((p: string) => plakaRenk.get(p) ?? "#2563eb", [plakaRenk]);

  const toggle = (p: string) => setSeciliPlakalar((s) => {
    const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n;
  });
  const secilenler = useMemo(() => araclar.filter((k) => seciliPlakalar.has(k.plaka)), [araclar, seciliPlakalar]);

  const ozet = useMemo(() => {
    const toplamKm = secilenler.reduce((s, k) => s + (k.toplam_mesafe ?? 0), 0);
    const toplamNokta = secilenler.reduce((s, k) => s + (k.noktalar?.length ?? 0), 0);
    return { arac: secilenler.length, toplamKm, toplamNokta };
  }, [secilenler]);

  // Harita: seçili her aracın rotasını kendi renginde çiz
  useEffect(() => {
    if (!bas || !bitis) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      map = L.map(mapRef.current).setView(gorunumRef.current?.merkez ?? [39, 35], gorunumRef.current?.zoom ?? 6);
      let oto = true; // programatik (setView/fitBounds) hareketleri kullanıcı hareketinden ayır — gorunumRef'i kirletmesin
      map.on("moveend zoomend", () => {
        if (oto || !map) return;
        const c = map.getCenter();
        gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
      });
      ekleHaritaKatmanlari(L, map, "uydu");
      ekleOlcumKontrolu(L, map);
      await ekleKayitliKatmanlar(L, map);
      if (iptal || !map) return;
      canliLayerRef.current = canliKatmanKur(L, map, canliVeriRef.current.konumlar, canliVeriRef.current.cihazMap);
      const tumBounds: [number, number][] = [];
      const tekMi = secilenler.length === 1;
      for (const kayit of secilenler) {
        const noktalar = (kayit.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) continue;
        const renk = renkAl(kayit.plaka);
        const pop = `<b>${kayit.plaka}</b>${kayit.arac_sinifi ? " · " + kayit.arac_sinifi : ""}<br>${kayit.toplam_mesafe ?? 0} km · ${noktalar.length} nokta`;
        if (etkinTekrar >= 1) {
          const cizgiler = sadelesGuzergah(noktalar, etkinTekrar, gridMesafe).parcalar;
          L.polyline(cizgiler.length ? cizgiler : [latlngs], { color: renk, weight: reglajKal, opacity: 0.85 }).addTo(map).bindPopup(pop);
        } else {
          L.polyline(latlngs, { color: renk, weight: reglajKal, opacity: 0.85 }).addTo(map).bindPopup(pop);
          if (tekMi) {
            for (const p of noktalar) {
              L.circleMarker([p.lat, p.lng], { radius: 3, color: renk, fillColor: renk, fillOpacity: 0.6, weight: 1 })
                .addTo(map).bindPopup(`${p.saat ?? ""}<br>Hız: ${p.hiz ?? "—"} km/s`);
            }
          }
        }
        // Başlangıç/bitiş işareti sadece tek araç seçiliyken (çoklu seçimde kalabalık olmasın)
        if (tekMi) {
          const ilk = latlngs[0], son = latlngs[latlngs.length - 1];
          L.circleMarker(ilk, { radius: 8, color: "#15803d", fillColor: "#22c55e", fillOpacity: 0.9, weight: 2 })
            .addTo(map).bindPopup(`<b>BAŞLANGIÇ</b><br>${noktalar[0].saat ?? ""}`);
          L.circleMarker(son, { radius: 8, color: "#991b1b", fillColor: "#ef4444", fillOpacity: 0.9, weight: 2 })
            .addTo(map).bindPopup(`<b>BİTİŞ</b><br>${noktalar[noktalar.length - 1].saat ?? ""}`);
        }
        for (const ll of latlngs) tumBounds.push(ll);
      }
      // Canlı açıksa araç konumlarını da çerçeveye kat (rota verisi olmayan günde canlıya odaklan)
      for (const k of canliVeriRef.current.konumlar ?? []) {
        if (k.lat != null && k.lng != null) tumBounds.push([k.lat, k.lng]);
      }
      // Yalnızca İLK açılışta otomatik ortala; sonrasında (tarih/seçim/toggle dahil) mevcut görünümü KORU
      if (gorunumRef.current) {
        map.setView(gorunumRef.current.merkez, gorunumRef.current.zoom, { animate: false });
      } else if (tumBounds.length) {
        map.fitBounds(tumBounds, { padding: [40, 40], maxZoom: 17 });
      }
      setTimeout(() => { oto = false; }, 600); // programatik hareketler bitti → kullanıcı hareketlerini dinle
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return () => { iptal = true; canliLayerRef.current = null; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [secilenler, etkinTekrar, gridMesafe, reglajKal, renkAl, bas, bitis, gorunumRef, canliVar]);

  // KML export — seçili tüm araçların rotaları (her biri kendi renginde)
  function exportKML() {
    if (secilenler.length === 0) { toast.error("Seçili araç yok.", { duration: toastSuresi() }); return; }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let stiller = "";
    let placemarks = "";
    secilenler.forEach((kayit, idx) => {
      const noktalar = (kayit.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return;
      const coords = noktalar.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      const sid = `r${idx}`;
      stiller += `<Style id="${sid}"><LineStyle><color>${kmlRenk(renkAl(kayit.plaka))}</color><width>4</width></LineStyle></Style>`;
      placemarks += `
    <Placemark><name>${esc(kayit.plaka)} rotası</name><description>${esc(`${kayit.arac_sinifi ?? ""} ${kayit.marka ?? ""} ${kayit.model ?? ""} · ${noktalar.length} nokta · ${kayit.toplam_mesafe ?? 0} km`)}</description><styleUrl>#${sid}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    });
    if (!placemarks) { toast.error("Rota verisi yok.", { duration: toastSuresi() }); return; }
    const dosyaBaslik = `${baslik.replace(/[^\w]+/g, "_")}_${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(dosyaBaslik)}</name>${stiller}${placemarks}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dosyaBaslik.replace(/[^\w-]+/g, "_")}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Reglaj KML olarak indirildi.", { duration: toastSuresi() });
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
  if (araclar.length === 0 && !(canliKonumlar && canliKonumlar.length > 0)) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Route size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">
          {formatAralik(bas, bitis)} için {plakaFiltre ? "bu makinelere ait güzergah (Mesafe Bilgisi)" : "güzergah (Mesafe Bilgisi)"} verisi yok.
          <br />Üstteki tarihi değiştirin ya da &quot;Excel Yükle&quot; ile Mesafe Bilgisi raporu yükleyin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Araç chip'leri (yan yana, çoklu seçim — renkli) + özet + KML */}
      <div className="bg-white rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Sol: araç chip'leri + Güzergahı Göster */}
          <div className="flex flex-wrap items-center gap-1.5">
          {araclar.map((k) => {
            const secili = seciliPlakalar.has(k.plaka);
            const renk = renkAl(k.plaka);
            return (
              <button key={k.plaka} type="button" onClick={() => toggle(k.plaka)}
                title={`${k.plaka}${k.arac_sinifi ? " · " + k.arac_sinifi : ""}${k.marka ? " · " + k.marka : ""}`}
                style={secili ? { borderColor: renk, background: renk + "14" } : undefined}
                className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors ${
                  secili ? "text-gray-800" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                }`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renk, opacity: secili ? 1 : 0.4 }} />
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-semibold flex items-center gap-1">
                    {k.plaka}
                    {k.arac_sinifi && <span className="text-[10px] font-normal opacity-60">{k.arac_sinifi}</span>}
                  </span>
                  <span className="text-[10px] opacity-90 flex items-center gap-1.5">
                    <span>{Math.round(k.toplam_mesafe ?? 0)} km</span>
                    <span>{k.noktalar?.length ?? 0} nokta</span>
                  </span>
                  {/* Çalışma saati (iş makineleri) = Kontak Açık süresi */}
                  {calismaSnMap && <span className="text-[10px] opacity-80">⏱ {formatSure(calismaSnMap.get(plakaNorm(k.plaka)) ?? 0)} çalışma</span>}
                  {/* Kontak açık + rölanti (Reglaj) — alt alta */}
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
          {/* Güzergahı Göster (tüm Tanımlamalar filtrelerini yok say) */}
          {araclar.length > 0 && (
            <button type="button" onClick={() => setHamGoster((v) => !v)}
              title="Açıkken tüm Tanımlamalar filtreleri yok sayılır — tam (ham) rota gösterilir"
              className={`self-center px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${hamGoster ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {hamGoster ? "✓ Güzergahı Göster" : "Güzergahı Göster"}
            </button>
          )}
          </div>
          {/* Sağ: özet + KML */}
          <div className="flex items-start gap-3">
            <div className="text-xs text-gray-600 text-right">
              <span className="font-semibold">{ozet.arac}</span>/{araclar.length} araç ·{" "}
              <Route size={12} className="inline" /> <strong className="text-[#1E3A5F]">{ozet.toplamKm.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km</strong> · {ozet.toplamNokta} nokta
            </div>
            <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
              <Download size={14} /> KML İndir
            </Button>
          </div>
        </div>
      </div>

      {/* Harita */}
      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "65vh" }} />
    </div>
  );
}
