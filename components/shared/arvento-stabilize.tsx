// Arvento Stabilize sekmesi — KAMYONLARIN damper indirmelerini gösterir.
// Kamyonlar yan yana chip olarak listelenir (şoför ismiyle); tıklayarak çoklu seçim yapılır.
// Seçili kamyonların damper noktaları haritada turuncu yuvarlak çizilir. Greyder REGLAJ
// çizgileri arka planda referans olarak durur.
//
// Damper: arac_arvento_rapor.damper_olaylar (kamyonlar). Çizgi: arac_arvento_guzergah (greyder).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange, plakaNorm } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, type CanliKonum, type CihazMap } from "@/lib/arvento/canli-katman";
import { operasyondaGorunur, atananSekmeleriHesapla, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Layers, Download, MapPin } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

type DamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
type DamperNokta = DamperOlay & { plaka: string; surucu: string | null };

// saniye → "2sa 15dk" / "0"
function formatSure(sn: number): string {
  if (!sn) return "0";
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  return sa > 0 ? `${sa}sa ${dk}dk` : `${dk}dk`;
}
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

// "HH:MM:SS" / "HH:MM" → gün içi saniye. Yoksa null.
function saatSn(saat: string | null): number | null {
  if (!saat) return null;
  const p = saat.split(":").map((x) => parseInt(x, 10));
  if (p.length < 2 || p.some((n) => !Number.isFinite(n))) return null;
  return p[0] * 3600 + p[1] * 60 + (p[2] ?? 0);
}

// İki konum arası mesafe (metre) — küçük mesafeler için düz (equirectangular) yaklaşım yeterli.
function mesafeMetre(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 111320;
  const cosL = Math.max(0.1, Math.cos(((lat1 + lat2) / 2) * Math.PI / 180));
  const dx = (lng2 - lng1) * R * cosL;
  const dy = (lat2 - lat1) * R;
  return Math.hypot(dx, dy);
}

// Bir aracın damper olaylarını "mükerrer" (yanlış tetik) işaretler. Bir damper, daha önce
// TUTULAN bir dampere HEM yarıçap (m) HEM süre (sn) içinde yakınsa mükerrer sayılır — İKİSİ birden.
// Konumsuz olaylar temizliğe girmez (mukerrer=false). pencSn=0 veya yaricapM=0 → temizleme yok.
function mukerrerIsaretle<T extends DamperOlay>(olaylar: T[], pencSn: number, yaricapM: number): (T & { mukerrer: boolean })[] {
  if (pencSn <= 0 || yaricapM <= 0) return olaylar.map((o) => ({ ...o, mukerrer: false }));
  const konumlu = olaylar.filter((o) => o.lat != null && o.lng != null);
  const sirali = [...konumlu].sort((a, b) => (saatSn(a.saat) ?? 0) - (saatSn(b.saat) ?? 0));
  const mset = new Set<T>();
  const tutulan: T[] = []; // mükerrer SAYILMAYAN (gerçek) damperler
  for (const o of sirali) {
    const sn = saatSn(o.saat);
    const yakin = sn != null && tutulan.some((t) => {
      const tsn = saatSn(t.saat);
      if (tsn == null || sn - tsn > pencSn) return false;               // süre penceresi dışı
      return mesafeMetre(t.lat as number, t.lng as number, o.lat as number, o.lng as number) <= yaricapM; // yarıçap içi
    });
    if (yakin) mset.add(o); else tutulan.push(o);
  }
  return olaylar.map((o) => ({ ...o, mukerrer: mset.has(o) }));
}

// "Damper indi" işareti — kalkık damperinden malzeme boşaltan kamyon SVG'si.
// renk: o kamyonun sabit rengi (kasa/kabin); adet>1 ise sağ üstte sayı rozeti.
function damperKamyonIkonHtml(renk: string, adet: number): string {
  const rozet = adet > 1 ? `<span class="damper-rozet">${adet}</span>` : "";
  return `<div class="damper-wrap">${rozet}<svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="17" cy="30" rx="9" ry="2.2" fill="rgba(0,0,0,.35)"/>
    <circle cx="12" cy="25" r="3.1" fill="#111827"/><circle cx="23" cy="25" r="3.1" fill="#111827"/>
    <circle cx="12" cy="25" r="1.2" fill="#9ca3af"/><circle cx="23" cy="25" r="1.2" fill="#9ca3af"/>
    <rect x="6" y="21" width="21" height="2.4" rx="1" fill="#1f2937"/>
    <path d="M22 13 h4.5 a2 2 0 0 1 1.8 1.2 l1.4 3 a1.5 1.5 0 0 1 .1 .6 V21 H22 Z" fill="${renk}" stroke="#0f172a" stroke-width="1" stroke-linejoin="round"/>
    <rect x="23.2" y="14.6" width="3.4" height="3" rx="0.6" fill="#dbeafe" stroke="#0f172a" stroke-width="0.7"/>
    <polygon points="5,20 8.5,7.5 20.5,10.5 20.5,20" fill="${renk}" stroke="#0f172a" stroke-width="1.1" stroke-linejoin="round"/>
    <g fill="#b45309"><circle cx="4.2" cy="21" r="1.2"/><circle cx="2.7" cy="23.6" r="1"/><circle cx="5.3" cy="24" r="0.9"/></g>
  </svg></div>`;
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

export default function ArventoStabilize({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, mukerrerDk = 0, mukerrerYaricap = 0, kalinliklar, renkler, kamyonIziRenk = "#dc2626", kamyonIziKalinlik = 3, sekmeMap, canliKonumlar, canliCihazMap, refreshKey = 0 }: { bas: string; bitis: string; tekrarEsigi?: number; gridMesafe?: number; mukerrerDk?: number; mukerrerYaricap?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; kamyonIziRenk?: string; kamyonIziKalinlik?: number; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; refreshKey?: number }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const reglajRenkV = renkler?.reglaj ?? "#2563eb";
  const [tumGuzergah, setTumGuzergah] = useState<AracArventoGuzergah[]>([]); // reglaj çizgileri (referans)
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);          // kamyon damper olayları
  const [seciliPlakalar, setSeciliPlakalar] = useState<Set<string>>(new Set()); // çoklu seçim (boş→hepsi varsayılan effect ile dolar)
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const gorunumRef = useRef<{ merkez: [number, number]; zoom: number } | null>(null); // harita yeniden kurulurken görünüm korunur
  const canliLayerRef = useRef<LayerGroup | null>(null);
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliKonumlar, cihazMap: canliCihazMap };
  useCanliKatman(canliLayerRef, canliKonumlar, canliCihazMap);
  const etkinTekrar = tekrarEsigi;
  const etkinMukerrer = mukerrerDk;
  const etkinYaricap = mukerrerYaricap;

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

  const atananSekmeler = useMemo(() => atananSekmeleriHesapla(sekmeMap), [sekmeMap]);
  // Referans çizgiler: greyder güzergahları (atama varsa "stabilize" ataması esas)
  const greyderler = useMemo(() => tumGuzergah.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi, "stabilize", k.plaka)), [tumGuzergah, sekmeMap, atananSekmeler]);

  // Çok günlük aralıkta aynı plaka birden çok satır gelebilir → plakaya göre BİRLEŞTİR
  // (damper olaylarını birleştir, km/hareket/damper sayısını topla). Tek satır/plaka kalır.
  const birlesikRaporlar = useMemo(() => {
    const m = new Map<string, AracArventoRapor>();
    for (const r of raporlar) {
      const anahtar = plakaNorm(r.plaka); // boşluk/harf farkını yok say (mükerrer plakalar birleşsin)
      const ex = m.get(anahtar);
      if (!ex) {
        m.set(anahtar, { ...r, damper_olaylar: [...damperOlaylariniAl(r)] });
      } else {
        ex.mesafe_km = (ex.mesafe_km ?? 0) + (r.mesafe_km ?? 0);
        ex.hareket_sn = (ex.hareket_sn ?? 0) + (r.hareket_sn ?? 0);
        ex.kontak_sn = (ex.kontak_sn ?? 0) + (r.kontak_sn ?? 0);
        ex.damper_sayisi = (ex.damper_sayisi ?? 0) + (r.damper_sayisi ?? 0);
        ex.damper_olaylar = [...(Array.isArray(ex.damper_olaylar) ? ex.damper_olaylar : []), ...damperOlaylariniAl(r)];
        ex.surucu = ex.surucu ?? r.surucu;
        ex.marka = ex.marka ?? r.marka;
        if (r.ilk_kontak && (!ex.ilk_kontak || r.ilk_kontak < ex.ilk_kontak)) ex.ilk_kontak = r.ilk_kontak; // en erken açılış
        if (r.son_kontak && (!ex.son_kontak || r.son_kontak > ex.son_kontak)) ex.son_kontak = r.son_kontak; // en geç kapanış
      }
    }
    return Array.from(m.values());
  }, [raporlar]);

  // Damper indiren kamyonlar (damper_olaylar veya damper_sayisi olan araçlar).
  // Atama VARSA: yalnız "stabilize" atanmış araçlar; atama YOKSA: damperli her araç.
  const kamyonlar = useMemo(
    () => birlesikRaporlar.filter((r) => {
      const damperli = damperOlaylariniAl(r).length > 0 || (r.damper_sayisi ?? 0) > 0;
      if (!damperli) return false;
      const atama = sekmeMap?.get(plakaNorm(r.plaka));
      // Atama varsa kesin; yoksa "stabilize"e başka araç atanmışsa gizle, değilse damperli her araç.
      return atama ? atama.includes("stabilize") : !atananSekmeler.has("stabilize");
    }),
    [birlesikRaporlar, sekmeMap, atananSekmeler],
  );

  // Kamyon plakaları — kamyon izini reglaj çizgisinden AYIRMAK için
  const kamyonPlakaSet = useMemo(() => new Set(kamyonlar.map((r) => plakaNorm(r.plaka))), [kamyonlar]);
  // Kamyon izi: kamyonların KENDİ güzergahı (reglaj değil). Ayrı renk/kalınlıkla çizilir.
  const kamyonIzleri = useMemo(() => tumGuzergah.filter((k) => kamyonPlakaSet.has(plakaNorm(k.plaka))), [tumGuzergah, kamyonPlakaSet]);
  // Reglaj referans çizgileri: greyder hatları, kamyonlar HARİÇ (karışmasın)
  const reglajRefleri = useMemo(() => greyderler.filter((k) => !kamyonPlakaSet.has(plakaNorm(k.plaka))), [greyderler, kamyonPlakaSet]);

  // Her kamyona sabit renk ata — chip ↔ harita ↔ liste hep aynı renk
  const plakaRenk = useMemo(() => {
    const m = new Map<string, string>();
    kamyonlar.forEach((r, i) => m.set(r.plaka, KAMYON_RENKLERI[i % KAMYON_RENKLERI.length]));
    return m;
  }, [kamyonlar]);
  const renkAl = useCallback((plaka: string) => plakaRenk.get(plaka) ?? "#f97316", [plakaRenk]);

  // Veri değişince varsayılan: tüm kamyonlar seçili
  useEffect(() => {
    setSeciliPlakalar(new Set(kamyonlar.map((r) => r.plaka)));
  }, [kamyonlar]);

  const toggle = (plaka: string) => setSeciliPlakalar((s) => {
    const n = new Set(s); if (n.has(plaka)) n.delete(plaka); else n.add(plaka); return n;
  });

  // Gösterilecek damper noktaları: seçili kamyonların damperleri
  const damperOlaylar = useMemo<DamperNokta[]>(() => {
    const out: DamperNokta[] = [];
    for (const r of kamyonlar) {
      if (!seciliPlakalar.has(r.plaka)) continue;
      for (const o of damperOlaylariniAl(r)) out.push({ ...o, plaka: r.plaka, surucu: r.surucu });
    }
    return out;
  }, [kamyonlar, seciliPlakalar]);

  // Seçili kamyonların damperleri, mükerrer (yanlış tetik) işaretiyle. Araç bazında temizlenir.
  const damperIsaretli = useMemo<(DamperNokta & { mukerrer: boolean })[]>(() => {
    const pencSn = Math.max(0, etkinMukerrer) * 60;
    const out: (DamperNokta & { mukerrer: boolean })[] = [];
    for (const r of kamyonlar) {
      if (!seciliPlakalar.has(r.plaka)) continue;
      for (const o of mukerrerIsaretle(damperOlaylariniAl(r), pencSn, etkinYaricap)) {
        out.push({ ...o, plaka: r.plaka, surucu: r.surucu });
      }
    }
    return out;
  }, [kamyonlar, seciliPlakalar, etkinMukerrer, etkinYaricap]);

  // Haritaya çizilecekler: mükerrer OLMAYAN + konumlu damperler
  const damperKoordlu = useMemo(
    () => damperIsaretli.filter((o) => !o.mukerrer && o.lat != null && o.lng != null),
    [damperIsaretli],
  );
  const mukerrerSayisi = useMemo(() => damperIsaretli.filter((o) => o.mukerrer).length, [damperIsaretli]);
  const konumsuzSayisi = useMemo(() => damperIsaretli.filter((o) => o.lat == null || o.lng == null).length, [damperIsaretli]);

  // Her araç için mükerrer ayıklanmış GERÇEK damper sayısı (chip rozeti — seçimden bağımsız).
  const gercekSayiByPlaka = useMemo(() => {
    const pencSn = Math.max(0, etkinMukerrer) * 60;
    const m = new Map<string, number>();
    for (const r of kamyonlar) {
      const olaylar = damperOlaylariniAl(r);
      const gercek = mukerrerIsaretle(olaylar, pencSn, etkinYaricap).filter((o) => !o.mukerrer).length;
      m.set(r.plaka, olaylar.length > 0 ? gercek : (r.damper_sayisi ?? 0));
    }
    return m;
  }, [kamyonlar, etkinMukerrer, etkinYaricap]);

  // Seçili kamyonların özeti: araç sayısı, toplam km, toplam GERÇEK damper (mükerrer ayıklanmış).
  const ozet = useMemo(() => {
    const secilenler = kamyonlar.filter((r) => seciliPlakalar.has(r.plaka));
    const toplamKm = secilenler.reduce((s, r) => s + (r.mesafe_km ?? 0), 0);
    const toplamHareket = secilenler.reduce((s, r) => s + (r.hareket_sn ?? 0), 0);
    const toplamDamper = damperIsaretli.filter((o) => !o.mukerrer).length;
    return { aracSayisi: secilenler.length, toplamKm, toplamHareket, toplamDamper };
  }, [kamyonlar, seciliPlakalar, damperIsaretli]);

  // Harita: greyder çizgileri (referans) + kamyon damper yuvarlakları
  useEffect(() => {
    if (!bas || !bitis) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
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
      canliLayerRef.current = canliKatmanKur(L, map, canliVeriRef.current.konumlar, canliVeriRef.current.cihazMap);
      const bounds: [number, number][] = [];
      const reglajNoktalari: [number, number][] = []; // damperleri çizginin ortasına oturtmak için
      // 1) Reglaj referans çizgileri (greyder hattı) — kamyonlar hariç
      reglajRefleri.forEach((k) => {
        const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) return;
        const cizim: [number, number][][] = etkinTekrar >= 1
          ? sadelesGuzergah(noktalar, etkinTekrar, gridMesafe).parcalar
          : [latlngs];
        const cizilen = cizim.length ? cizim : [latlngs];
        L.polyline(cizilen, { color: reglajRenkV, weight: reglajKal, opacity: 0.6 })
          .addTo(map!).bindPopup(`<b>${k.plaka}</b> (reglaj çizgisi)<br>${k.arac_sinifi ?? ""}`);
        for (const seg of cizilen) for (const pt of seg) reglajNoktalari.push(pt);
        for (const ll of latlngs) bounds.push(ll);
      });
      // 2) Kamyon izi (kamyonun KENDİ güzergahı) — reglajdan AYRI renk/kalınlık; yalnız seçili kamyonlar
      kamyonIzleri.forEach((k) => {
        if (!seciliPlakalar.has(k.plaka)) return;
        const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) return;
        L.polyline(latlngs, { color: kamyonIziRenk, weight: kamyonIziKalinlik, opacity: 0.85, dashArray: "6 4" })
          .addTo(map!).bindPopup(`<b>${k.plaka}</b> (kamyon izi)<br>${k.arac_sinifi ?? ""}`);
        for (const ll of latlngs) { reglajNoktalari.push(ll); bounds.push(ll); }
      });
      // Damperi en yakın reglaj çizgisine (≤30 m) oturt → halka çizginin tam ortasında çıksın
      const snapReglaj = (lat: number, lng: number): [number, number] => {
        let en: [number, number] | null = null, enD = Infinity;
        const cosL = Math.cos((lat * Math.PI) / 180);
        for (const [rl, rg] of reglajNoktalari) {
          const dy = (rl - lat) * 111320;
          const dx = (rg - lng) * 111320 * cosL;
          const d = dy * dy + dx * dx;
          if (d < enD) { enD = d; en = [rl, rg]; }
        }
        return en && enD <= 30 * 30 ? en : [lat, lng];
      };
      // Aynı/çok yakın konuma (≈11 m) denk gelen damperleri grupla — üst üste binmesin,
      // nokta üstünde kaç damper olduğu (×N) görünsün. Gruplama plaka bazında (renk korunur).
      const gruplar = new Map<string, { lat: number; lng: number; plaka: string; surucu: string | null; olaylar: DamperNokta[] }>();
      for (const o of damperKoordlu) {
        const [lat, lng] = snapReglaj(o.lat as number, o.lng as number); // çizginin ortasına oturt
        const anahtar = `${o.plaka}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
        const g = gruplar.get(anahtar);
        if (g) g.olaylar.push(o);
        else gruplar.set(anahtar, { lat, lng, plaka: o.plaka, surucu: o.surucu, olaylar: [o] });
      }
      gruplar.forEach((g) => {
        const renk = renkAl(g.plaka);
        const adet = g.olaylar.length;
        const liste = g.olaylar
          .map((o, i) => `${i + 1}. ${o.saat ?? "—"}${o.adres ? " · " + o.adres : ""}`)
          .join("<br>");
        // "Damper indi" kamyon ikonu — çizginin ortasına oturur, kamyon renginde
        const ikon = L.divIcon({
          html: damperKamyonIkonHtml(renk, adet),
          className: "damper-ikon",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          popupAnchor: [0, -15],
        });
        L.marker([g.lat, g.lng], { icon: ikon })
          .addTo(map!)
          .bindPopup(`<b>🔻 ${g.surucu ?? g.plaka}</b> · ${adet} damper<br>${g.plaka}<br>${liste}`);
        bounds.push([g.lat, g.lng]);
      });
      // Yalnızca İLK açılışta otomatik ortala; sonrasında (tarih/seçim/toggle dahil) mevcut görünümü KORU
      if (gorunumRef.current) {
        map.setView(gorunumRef.current.merkez, gorunumRef.current.zoom, { animate: false });
      } else if (bounds.length) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      }
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return () => { iptal = true; canliLayerRef.current = null; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [bas, bitis, reglajRefleri, kamyonIzleri, seciliPlakalar, damperKoordlu, etkinTekrar, gridMesafe, renkAl, reglajKal, reglajRenkV, kamyonIziRenk, kamyonIziKalinlik]);

  // KML: kamyon damper noktaları (+ referans greyder çizgileri)
  function exportKML() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // KML rengi aabbggrr formatında — #rrggbb → ff bb gg rr
    const kmlRenk = (hex: string) => "ff" + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
    const cizgiler = reglajRefleri.map((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return "";
      const coords = noktalar.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      return `
    <Placemark><name>${esc(k.plaka)} reglaj</name><styleUrl>#rota</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }).join("");
    // Kamyon izi — reglajdan ayrı stil/renk
    const izCizgiler = kamyonIzleri.filter((k) => seciliPlakalar.has(k.plaka)).map((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return "";
      const coords = noktalar.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      return `
    <Placemark><name>${esc(k.plaka)} kamyon izi</name><styleUrl>#iz</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }).join("");
    const renkStilId = (hex: string) => "d" + hex.slice(1);
    const kullanilanRenkler = Array.from(new Set(damperKoordlu.map((o) => renkAl(o.plaka))));
    const damperStilleri = kullanilanRenkler.map((hex) =>
      `<Style id="${renkStilId(hex)}"><IconStyle><color>${kmlRenk(hex)}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`,
    ).join("");
    const damperPlacemarks = damperKoordlu.map((o, i) => `
    <Placemark><name>${esc((o.surucu ?? o.plaka) + " damper " + (i + 1))}</name><description>${esc([o.plaka, o.saat ?? "", o.adres ?? ""].filter(Boolean).join(" · "))}</description><styleUrl>#${renkStilId(renkAl(o.plaka))}</styleUrl><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`).join("");
    if (!cizgiler && !izCizgiler && !damperPlacemarks) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `Stabilize ${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>
    <Style id="rota"><LineStyle><color>${kmlRenk(reglajRenkV)}</color><width>${reglajKal}</width></LineStyle></Style>
    <Style id="iz"><LineStyle><color>${kmlRenk(kamyonIziRenk)}</color><width>${kamyonIziKalinlik}</width></LineStyle></Style>${damperStilleri}${cizgiler}${izCizgiler}${damperPlacemarks}
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
      <div className="bg-white rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Sol: kamyon chip'leri + Güzergahı Göster */}
          <div className="flex flex-wrap items-center gap-1.5">
          {kamyonlar.length === 0 && <span className="text-xs text-gray-400">Bu aralıkta damper indiren kamyon yok.</span>}
          {kamyonlar.map((r) => {
            const secili = seciliPlakalar.has(r.plaka);
            const renk = renkAl(r.plaka);
            const ad = r.surucu?.trim() || r.plaka;
            const adet = gercekSayiByPlaka.get(r.plaka) ?? (damperOlaylariniAl(r).length || (r.damper_sayisi ?? 0));
            return (
              <button key={r.plaka} type="button" onClick={() => toggle(r.plaka)}
                title={`${r.plaka}${r.marka ? " · " + r.marka : ""}`}
                style={secili ? { borderColor: renk, background: renk + "14" } : undefined}
                className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors ${
                  secili ? "text-gray-800" : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                }`}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renk, opacity: secili ? 1 : 0.4 }} />
                <span className="flex flex-col items-start leading-tight">
                  {/* Üst satır: şöför ismi + plaka */}
                  <span className="font-semibold flex items-center gap-1">
                    {ad}
                    {r.surucu?.trim() && <span className="text-[10px] font-normal opacity-60">{r.plaka}</span>}
                  </span>
                  {/* Alt satır: km + damper sayısı */}
                  <span className="text-[10px] opacity-90 flex items-center gap-1.5">
                    <span>{Math.round(r.mesafe_km ?? 0)} km</span>
                    <span className="px-1 rounded" style={{ background: secili ? renk + "2e" : "#f3f4f6" }}>🔻{adet}</span>
                  </span>
                  {/* İlk kontak açılış saati → kontak açık süresi → çalışma → son kontak kapanış saati */}
                  {r.ilk_kontak && <span className="text-[10px] text-emerald-600">🟢 {r.ilk_kontak.slice(0, 5)} ilk kontak</span>}
                  <span className="text-[10px] opacity-80">⏱ {formatSure(r.kontak_sn ?? 0)} kontak açık</span>
                  <span className="text-[10px] opacity-80">⏱ {formatSure(r.hareket_sn ?? 0)} çalışma</span>
                  {r.son_kontak && <span className="text-[10px] text-red-600">🔴 {r.son_kontak.slice(0, 5)} son kontak</span>}
                </span>
              </button>
            );
          })}
          </div>
          {/* Sağ: özet + KML */}
          <div className="flex items-start gap-3">
            <div className="text-xs text-gray-600 text-right leading-relaxed">
              <div className="text-gray-400">
                <span className="inline-block w-3 h-1 rounded align-middle mr-1" style={{ background: reglajRenkV, opacity: 0.6 }} />
                {reglajRefleri.length} reglaj çizgisi (referans)
              </div>
              {kamyonIzleri.length > 0 && (
                <div className="text-gray-400">
                  <span className="inline-block w-3 h-1 rounded align-middle mr-1" style={{ background: kamyonIziRenk }} />
                  {kamyonIzleri.length} kamyon izi
                </div>
              )}
              <div className="text-sky-700">📏 Toplam yol: <b>{ozet.toplamKm.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km</b></div>
              <div className="text-purple-700">⏱ Toplam çalışma: <b>{formatSure(ozet.toplamHareket)}</b></div>
              <div className="text-orange-700">🔻 Toplam damper: <b>{ozet.toplamDamper}</b></div>
            </div>
            <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
              <Download size={14} /> KML İndir
            </Button>
          </div>
        </div>
      </div>

      {/* Harita */}
      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "60vh" }} />

      {/* Damper indirme listesi (seçili kamyonlar) */}
      {damperOlaylar.length > 0 && (
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs font-semibold text-gray-600 mb-2">
            🔻 {seciliPlakalar.size === kamyonlar.length ? "Tüm kamyonlar" : `${seciliPlakalar.size} kamyon`} — {ozet.toplamDamper} gerçek damper
            {(mukerrerSayisi > 0 || konumsuzSayisi > 0) && (
              <span className="text-gray-400 font-normal"> ({damperOlaylar.length} kayıt
                {mukerrerSayisi > 0 && `, ${mukerrerSayisi} mükerrer gizli`}
                {konumsuzSayisi > 0 && `, ${konumsuzSayisi} konumsuz`})</span>
            )}
          </div>
          <ol className="space-y-0.5 max-h-[28vh] overflow-auto">
            {damperIsaretli.map((o, i) => (
              <li key={i} className={`text-xs flex items-center gap-2 ${o.mukerrer ? "opacity-60" : ""}`}>
                <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renkAl(o.plaka), opacity: o.mukerrer ? 0.4 : 1 }} />
                <span className={`font-bold w-32 truncate ${o.mukerrer ? "text-gray-400" : "text-[#1E3A5F]"}`}>{o.surucu?.trim() || o.plaka}</span>
                <span className="text-gray-400 w-20 truncate">{o.plaka}</span>
                <span className={`font-mono whitespace-nowrap font-semibold ${o.mukerrer ? "text-gray-400 line-through" : "text-orange-700"}`}>🔻 {o.saat ?? "—"}</span>
                <span className={`flex-1 truncate ${o.mukerrer ? "text-gray-400" : "text-gray-600"}`}>{o.adres ?? "—"}</span>
                {o.mukerrer
                  ? <span className="text-[10px] text-amber-600">mükerrer</span>
                  : o.lat != null && o.lng != null
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
