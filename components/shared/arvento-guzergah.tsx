// Arvento Güzergah (Reglaj) sekmesi — "Mesafe Bilgisi" raporundan araçların
// günlük GPS noktalarını haritada rota çizgisi (polyline) olarak gösterir.
// Araçlar Stabilize'daki kamyonlar gibi yan yana renkli chip'ler olarak listelenir;
// tıklayarak çoklu seçim yapılır, her araç kendi renginde çizilir.
// TARİH SEÇİMİ YOK: tarih, sayfanın üstündeki ana tarihten (prop) gelir.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, plakaNorm } from "@/lib/supabase/queries/arvento";
import { atananSekmeleriHesapla, operasyondaGorunur, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import { sadelesGuzergah, kapsananYolKm, parcalarUzunlukKm } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar, type KatmanIzin } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject, ReactNode } from "react";
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

export default function ArventoGuzergah({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, kalinliklar, plakaFiltre, ekstraAraclar, calismaSnMap, kontakRolantiMap, ilkSonKontakMap, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, baslik = "Araçlar (Reglaj)", modelGoster = false, modelMap, izinliPlakalar, katmanIzinli, refreshKey = 0, sonGuncelleme, canliButton }: { bas: string; bitis: string; tekrarEsigi?: number; gridMesafe?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; plakaFiltre?: string[]; ekstraAraclar?: { plaka: string; arac_sinifi: string | null; toplam_mesafe: number | null; model?: string | null }[]; calismaSnMap?: Map<string, number>; kontakRolantiMap?: Map<string, { kontak: number; rolanti: number }>; ilkSonKontakMap?: Map<string, { ilk: string | null; son: string | null; ilkT?: boolean; sonT?: boolean }>; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; baslik?: string; modelGoster?: boolean; modelMap?: Map<string, string | null>; izinliPlakalar?: string[] | null; katmanIzinli?: KatmanIzin; refreshKey?: number; sonGuncelleme?: Date | null; canliButton?: ReactNode }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const [kayitlar, setKayitlar] = useState<AracArventoGuzergah[]>([]);
  const [seciliPlakalar, setSeciliPlakalar] = useState<Set<string>>(new Set());
  const [hamGoster, setHamGoster] = useState(false); // açıkken tüm Tanımlamalar filtreleri yok sayılır (ham rota)
  const [loading, setLoading] = useState(true);
  const [odakMenu, setOdakMenu] = useState<{ x: number; y: number; plaka: string } | null>(null); // sağ-tık menüsü (Araca odaklan)
  const mapRef = useRef<HTMLDivElement>(null);
  const yerelGorunumRef = useRef<HaritaGorunum | null>(null);
  const gorunumRef = disGorunumRef ?? yerelGorunumRef; // dışarıdan verilirse sekmeler arası PAYLAŞILAN görünüm
  const canliLayerRef = useRef<LayerGroup | null>(null);
  // Harita BİR KEZ kurulur; veri ayrı LayerGroup'ta → veri değişince flicker olmaz (sadece grup yeniden çizilir).
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const veriKatmanRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [haritaHazir, setHaritaHazir] = useState(0);
  // Canlı: İş Makineleri haritasında (plakaFiltre) sadece o plakalar; Reglaj sekmesinde sadece
  // "reglaj" atanmış araçlar gösterilir (başka araçlar bu haritada görünmesin).
  const canliFiltreli = useMemo<CanliKonum[] | undefined>(() => {
    if (!canliKonumlar) return undefined;
    const atananSekmeler = atananSekmeleriHesapla(sekmeMap);
    const filtreSet = plakaFiltre ? new Set(plakaFiltre.map(plakaNorm)) : null;
    return canliKonumlar.filter((k) => {
      const plaka = k.node ? canliCihazMap?.get(k.node.trim())?.plaka : null;
      if (!plaka) return false;
      return filtreSet ? filtreSet.has(plakaNorm(plaka)) : operasyondaGorunur(sekmeMap, atananSekmeler, null, "reglaj", plaka);
    });
  }, [canliKonumlar, canliCihazMap, sekmeMap, plakaFiltre]);
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliFiltreli, cihazMap: canliCihazMap };
  const katmanIzinliRef = useRef(katmanIzinli); katmanIzinliRef.current = katmanIzinli; // KML izin filtresi (en güncel)
  useCanliKatman(canliLayerRef, canliFiltreli, canliCihazMap); // canlı katman pozisyon güncellemelerini kendi içinde yönetir
  const etkinTekrar = hamGoster ? 0 : tekrarEsigi;

  // Aralığın kayıtlarını yükle. Yükleme göstergesi yalnız TARİH değişiminde; periyodik tazelemede sessiz.
  const yapiRef = useRef("");
  useEffect(() => {
    if (!bas || !bitis) { setKayitlar([]); setLoading(false); return; }
    const yapi = `${bas}|${bitis}`;
    const yapisal = yapiRef.current !== yapi;
    if (yapisal) { yapiRef.current = yapi; setLoading(true); }
    getGuzergahByRange(bas, bitis)
      .then((k) => setKayitlar(k))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist") || msg.includes("arac_arvento_guzergah")) {
          toast.error("arac_arvento_guzergah tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
        }
      })
      .finally(() => { if (yapisal) setLoading(false); });
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
    const varPlaka = new Set(guzergahli.map((k) => plakaNorm(k.plaka)));
    const ekstra: GuzergahArac[] = (ekstraAraclar ?? [])
      .filter((e) => !varPlaka.has(plakaNorm(e.plaka)))
      .map((e) => ({ plaka: e.plaka, arac_sinifi: e.arac_sinifi, toplam_mesafe: e.toplam_mesafe, model: e.model ?? null }));
    const tum = ekstra.length ? [...guzergahli, ...ekstra] : guzergahli;
    if (!izinliPlakalar) return tum; // yönetici/izin yok → hepsi
    const izin = new Set(izinliPlakalar.map(plakaNorm));
    return tum.filter((k) => izin.has(plakaNorm(k.plaka)));
  }, [kayitlar, plakaFiltre, ekstraAraclar, sekmeMap, izinliPlakalar]);

  // Her SADELEŞTİRİLMİŞ TEK ÇİZGİNİN (omurga parçası) AYRI uzunluğu (km, büyükten küçüğe). Haritada
  // çizilen çizgilerle birebir: git-gel tekrarları sayılmaz. Eşik<1 (ham) ise parça yok → boş.
  const parcaUzunlukMap = useMemo(() => {
    const m = new Map<string, number[]>();
    if (etkinTekrar < 1) return m;
    for (const k of araclar) {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length < 2) continue;
      const uz = sadelesGuzergah(noktalar, etkinTekrar, gridMesafe).parcalar
        .map((p) => parcalarUzunlukKm([p])).filter((u) => u > 0.0005).sort((a, b) => b - a);
      if (uz.length) m.set(k.plaka, uz);
    }
    return m;
  }, [araclar, etkinTekrar, gridMesafe]);
  // "Reglaj km" (TOPLAM): omurga parçaları varsa onların TOPLAMI. EŞİK ≥ 1 ama omurga YOKSA (greyder
  // yolu eşik kadar tekrar taramamış) → reglaj sayılmaz = 0. Yalnız HAM modda (eşik < 1) kapsanan yola düşülür.
  const omurgaKmMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of araclar) {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length < 2) continue;
      const parts = parcaUzunlukMap.get(k.plaka);
      if (parts) m.set(k.plaka, parts.reduce((a, b) => a + b, 0));
      else if (etkinTekrar < 1) m.set(k.plaka, kapsananYolKm(noktalar, gridMesafe)); // ham mod: eşik yok
      else m.set(k.plaka, 0); // eşik var, omurga boş → tekrar yetmedi, reglaj tamamlanmadı
    }
    return m;
  }, [araclar, gridMesafe, parcaUzunlukMap, etkinTekrar]);

  // Araç KÜMESİ değişince varsayılan: tüm araçlar seçili. Periyodik tazelemede aynı plakalar
  // gelirse seçim KORUNUR (kullanıcının kapattığı araçlar geri açılmasın, gereksiz redraw olmasın).
  const plakaImzaRef = useRef("");
  useEffect(() => {
    const imza = araclar.map((k) => k.plaka).sort().join("|");
    if (plakaImzaRef.current === imza) return;
    plakaImzaRef.current = imza;
    setSeciliPlakalar(new Set(araclar.map((k) => k.plaka)));
  }, [araclar]);

  // Sağ-tık menüsünü dışarı tıklayınca / ESC ile kapat.
  useEffect(() => {
    if (!odakMenu) return;
    const kapat = () => setOdakMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOdakMenu(null); };
    window.addEventListener("click", kapat);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("click", kapat); window.removeEventListener("keydown", esc); };
  }, [odakMenu]);

  // Araca odaklan — haritayı aracın ŞU ANKİ canlı konumuna (varsa) ya da güzergahına götürür.
  const aracaOdaklan = useCallback((plaka: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const norm = plakaNorm(plaka);
    const canli = (canliVeriRef.current.konumlar ?? []).find((k) => {
      const p = k.node ? canliVeriRef.current.cihazMap?.get(k.node.trim())?.plaka : null;
      return p != null && plakaNorm(p) === norm && k.lat != null && k.lng != null;
    });
    if (canli && canli.lat != null && canli.lng != null) {
      map.setView([canli.lat, canli.lng], Math.max(map.getZoom(), 16), { animate: true });
      return;
    }
    const arac = araclar.find((a) => a.plaka === plaka);
    const pts = (arac?.noktalar ?? []).filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng] as [number, number]);
    if (pts.length) { map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 }); return; }
    toast.error("Aracın konumu bulunamadı (canlı kapalı ve bu aralıkta güzergah yok).", { duration: toastSuresi() });
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
    // toplamKm = omurga (tek çizgi) uzunlukları; omurga yoksa ham toplam_mesafe'ye düş.
    const toplamKm = secilenler.reduce((s, k) => s + (omurgaKmMap.get(k.plaka) ?? k.toplam_mesafe ?? 0), 0);
    const toplamNokta = secilenler.reduce((s, k) => s + (k.noktalar?.length ?? 0), 0);
    return { arac: secilenler.length, toplamKm, toplamNokta };
  }, [secilenler, omurgaKmMap]);

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
      if (iptal || !map) return;
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
    const tumBounds: [number, number][] = [];
    const tekMi = secilenler.length === 1;
    for (const kayit of secilenler) {
      const noktalar = (kayit.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
      if (latlngs.length === 0) continue;
      const renk = renkAl(kayit.plaka);
      // Çizgiye tıklanınca bilgi popup'ı (kartla aynı km: omurga varsa onu, yoksa toplam_mesafe).
      // Çizgi ince → çizgiye tıkla=bu popup, alana tıkla=alttaki KML seçilir (ikisi de çalışır).
      const omurgaKm = omurgaKmMap.get(kayit.plaka);
      const kmStr = omurgaKm != null
        ? `${omurgaKm.toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km yol`
        : `${kayit.toplam_mesafe ?? 0} km`;
      const pop = `<b>${kayit.plaka}</b>${kayit.arac_sinifi ? " · " + kayit.arac_sinifi : ""}<br>${kmStr} · ${noktalar.length} nokta`;
      if (etkinTekrar >= 1) {
        const cizgiler = sadelesGuzergah(noktalar, etkinTekrar, gridMesafe).parcalar;
        if (cizgiler.length) {
          // Her parça AYRI tıklanabilir polyline → tıklanınca YALNIZ o çizginin uzunluğu (toplam ikincil).
          for (const parca of cizgiler) {
            const uz = parcalarUzunlukKm([parca]);
            const parcaPop = `<b>${kayit.plaka}</b>${kayit.arac_sinifi ? " · " + kayit.arac_sinifi : ""}<br>`
              + `Bu çizgi: <b>${uz.toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km</b>`
              + `<br><span style="opacity:.65">Toplam: ${kmStr} · ${noktalar.length} nokta</span>`;
            const cizgi = L.polyline(parca, { color: renk, weight: reglajKal, opacity: 0.85 }).addTo(grup).bindPopup(parcaPop);
            // Tıklayınca seçili çizgi belirginleşsin (kalınlaşır), popup kapanınca eski haline döner.
            cizgi.on("popupopen", () => cizgi.setStyle({ weight: reglajKal + 3, opacity: 1 }));
            cizgi.on("popupclose", () => cizgi.setStyle({ weight: reglajKal, opacity: 0.85 }));
          }
        }
        // else: omurga yok (yol eşik kadar tekrar taranmamış) → reglaj sayılmaz → harita çizgisi de YOK.
      } else {
        L.polyline(latlngs, { color: renk, weight: reglajKal, opacity: 0.85 }).addTo(grup).bindPopup(pop);
        if (tekMi) {
          for (const p of noktalar) {
            L.circleMarker([p.lat, p.lng], { radius: 3, color: renk, fillColor: renk, fillOpacity: 0.6, weight: 1 })
              .addTo(grup).bindPopup(`${p.saat ?? ""}<br>Hız: ${p.hiz ?? "—"} km/s`);
          }
        }
      }
      // Başlangıç/bitiş işareti sadece tek araç seçiliyken (çoklu seçimde kalabalık olmasın)
      if (tekMi) {
        const ilk = latlngs[0], son = latlngs[latlngs.length - 1];
        L.circleMarker(ilk, { radius: 8, color: "#15803d", fillColor: "#22c55e", fillOpacity: 0.9, weight: 2 })
          .addTo(grup).bindPopup(`<b>BAŞLANGIÇ</b><br>${noktalar[0].saat ?? ""}`);
        L.circleMarker(son, { radius: 8, color: "#991b1b", fillColor: "#ef4444", fillOpacity: 0.9, weight: 2 })
          .addTo(grup).bindPopup(`<b>BİTİŞ</b><br>${noktalar[noktalar.length - 1].saat ?? ""}`);
      }
      for (const ll of latlngs) tumBounds.push(ll);
    }
    // Canlı açıksa araç konumlarını da çerçeveye kat (rota verisi olmayan günde canlıya odaklan)
    for (const k of canliVeriRef.current.konumlar ?? []) {
      if (k.lat != null && k.lng != null) tumBounds.push([k.lat, k.lng]);
    }
    // Yalnızca İLK açılışta otomatik ortala; sonra mevcut görünümü KORU.
    if (!gorunumRef.current && tumBounds.length) {
      map.fitBounds(tumBounds, { padding: [40, 40], maxZoom: 17 });
      const c = map.getCenter();
      gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
    }
  }, [haritaHazir, secilenler, etkinTekrar, gridMesafe, reglajKal, renkAl, gorunumRef, omurgaKmMap]);

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
    <div className="space-y-3 harita-tamekran-kapsayici relative">
      {/* Araç chip'leri (yan yana, çoklu seçim — renkli) + özet + KML */}
      <div className="bg-white rounded-lg border p-3 harita-arac-panel">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Sol: araç chip'leri + Güzergahı Göster */}
          <div className="flex flex-wrap items-center gap-1.5">
          {araclar.map((k) => {
            const secili = seciliPlakalar.has(k.plaka);
            const renk = renkAl(k.plaka);
            const omurgaKm = omurgaKmMap.get(k.plaka); // tek çizgi (yol) uzunluğu — varsa bunu göster
            return (
              <button key={k.plaka} type="button" onClick={() => toggle(k.plaka)}
                onDoubleClick={() => aracaOdaklan(k.plaka)}
                onContextMenu={(e) => { e.preventDefault(); setOdakMenu({ x: e.clientX, y: e.clientY, plaka: k.plaka }); }}
                title={`${k.plaka}${k.arac_sinifi ? " · " + k.arac_sinifi : ""}${k.marka ? " · " + k.marka : ""} — çift tıkla/dokun: araca odaklan`}
                style={secili ? { borderColor: renk, background: renk + "14" } : undefined}
                className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors select-none touch-manipulation ${
                  secili ? "text-gray-800" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                }`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renk, opacity: secili ? 1 : 0.4 }} />
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-semibold flex items-center gap-1">
                    {k.plaka}
                    {(() => { const ik = modelGoster ? (modelMap?.get(plakaNorm(k.plaka)) || k.model || k.arac_sinifi) : k.arac_sinifi; return ik ? <span className="text-[10px] font-normal opacity-60">{ik}</span> : null; })()}
                  </span>
                  <span className="text-[10px] opacity-90 flex items-center gap-1.5">
                    <span title={omurgaKm != null ? "Yol uzunluğu — haritadaki tek çizgi (git-gel tekrarları sayılmaz)" : "Toplam kat edilen mesafe"}>
                      {omurgaKm != null
                        ? `${omurgaKm.toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km yol`
                        : `${Math.round(k.toplam_mesafe ?? 0)} km`}
                    </span>
                    <span>{k.noktalar?.length ?? 0} nokta</span>
                  </span>
                  {/* SIRA: ilk kontak → çalışma → (kontak açık/rölanti) → son kontak */}
                  {(() => { const e = ilkSonKontakMap?.get(plakaNorm(k.plaka)); return e?.ilk ? (
                    <span className={`text-[10px] text-emerald-600 ${e.ilkT ? "italic opacity-80" : ""}`} title={e.ilkT ? "GPS'ten türetildi — Arvento kontak vermedi (tahmini)" : undefined}>🟢 {e.ilkT ? "~" : ""}{e.ilk.slice(0, 5)} ilk kontak</span>
                  ) : null; })()}
                  {calismaSnMap && <span className="text-[10px] opacity-80">⏱ {formatSure(calismaSnMap.get(plakaNorm(k.plaka)) ?? 0)} çalışma</span>}
                  {kontakRolantiMap && (
                    <>
                      <span className="text-[10px] opacity-80">⏱ {formatSure(kontakRolantiMap.get(plakaNorm(k.plaka))?.kontak ?? 0)} kontak açık</span>
                      <span className="text-[10px] opacity-80">⏳ {formatSure(kontakRolantiMap.get(plakaNorm(k.plaka))?.rolanti ?? 0)} rölanti</span>
                    </>
                  )}
                  {(() => { const e = ilkSonKontakMap?.get(plakaNorm(k.plaka)); return e?.son ? (
                    <span className={`text-[10px] text-red-600 ${e.sonT ? "italic opacity-80" : ""}`} title={e.sonT ? "GPS'ten türetildi — Arvento kontak vermedi (tahmini)" : undefined}>🔴 {e.sonT ? "~" : ""}{e.son.slice(0, 5)} son kontak</span>
                  ) : null; })()}
                </span>
              </button>
            );
          })}
          </div>
          {/* Sağ: özet + butonlar (Güzergahı Göster → KML İndir → Canlı) */}
          <div className="flex items-start gap-3">
            <div className="text-xs text-gray-600 text-right">
              <span className="font-semibold">{ozet.arac}</span>/{araclar.length} araç ·{" "}
              <Route size={12} className="inline" /> <strong className="text-[#1E3A5F]">{ozet.toplamKm.toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km</strong> · {ozet.toplamNokta} nokta
              {sonGuncelleme && (
                <div className="text-[10px] text-gray-400 mt-0.5">🕒 Rapor güncellendi: <b className="text-gray-500">{sonGuncelleme.toLocaleTimeString("tr-TR")}</b></div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {araclar.length > 0 && (
                <button type="button" onClick={() => setHamGoster((v) => !v)}
                  title="Açıkken tüm Tanımlamalar filtreleri yok sayılır — tam (ham) rota gösterilir"
                  className={`h-9 px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${hamGoster ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                  {hamGoster ? "✓ Güzergahı Göster" : "Güzergahı Göster"}
                </button>
              )}
              <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
                <Download size={14} /> KML İndir
              </Button>
              {canliButton}
            </div>
          </div>
        </div>
      </div>

      {/* Harita */}
      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100 harita-leaflet" style={{ height: "65vh" }} />

      {/* Sağ-tık menüsü — Araca odaklan */}
      {odakMenu && (
        <div className="fixed z-[1401] bg-white rounded-lg border shadow-lg py-1 text-xs"
          style={{ left: odakMenu.x, top: odakMenu.y }}>
          <button type="button" onClick={() => { aracaOdaklan(odakMenu.plaka); setOdakMenu(null); }}
            className="px-3 py-1.5 hover:bg-gray-100 w-full text-left flex items-center gap-1.5 whitespace-nowrap">
            🎯 <b>{odakMenu.plaka}</b> — Araca odaklan
          </button>
        </div>
      )}
    </div>
  );
}
