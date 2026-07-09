// Arvento "Tümü" sekmesi — o gün içindeki bütün operasyonları (Reglaj/Serme greyder
// çizgisi, Sıkıştırma silindir zikzak çizgisi, Stabilize damper noktaları) TEK haritada
// üst üste gösterir. Renkli lejant ile hangi rengin hangi operasyon olduğu belirtilir.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange, plakaNorm, birlestirGuzergahPlaka, guzergahVeriImza, raporVeriImza } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { yukluKatmanlarKml } from "@/lib/arvento/kml-export";
import { aracRengi } from "@/lib/arvento/arac-renk";
import { HaritaIskelet } from "@/components/shared/harita-iskelet";
import { mukerrerIsaretle } from "@/lib/arvento/damper-say";
import { arizaIsaretle, damperDurakKonumu, rotaTemizle } from "@/lib/arvento/ocak";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar, type KatmanIzin } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject, ReactNode } from "react";
import { OPERASYONLAR, operasyondaGorunur, atananSekmeleriHesapla, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
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

// Araç renkleri MERKEZİ atanır (lib/arvento/arac-renk) → aynı plaka her sekmede aynı renk.

export default function ArventoTumu({ bas, bitis, tekrarEsigi = 0, silindirEsik = 0, gridMesafe = 12, transitHiz = 20, mukerrerDk = 0, mukerrerYaricap = 0, ocakLat = null, ocakLng = null, ocakYaricap = 150, damperSinif, kalinliklar, renkler, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, izinliPlakalar, katmanIzinli, refreshKey = 0, sonGuncelleme, canliButton, kmlIndir = true }: { bas: string; bitis: string; tekrarEsigi?: number; silindirEsik?: number; gridMesafe?: number; transitHiz?: number; mukerrerDk?: number; mukerrerYaricap?: number; ocakLat?: number | null; ocakLng?: number | null; ocakYaricap?: number; damperSinif?: Map<string, "gercek" | "mukerrer" | "ariza">; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; izinliPlakalar?: string[] | null; katmanIzinli?: KatmanIzin; refreshKey?: number; sonGuncelleme?: Date | null; canliButton?: ReactNode; kmlIndir?: boolean }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const silindirKal = kalinliklar?.silindir ?? 3;
  const reglajRenkV = renkler?.reglaj ?? OPERASYONLAR.reglaj.renk;
  const silindirRenkV = renkler?.silindir ?? OPERASYONLAR.sikistirma.renk;
  const [guzergahlarHam, setGuzergahlar] = useState<AracArventoGuzergah[]>([]);
  const [raporlarHam, setRaporlar] = useState<AracArventoRapor[]>([]);
  // İZİN FİLTRESİ: kısıtlı kullanıcı yalnız izinli plakaları (yakınlık şantiyesine göre) görür.
  const izinSet = useMemo(() => (izinliPlakalar ? new Set(izinliPlakalar.map(plakaNorm)) : null), [izinliPlakalar]);
  const guzergahlar = useMemo(() => (izinSet ? guzergahlarHam.filter((k) => izinSet.has(plakaNorm(k.plaka))) : guzergahlarHam), [guzergahlarHam, izinSet]);
  // OMURGA çizimi/KML/özet için plaka-bazında birleşik (TÜM günler tek hat). Damper sınıflaması ise
  // GÜN-BAZLI guzergahlar kullanır (rotaByGun, plaka|tarih) — birleşik verilirse günler karışıp damper bozulur.
  const guzergahBirlesik = useMemo(() => birlestirGuzergahPlaka(guzergahlar), [guzergahlar]);
  const raporlar = useMemo(() => (izinSet ? raporlarHam.filter((k) => izinSet.has(plakaNorm(k.plaka))) : raporlarHam), [raporlarHam, izinSet]);
  const [loading, setLoading] = useState(true);

  // Damper noktaları — YALNIZ GERÇEK (Stabilize/Serme ile AYNI sınıflama): mükerrer + arıza ayıklanır,
  // manuel override uygulanır, gösterilen konum o saatteki DURMUŞ rota noktasına oturtulur. Tümü sekmesi
  // önceden TÜM damperleri (arıza/mükerrer dahil) çiziyordu — artık yalnız gerçekleri gösterir.
  const damperKoordlu = useMemo<(DamperOlay & { plaka: string })[]>(() => {
    const pencSn = Math.max(0, mukerrerDk) * 60;
    const ocak = (ocakLat != null && ocakLng != null) ? { lat: ocakLat, lng: ocakLng } : null;
    const rotaByGun = new Map<string, { lat: number; lng: number; saat?: string | null; hiz?: number | null }[]>();
    for (const g of guzergahlar) {
      const key = `${plakaNorm(g.plaka)}|${g.rapor_tarihi}`;
      const arr = rotaByGun.get(key) ?? [];
      if (Array.isArray(g.noktalar)) for (const p of rotaTemizle(g.noktalar)) if (p.lat != null && p.lng != null) arr.push(p);
      rotaByGun.set(key, arr);
    }
    const out: (DamperOlay & { plaka: string })[] = [];
    for (const r of raporlar) {
      const olaylar = (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[];
      if (!olaylar.length) continue;
      const rota = rotaByGun.get(`${plakaNorm(r.plaka)}|${r.rapor_tarihi}`) ?? [];
      const sinifli = arizaIsaretle(mukerrerIsaretle(olaylar, pencSn, mukerrerYaricap), rota, ocak, ocakYaricap);
      for (const o of sinifli) {
        const ov = damperSinif?.get(`${plakaNorm(r.plaka)}|${r.rapor_tarihi}|${o.saat ?? ""}`);
        let mk = o.mukerrer, ar = o.ariza;
        if (ov === "gercek") { mk = false; ar = false; } else if (ov === "mukerrer") { mk = true; ar = false; } else if (ov === "ariza") { ar = true; mk = false; }
        if (!mk && !ar && o.lat != null && o.lng != null) {
          const [la, ln] = damperDurakKonumu(rota, o.saat) ?? [o.lat, o.lng];
          out.push({ ...o, lat: la, lng: ln, plaka: r.plaka });
        }
      }
    }
    return out;
  }, [raporlar, guzergahlar, mukerrerDk, mukerrerYaricap, ocakLat, ocakLng, ocakYaricap, damperSinif]);
  // Her araç/makineye SABİT ayrı renk — merkezi atama (tüm sekmelerde aynı plaka = aynı renk).
  const renkAl = useCallback((p: string) => aracRengi(p), []);
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
  const katmanIzinliRef = useRef(katmanIzinli); katmanIzinliRef.current = katmanIzinli; // KML izin filtresi
  useCanliKatman(canliLayerRef, canliKonumlar, canliCihazMap); // canlı katman pozisyon güncellemelerini kendi içinde yönetir

  // Yükleme göstergesi yalnız TARİH değişiminde; periyodik tazelemede sessiz çek.
  const yapiRef = useRef("");
  const yukNoRef = useRef(0); // yükleme sıra no — ESKİ (geçersiz kılınmış) isteğin yanıtı yeni veriyi EZMESİN
  useEffect(() => {
    if (!bas || !bitis) { yukNoRef.current++; setGuzergahlar([]); setRaporlar([]); setLoading(false); return; }
    const yapi = `${bas}|${bitis}`;
    const yapisal = yapiRef.current !== yapi;
    // Tarih değişti → ESKİ VERİYİ HEMEN TEMİZLE (yoksa yeni veri gelene kadar eski rakamlar görünür) + yükleniyor göster.
    if (yapisal) { yapiRef.current = yapi; setLoading(true); setGuzergahlar([]); setRaporlar([]); }
    const benimNo = ++yukNoRef.current; // bu yüklemenin sırası; yanıt gelince hâlâ en güncel mi diye bakılır
    (async () => {
      try {
        // KISITLI kullanıcıda GPS'i SORGUDA daralt: önce hafif rapor iner, izinli plakalar süzülür, ağır
        // rota YALNIZ onlar için çekilir (eskiden tüm filo inip client'ta atılıyordu). Yönetici
        // (izinSet yok) için eski paralel yol: Tümü zaten her çalışan aracı gösterir, daraltma olmaz.
        let g: AracArventoGuzergah[], r: AracArventoRapor[];
        if (izinSet) {
          r = await getArventoRaporByRange(bas, bitis);
          if (benimNo !== yukNoRef.current) return;
          const plakalar = [...new Set(r.filter((x) => izinSet.has(plakaNorm(x.plaka))).map((x) => x.plaka))];
          g = plakalar.length ? await getGuzergahByRange(bas, bitis, plakalar) : [];
        } else {
          [g, r] = await Promise.all([getGuzergahByRange(bas, bitis), getArventoRaporByRange(bas, bitis)]);
        }
        if (benimNo !== yukNoRef.current) return; // eski istek → yok say
        // Veri AYNIYSA eski referansları koru → damper sınıflama + omurga + Leaflet katmanı boş yere kurulmaz.
        setGuzergahlar((prev) => (guzergahVeriImza(prev) === guzergahVeriImza(g) ? prev : g));
        setRaporlar((prev) => (raporVeriImza(prev) === raporVeriImza(r) ? prev : r));
      } catch (err) {
        if (benimNo !== yukNoRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      } finally {
        if (benimNo === yukNoRef.current) setLoading(false); // en güncel istek → loading kapat (StrictMode çift-çalışmada da)
      }
    })();
  }, [bas, bitis, refreshKey, izinSet]);

  const atananSekmeler = useMemo(() => atananSekmeleriHesapla(sekmeMap), [sekmeMap]);

  // Katman özeti (kaç greyder / silindir çizgisi, kaç damper)
  const ozet = useMemo(() => {
    const rotali = guzergahBirlesik.filter((k) => (k.noktalar ?? []).some((p) => p.lat != null && p.lng != null));
    const greyder = rotali.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"reglaj", k.plaka)).length;
    const silindir = rotali.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"sikistirma", k.plaka)).length;
    // Diğer: rotalı ama reglaj/sıkıştırma sınıfına girmeyen (kamyon rotası, ekskavatör vb.) — Tümü'de artık bunlar da çizilir.
    const diger = rotali.filter((k) => !operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"reglaj", k.plaka) && !operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"sikistirma", k.plaka)).length;
    const damper = damperKoordlu.length; // yalnız gerçek damper sayısı
    return { greyder, silindir, diger, damper, toplamArac: rotali.length };
  }, [guzergahBirlesik, damperKoordlu, sekmeMap, atananSekmeler]);

  // Haritayı BİR KEZ kur. Yeniden kurulmaz → veri değişince tile reload / flicker OLMAZ.
  useEffect(() => {
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      leafletRef.current = L as unknown as typeof import("leaflet");
      map = L.map(mapRef.current, { preferCanvas: true, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 200 }) // preferCanvas: çok çizgide pan/zoom akıcı (canvas); tekerlek başına AZ zoom
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
      // Çizgiler SVG + üst pane (opYolPane z450) → KML'nin (350) ÜSTÜnde ve TIKLANIR (canvas ince hatta tıklamayı
      // kaçırıyordu + canvas KML'yi boşlukta bile kapatıyordu). SVG boşlukları geçirgen → alttaki KML de tıklanır.
      if (!map.getPane("opYolPane")) { const yp = map.createPane("opYolPane"); yp.style.zIndex = "450"; }
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
    // Çizgiler + damperler SVG üst pane'de → canvas yok → KML (alt) boşluklarda tıklanır; çizgi kesin tıklanır.
    const yolRenderer = L.svg({ pane: "opYolPane" });
    // Güzergah çizgileri — sınıfa göre operasyon rengi/stili (plaka-bazında BİRLEŞİK → tek hat/araç)
    guzergahBirlesik.forEach((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
      if (latlngs.length === 0) return;
      const op = operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"sikistirma", k.plaka) ? "sikistirma"
        : operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"reglaj", k.plaka) ? "reglaj" : null;
      // TÜMÜ = o gün ÇALIŞAN her araç. op yoksa (kamyon/ekskavatör/diğer) yine ÇİZ: HAM rota, sadeleştirmesiz, ince.
      const def = op ? OPERASYONLAR[op] : null;
      const esik = op === "sikistirma" ? silindirEsik : op === "reglaj" ? tekrarEsigi : 0;
      const cizim: [number, number][][] = esik >= 1
        ? sadelesGuzergah(noktalar, esik, gridMesafe, transitHiz).parcalar
        : [latlngs];
      const kal = op === "sikistirma" ? silindirKal : op === "reglaj" ? reglajKal : 3;
      const cizgiRenk = renkAl(k.plaka); // HER MAKİNE AYRI RENK (operasyon rengi değil)
      const popupHtml = `<b>${k.plaka}</b><br>${def ? def.ad + " · " : ""}${k.arac_sinifi ?? "Araç"}`;
      (cizim.length ? cizim : [latlngs]).forEach((seg) => {
        // Görünür çizgi (tıklamaz) + üstünde GENİŞ ŞEFFAF isabet-çizgisi (kolay tıklanır) → popup. (Stabilize deseni.)
        L.polyline(seg, { color: cizgiRenk, weight: kal, opacity: 0.85, renderer: yolRenderer, interactive: false }).addTo(grup);
        L.polyline(seg, { color: cizgiRenk, weight: Math.max(14, kal + 8), opacity: 0, renderer: yolRenderer }).addTo(grup).bindPopup(popupHtml);
      });
      for (const ll of latlngs) bounds.push(ll);
    });
    // Damper noktaları (Stabilize) — YUVARLAK NOKTA (diğer sekmelerle aynı; kamyon ikonu DEĞİL). Turuncu
    // (stabilize operasyon rengi). YALNIZ GERÇEK (mükerrer/arıza ayıklanmış).
    damperKoordlu.forEach((o) => {
      if (o.lat == null || o.lng == null) return;
      L.circleMarker([o.lat as number, o.lng as number], { radius: 6, color: "#ffffff", weight: 1.5, fillColor: renkAl(o.plaka), fillOpacity: 0.95, renderer: yolRenderer })
        .addTo(grup).bindPopup(`<b>🔻 ${o.plaka}</b><br>Stabilize (gerçek damper)<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
      bounds.push([o.lat as number, o.lng as number]);
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
  }, [haritaHazir, guzergahBirlesik, damperKoordlu, tekrarEsigi, silindirEsik, gridMesafe, transitHiz, reglajKal, silindirKal, renkAl, sekmeMap, atananSekmeler, gorunumRef]);

  // KML: greyder/silindir sadeleştirilmiş hatları + damper noktaları (haritadaki ile aynı)
  async function exportKML() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const kmlRenk = (hex: string) => { const h = hex.replace("#", ""); return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; };
    // HER MAKİNE/KAMYON: kendi renginde + AYRI KATMAN (folder). plaka → çizgi/nokta placemark'ları.
    const sidOf = (p: string) => "m_" + p.replace(/[^\w]/g, "");
    const perMakine = new Map<string, { cizgi: string[]; nokta: string[] }>();
    const al = (p: string) => { let e = perMakine.get(p); if (!e) { e = { cizgi: [], nokta: [] }; perMakine.set(p, e); } return e; };
    guzergahBirlesik.forEach((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return;
      const op = operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"sikistirma", k.plaka) ? "sikistirma"
        : operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi,"reglaj", k.plaka) ? "reglaj" : null;
      // TÜMÜ = o gün çalışan HER araç. op yoksa (kamyon/ekskavatör/diğer) yine dahil et: HAM rota, sadeleştirmesiz.
      const def = op ? OPERASYONLAR[op] : null;
      const esik = op === "sikistirma" ? silindirEsik : op === "reglaj" ? tekrarEsigi : 0;
      const cizim: [number, number][][] = esik >= 1
        ? sadelesGuzergah(noktalar, esik, gridMesafe, transitHiz).parcalar
        : [noktalar.map((p) => [p.lat, p.lng] as [number, number])];
      const opAd = def ? def.ad : (k.arac_sinifi ?? "rota");
      cizim.forEach((seg) => {
        if (seg.length < 2) return;
        const coords = seg.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)},0`).join(" ");
        al(k.plaka).cizgi.push(`<Placemark><name>${esc(k.plaka)} ${esc(opAd)}</name><styleUrl>#${sidOf(k.plaka)}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`);
      });
    });
    damperKoordlu.filter((o) => o.lat != null && o.lng != null).forEach((o) => {
      al(o.plaka).nokta.push(`<Placemark><name>${esc(o.plaka)} damper</name><description>${esc(o.saat ?? "")}</description><styleUrl>#${sidOf(o.plaka)}</styleUrl><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`);
    });
    let stiller = "", folders = "";
    for (const [plaka, e] of perMakine) {
      const renk = kmlRenk(renkAl(plaka));
      stiller += `<Style id="${sidOf(plaka)}"><LineStyle><color>${renk}</color><width>4</width></LineStyle><IconStyle><color>${renk}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`;
      folders += `\n    <Folder><name>${esc(plaka)}</name>\n      ${[...e.cizgi, ...e.nokta].join("\n      ")}\n    </Folder>`;
    }
    // Yüklü KML katmanları (referans) — ortak yardımcı
    const { stiller: ykStil, folder: ykFolder } = await yukluKatmanlarKml(katmanIzinliRef.current ?? undefined);
    if (!folders && !ykFolder) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `Tumu ${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>${stiller}${ykStil}${folders}${ykFolder}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Tümü KML olarak indirildi.", { duration: toastSuresi() });
  }

  if (loading) return <HaritaIskelet />;
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
    <div className="space-y-3 harita-tamekran-kapsayici relative">
      {/* Lejant + özet */}
      <div className="bg-white rounded-lg border p-3 flex flex-wrap items-center gap-x-5 gap-y-2 harita-arac-panel">
        <span className="text-xs font-semibold text-gray-600">{formatAralik(bas, bitis)} — Çalışan tüm araçlar (<strong>{ozet.toplamArac}</strong>)</span>
        <span className="text-[10px] text-gray-400">🎨 haritada her araç ayrı renkte</span>
        <span className="text-xs text-gray-600">Reglaj/Serme: <strong className="text-gray-500">{ozet.greyder}</strong></span>
        <span className="text-xs text-gray-600">Sıkıştırma: <strong className="text-gray-500">{ozet.silindir}</strong></span>
        <span className="text-xs text-gray-600">Diğer (kamyon/makine): <strong className="text-gray-500">{ozet.diger}</strong></span>
        <span className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block w-3 h-3 rounded-full border border-orange-800" style={{ background: OPERASYONLAR.stabilize.renk }} />
          Damper: <strong className="text-gray-500">{ozet.damper} nokta</strong>
        </span>
        {sonGuncelleme && (
          <span className="text-[10px] text-gray-400">🕒 Rapor güncellendi: <b className="text-gray-500">{sonGuncelleme.toLocaleTimeString("tr-TR")}</b></span>
        )}
        <div className="flex flex-col gap-1.5 ml-auto">
          {kmlIndir && (
            <Button variant="outline" size="sm" onClick={exportKML} disabled={veriYok}
              className="h-9 gap-1 text-xs">
              <Download size={14} /> KML İndir
            </Button>
          )}
          {canliButton}
        </div>
      </div>

      {veriYok ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Layers size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{formatAralik(bas, bitis)} için operasyon verisi yok. Mesafe Bilgisi / damper raporlarını yükleyin.</p>
        </div>
      ) : (
        <div ref={mapRef} className="w-full rounded-lg border bg-gray-100 harita-leaflet" style={{ height: "66vh" }} />
      )}
    </div>
  );
}
