// Arvento Serme & Sıkıştırma haritaları.
// Temel: greyder (reglaj) güzergahı ALTLI ÜSTLÜ (paralel çift) çizgi olarak çizilir.
//   - Serme      → altlı üstlü çizgi (yeşil) + ortada kamyon damper ikonları
//   - Sıkıştırma → altlı üstlü çizgi (yeşil, soluk referans) + ortada silindir ZİKZAK (mor)
// Greyder çizgisi "Güzergah Tekrar Eşiği", silindir zikzak "Silindir Tekrar Eşiği" ile sadeleşir.
// Harita uydu (Google Earth) görünümünde.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange, plakaNorm } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah, kapsananYolKm } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar, type KatmanIzin } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, aracKonumunaOdaklan, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject, ReactNode } from "react";
import { OPERASYONLAR, operasyondaGorunur, atananSekmeleriHesapla, zikzakla, paralelCizgi, type OperasyonTip, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import { damperKamyonIkonHtml } from "@/lib/arvento/damper-ikon";
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
function cizAltUst(L: LeafletStatic, hedef: LeafletMap | LayerGroup, segler: [number, number][][], renk: string, opacity: number, kalinlik: number, bounds: [number, number][]) {
  for (const seg of segler) {
    if (seg.length < 2) continue;
    L.polyline(paralelCizgi(seg, OFFSET_M), { color: renk, weight: kalinlik, opacity }).addTo(hedef);
    L.polyline(paralelCizgi(seg, -OFFSET_M), { color: renk, weight: kalinlik, opacity }).addTo(hedef);
    for (const ll of seg) bounds.push(ll);
  }
}

export default function ArventoOperasyon({ bas, bitis, operasyon, tekrarEsigi = 0, silindirEsik = 0, gridMesafe = 12, kalinliklar, renkler, kontakRolantiMap, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, modelGoster = false, modelMap, ilkSonKontakMap, izinliPlakalar, katmanIzinli, refreshKey = 0, sonGuncelleme, canliButton }: {
  bas: string; bitis: string; operasyon: OperasyonTip; tekrarEsigi?: number; silindirEsik?: number; gridMesafe?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; kontakRolantiMap?: Map<string, { kontak: number; rolanti: number }>; ilkSonKontakMap?: Map<string, { ilk: string | null; son: string | null }>; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; modelGoster?: boolean; modelMap?: Map<string, string | null>; izinliPlakalar?: string[] | null; katmanIzinli?: KatmanIzin; refreshKey?: number; sonGuncelleme?: Date | null; canliButton?: ReactNode;
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
  const [tumGuzergahHam, setTumGuzergah] = useState<AracArventoGuzergah[]>([]);
  const [raporlarHam, setRaporlar] = useState<AracArventoRapor[]>([]);
  // İZİN FİLTRESİ: kısıtlı kullanıcı yalnız izinli plakaları (yakınlık şantiyesine göre) görür.
  const izinSet = useMemo(() => (izinliPlakalar ? new Set(izinliPlakalar.map(plakaNorm)) : null), [izinliPlakalar]);
  const tumGuzergah = useMemo(() => (izinSet ? tumGuzergahHam.filter((k) => izinSet.has(plakaNorm(k.plaka))) : tumGuzergahHam), [tumGuzergahHam, izinSet]);
  const raporlar = useMemo(() => (izinSet ? raporlarHam.filter((k) => izinSet.has(plakaNorm(k.plaka))) : raporlarHam), [raporlarHam, izinSet]);
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
  // Canlı: SADECE bu operasyona (serme/sıkıştırma) atanmış araçların konumu gösterilir.
  const atananSekmeler = useMemo(() => atananSekmeleriHesapla(sekmeMap), [sekmeMap]);
  const canliFiltreli = useMemo<CanliKonum[] | undefined>(() => {
    if (!canliKonumlar) return undefined;
    const op: OperasyonTip = sermeMi ? "serme" : "sikistirma";
    return canliKonumlar.filter((k) => {
      const plaka = k.node ? canliCihazMap?.get(k.node.trim())?.plaka : null;
      return plaka ? operasyondaGorunur(sekmeMap, atananSekmeler, null, op, plaka) : false;
    });
  }, [canliKonumlar, canliCihazMap, sekmeMap, atananSekmeler, sermeMi]);
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliFiltreli, cihazMap: canliCihazMap };
  const katmanIzinliRef = useRef(katmanIzinli); katmanIzinliRef.current = katmanIzinli; // KML izin filtresi
  const canliVar = (canliFiltreli?.length ?? 0) > 0; // toggle'da değişir, pozisyon güncellemesinde değişmez
  useCanliKatman(canliLayerRef, canliFiltreli, canliCihazMap);

  const yapiRef = useRef(""); // yükleme göstergesi yalnız tarih/operasyon değişiminde; periyodik tazelemede sessiz
  useEffect(() => {
    if (!bas || !bitis) { setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    const yapi = `${bas}|${bitis}|${sermeMi}`;
    const yapisal = yapiRef.current !== yapi;
    if (yapisal) { yapiRef.current = yapi; setLoading(true); }
    Promise.all([getGuzergahByRange(bas, bitis), getArventoRaporByRange(bas, bitis)])
      .then(([g, r]) => { setTumGuzergah(g); setRaporlar(r as AracArventoRapor[]); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => { if (yapisal) setLoading(false); });
  }, [bas, bitis, refreshKey, sermeMi]);

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
  const silindirImzaRef = useRef("");
  useEffect(() => {
    const imza = silindirChipler.map((k) => k.plaka).sort().join("|");
    if (silindirImzaRef.current === imza) return; // aynı araç kümesi → seçimi koru (periyodik tazelemede sıfırlama)
    silindirImzaRef.current = imza;
    setSeciliSilindirler(new Set(silindirChipler.map((k) => k.plaka)));
  }, [silindirChipler]);
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
  const greyderImzaRef = useRef("");
  useEffect(() => {
    const imza = greyderler.map((k) => k.plaka).sort().join("|");
    if (greyderImzaRef.current === imza) return; // aynı araç kümesi → seçimi koru
    greyderImzaRef.current = imza;
    setSeciliGreyderler(new Set(greyderler.map((k) => k.plaka)));
  }, [greyderler]);
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

  // Sağ-tık "Araca odaklan" menüsü — haritayı aracın canlı konumuna/güzergahına götürür.
  const [odakMenu, setOdakMenu] = useState<{ x: number; y: number; plaka: string } | null>(null);
  useEffect(() => {
    if (!odakMenu) return;
    const kapat = () => setOdakMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOdakMenu(null); };
    window.addEventListener("click", kapat);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("click", kapat); window.removeEventListener("keydown", esc); };
  }, [odakMenu]);
  const aracaOdaklan = useCallback((plaka: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const rota = tumGuzergah.find((k) => plakaNorm(k.plaka) === plakaNorm(plaka))?.noktalar;
    if (!aracKonumunaOdaklan(map, plaka, canliVeriRef.current, rota, plakaNorm))
      toast.error("Aracın konumu bulunamadı (canlı kapalı ve güzergah yok).", { duration: toastSuresi() });
  }, [tumGuzergah]);

  // "km yol" — KAPSANAN YOL: aracın dokunduğu TÜM benzersiz yolların toplamı (git-gel/yan şerit tek
  // sayılır; bağlı yollar dahil hepsi toplanır). Kararlı; sadeleştirme eşiğinden bağımsız.
  const omurgaKmMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of sermeMi ? greyderler : silindirler) {
      const ns = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (ns.length < 2) continue;
      m.set(k.plaka, kapsananYolKm(ns, gridMesafe));
    }
    return m;
  }, [sermeMi, greyderler, silindirler, gridMesafe]);

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

  // Haritayı BİR KEZ kur. Yeniden kurulmaz → veri değişince tile reload / flicker OLMAZ.
  useEffect(() => {
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      leafletRef.current = L as unknown as typeof import("leaflet");
      map = L.map(mapRef.current, { zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 200 }) // tekerlek başına AZ zoom + ince adımlar
        .setView(gorunumRef.current?.merkez ?? [39, 35], gorunumRef.current?.zoom ?? 6);
      mapInstanceRef.current = map;
      let oto = true; // programatik (setView/fitBounds) hareketleri kullanıcı hareketinden ayır — gorunumRef'i kirletmesin
      map.on("moveend zoomend", () => {
        if (oto || !map) return;
        const c = map.getCenter();
        gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
      });
      ekleHaritaKatmanlari(L, map, "uydu");
      ekleOlcumKontrolu(L, map);
      await ekleKayitliKatmanlar(L, map, (k) => (katmanIzinliRef.current ? katmanIzinliRef.current(k) : true));
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

  // Veri/seçim/ayar değişince YALNIZ veri katmanını yeniden çiz (harita yerinde kalır → flicker yok).
  useEffect(() => {
    const map = mapInstanceRef.current;
    const grup = veriKatmanRef.current;
    const L = leafletRef.current;
    if (!map || !grup || !L) return;
    grup.clearLayers();
    const bounds: [number, number][] = [];
    // Altlı üstlü greyder çizgisi (sıkıştırmada soluk referans)
    gosterilenGreyder.forEach((k) =>
      cizAltUst(L, grup, parcalar(k.noktalar ?? [], etkinTekrar, gridMesafe), sermeMi ? greyderRenkAl(k.plaka) : reglajRenkV, sermeMi ? 0.85 : 0.45, sermeMi ? sermeKal : reglajKal, bounds));
    if (sermeMi) {
      // Ortada damper ikonları
      damperKoordlu.forEach((o, i) => {
        L.marker([o.lat as number, o.lng as number], { icon: L.divIcon({ html: damperKamyonIkonHtml(DAMPER_RENK, 1), className: "damper-ikon", iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -15] }) })
          .addTo(grup).bindPopup(`<b>🔻 ${o.plaka}</b> · Damper ${i + 1}<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
        bounds.push([o.lat as number, o.lng as number]);
      });
    } else {
      // Ortada silindir zikzak (silindir tekrar eşiğiyle sadeleşir)
      secilenSilindirler.forEach((k) =>
        parcalar(k.noktalar ?? [], etkinSilindir, gridMesafe).forEach((seg) => {
          if (seg.length < 2) return;
          L.polyline(zikzakla(seg), { color: silindirRenkAl(k.plaka), weight: silindirKal, opacity: 0.9 })
            .addTo(grup).bindPopup(`<b>${k.plaka}</b> (silindir)<br>${k.arac_sinifi ?? ""}`);
          for (const ll of seg) bounds.push(ll);
        }));
    }
    // Canlı açıksa araç konumlarını da çerçeveye kat (rota verisi olmayan günde canlıya odaklan)
    for (const k of canliVeriRef.current.konumlar ?? []) {
      if (k.lat != null && k.lng != null) bounds.push([k.lat, k.lng]);
    }
    // Yalnızca İLK açılışta otomatik ortala; sonra mevcut görünümü KORU.
    if (!gorunumRef.current && bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      const c = map.getCenter();
      gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
    }
  }, [haritaHazir, gosterilenGreyder, greyderRenkAl, secilenSilindirler, silindirRenkAl, damperKoordlu, etkinTekrar, etkinSilindir, gridMesafe, sermeMi, sermeKal, silindirKal, reglajKal, sermeRenkV, silindirRenkV, reglajRenkV, gorunumRef]);

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
  const veriYok = (sermeMi
    ? greyderler.length === 0 && damperKoordlu.length === 0
    : greyderler.length === 0 && silindirler.length === 0) && !canliVar;
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
    <div className="space-y-3 harita-tamekran-kapsayici relative">
      <div className="bg-white rounded-lg border p-3 harita-arac-panel">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Sol: araç chip'leri (serme→greyder, sıkıştırma→silindir) + Güzergahı Göster */}
          <div className="flex flex-wrap items-center gap-1.5">
            {chipler.length === 0 && <span className="text-xs text-gray-400">{sermeMi ? "Greyder yok." : "Silindir yok."}</span>}
            {chipler.map((k) => {
              const secili = sermeMi ? seciliGreyderler.has(k.plaka) : seciliSilindirler.has(k.plaka);
              const renk = sermeMi ? greyderRenkAl(k.plaka) : silindirRenkAl(k.plaka);
              return (
                <button key={k.plaka} type="button"
                  onClick={() => { if (sermeMi) greyderToggle(k.plaka); else silindirToggle(k.plaka); }}
                  onDoubleClick={() => aracaOdaklan(k.plaka)}
                  onContextMenu={(e) => { e.preventDefault(); setOdakMenu({ x: e.clientX, y: e.clientY, plaka: k.plaka }); }}
                  title={`${k.plaka}${k.arac_sinifi ? " · " + k.arac_sinifi : ""} — çift tıkla/dokun: araca odaklan`}
                  style={secili ? { borderColor: renk, background: renk + "14" } : undefined}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors select-none touch-manipulation ${secili ? "text-gray-800" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renk, opacity: secili ? 1 : 0.4 }} />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="font-semibold flex items-center gap-1">{k.plaka}{(() => { const ik = modelGoster ? (modelMap?.get(plakaNorm(k.plaka)) || k.arac_sinifi) : k.arac_sinifi; return ik ? <span className="text-[10px] font-normal opacity-60">{ik}</span> : null; })()}</span>
                    <span className="text-[10px] opacity-90" title={omurgaKmMap.get(k.plaka) != null ? "Yol uzunluğu — haritadaki tek çizgi (git-gel tekrarları sayılmaz)" : "Toplam kat edilen mesafe"}>
                      {omurgaKmMap.get(k.plaka) != null
                        ? `${omurgaKmMap.get(k.plaka)!.toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km yol`
                        : `${Math.round(k.toplam_mesafe ?? 0)} km`}
                    </span>
                    {/* SIRA: ilk kontak → kontak açık/rölanti → son kontak */}
                    {ilkSonKontakMap?.get(plakaNorm(k.plaka))?.ilk && (
                      <span className="text-[10px] text-emerald-600">🟢 {ilkSonKontakMap.get(plakaNorm(k.plaka))!.ilk!.slice(0, 5)} ilk kontak</span>
                    )}
                    {kontakRolantiMap && (
                      <>
                        <span className="text-[10px] opacity-80">⏱ {formatSure(kontakRolantiMap.get(plakaNorm(k.plaka))?.kontak ?? 0)} kontak açık</span>
                        <span className="text-[10px] opacity-80">⏳ {formatSure(kontakRolantiMap.get(plakaNorm(k.plaka))?.rolanti ?? 0)} rölanti</span>
                      </>
                    )}
                    {ilkSonKontakMap?.get(plakaNorm(k.plaka))?.son && (
                      <span className="text-[10px] text-red-600">🔴 {ilkSonKontakMap.get(plakaNorm(k.plaka))!.son!.slice(0, 5)} son kontak</span>
                    )}
                  </span>
                </button>
              );
            })}
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
              {sonGuncelleme && (
                <div className="text-[10px] text-gray-400 mt-0.5">🕒 Rapor güncellendi: <b className="text-gray-500">{sonGuncelleme.toLocaleTimeString("tr-TR")}</b></div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setHamGoster((v) => !v)}
                title="Açıkken tüm Tanımlamalar filtreleri (tekrar + silindir eşiği) yok sayılır — ham veri gösterilir"
                className={`h-9 px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${hamGoster ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                {hamGoster ? "✓ Güzergahı Göster" : "Güzergahı Göster"}
              </button>
              <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
                <Download size={14} /> KML İndir
              </Button>
              {canliButton}
            </div>
          </div>
        </div>
      </div>

      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100 harita-leaflet" style={{ height: "62vh" }} />

      {/* Sağ-tık menüsü — Araca odaklan */}
      {odakMenu && (
        <div className="fixed z-[1401] bg-white rounded-lg border shadow-lg py-1 text-xs" style={{ left: odakMenu.x, top: odakMenu.y }}>
          <button type="button" onClick={() => { aracaOdaklan(odakMenu.plaka); setOdakMenu(null); }}
            className="px-3 py-1.5 hover:bg-gray-100 w-full text-left flex items-center gap-1.5 whitespace-nowrap">
            🎯 <b>{odakMenu.plaka}</b> — Araca odaklan
          </button>
        </div>
      )}
    </div>
  );
}
