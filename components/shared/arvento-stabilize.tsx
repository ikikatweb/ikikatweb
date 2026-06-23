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
import { canliKatmanKur, useCanliKatman, aracKonumunaOdaklan, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject, ReactNode } from "react";
import { operasyondaGorunur, atananSekmeleriHesapla, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import { ocakTespit, arizaIsaretle, rotaTemizle, type LatLng } from "@/lib/arvento/ocak";
import { damperKamyonIkonHtml } from "@/lib/arvento/damper-ikon";
import { getOcakForTarih, setOcakForTarih, getDamperSiniflar, setDamperSinif, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
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


// Stabilize ocağı (yükleme noktası) işareti — mavi konum pini + kazma/ocak simgesi.
function ocakIkonHtml(): string {
  return `<div class="ocak-wrap"><svg width="22" height="28" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 37 C6 26 1 20 1 13 a14 14 0 0 1 28 0 C29 20 24 26 15 37 Z" fill="#1d4ed8" stroke="#ffffff" stroke-width="2"/>
    <circle cx="15" cy="13" r="8.5" fill="#ffffff"/>
    <g stroke="#1d4ed8" stroke-width="2" stroke-linecap="round"><path d="M10 17 L18 9"/><path d="M16.5 7.5 L20.5 11.5"/><path d="M8.5 15.5 L12.5 19.5"/></g>
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

export default function ArventoStabilize({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, mukerrerDk = 0, mukerrerYaricap = 0, kalinliklar, renkler, kamyonIziRenk = "#dc2626", kamyonIziKalinlik = 3, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, refreshKey = 0, sonGuncelleme, ocakLat = null, ocakLng = null, ocakYaricap = 150, yDuzenle = false, canliButton }: { bas: string; bitis: string; tekrarEsigi?: number; gridMesafe?: number; mukerrerDk?: number; mukerrerYaricap?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; kamyonIziRenk?: string; kamyonIziKalinlik?: number; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; refreshKey?: number; sonGuncelleme?: Date | null; ocakLat?: number | null; ocakLng?: number | null; ocakYaricap?: number; yDuzenle?: boolean; canliButton?: ReactNode }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const reglajRenkV = renkler?.reglaj ?? "#2563eb";
  const [tumGuzergah, setTumGuzergah] = useState<AracArventoGuzergah[]>([]); // reglaj çizgileri (referans)
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);          // kamyon damper olayları
  const [seciliPlakalar, setSeciliPlakalar] = useState<Set<string>>(new Set()); // çoklu seçim (boş→hepsi varsayılan effect ile dolar)
  const [kamyonIziGoster, setKamyonIziGoster] = useState(true); // kamyon izi çizgileri görünsün mü
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const yerelGorunumRef = useRef<HaritaGorunum | null>(null);
  const gorunumRef = disGorunumRef ?? yerelGorunumRef; // dışarıdan verilirse sekmeler arası PAYLAŞILAN görünüm
  const canliLayerRef = useRef<LayerGroup | null>(null);
  // Harita BİR KEZ kurulur; veri katmanları ayrı LayerGroup'ta tutulur → veri değişince harita
  // yeniden kurulmaz (tile reload/flicker YOK), sadece bu grup temizlenip yeniden çizilir.
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const veriKatmanRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [haritaHazir, setHaritaHazir] = useState(0); // kurulum bitince ilk çizimi tetikler
  // Canlı: SADECE Stabilize sekmesine tanımlı araçların konumu gösterilir (diğer araçlar bu haritada görünmesin).
  const atananSekmeler = useMemo(() => atananSekmeleriHesapla(sekmeMap), [sekmeMap]);
  const canliStabilize = useMemo<CanliKonum[] | undefined>(() => {
    if (!canliKonumlar) return undefined;
    return canliKonumlar.filter((k) => {
      const plaka = k.node ? canliCihazMap?.get(k.node.trim())?.plaka : null;
      if (!plaka) return false; // eşlenmemiş araç → Stabilize tanımlı değil → gösterme
      return operasyondaGorunur(sekmeMap, atananSekmeler, null, "stabilize", plaka);
    });
  }, [canliKonumlar, canliCihazMap, sekmeMap, atananSekmeler]);
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliStabilize, cihazMap: canliCihazMap };
  useCanliKatman(canliLayerRef, canliStabilize, canliCihazMap); // canlı katman pozisyon güncellemelerini kendi içinde yönetir
  const etkinTekrar = tekrarEsigi;
  const etkinMukerrer = mukerrerDk;
  const etkinYaricap = mukerrerYaricap;

  const yapiRef = useRef(""); // "bas|bitis" — tarih değişti mi? (yükleme göstergesi sadece yapısal değişimde)
  useEffect(() => {
    if (!bas || !bitis) { setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    const yapi = `${bas}|${bitis}`;
    const yapisal = yapiRef.current !== yapi; // tarih değişimi → yükleme göster; periyodik tazeleme → sessiz
    if (yapisal) { yapiRef.current = yapi; setLoading(true); }
    Promise.all([getGuzergahByRange(bas, bitis), getArventoRaporByRange(bas, bitis)])
      .then(([g, r]) => { setTumGuzergah(g); setRaporlar(r); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => { if (yapisal) setLoading(false); });
  }, [bas, bitis, refreshKey]);

  // Rotalardaki İZOLE GPS çöp noktalarını ayıkla (731 km gibi sapan hatalı okumalar) — sonraki tüm
  // hesaplar (çizim, ocak tespiti, mesafe, arıza sınıflama) temiz veri üzerinden yapılır.
  const tumGuzergahTemiz = useMemo(
    () => tumGuzergah.map((k) => (Array.isArray(k.noktalar) ? { ...k, noktalar: rotaTemizle(k.noktalar) } : k)),
    [tumGuzergah],
  );
  // Referans çizgiler: greyder güzergahları (atama varsa "stabilize" ataması esas)
  const greyderler = useMemo(() => tumGuzergahTemiz.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi, "stabilize", k.plaka)), [tumGuzergahTemiz, sekmeMap, atananSekmeler]);

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

  // Stabilize kamyonları:
  //  - Atama VARSA: "stabilize" atanmış her araç (damper ŞART DEĞİL — API'de damper gelmese de
  //    rota/km/kontak ile görünsün).
  //  - Atama YOKSA: damperli her araç (stabilize'e başka atama yoksa).
  const kamyonlar = useMemo(
    () => birlesikRaporlar.filter((r) => {
      const atama = sekmeMap?.get(plakaNorm(r.plaka));
      if (atama) return atama.includes("stabilize");
      const damperli = damperOlaylariniAl(r).length > 0 || (r.damper_sayisi ?? 0) > 0;
      return damperli && !atananSekmeler.has("stabilize");
    }).sort((a, b) => a.plaka.localeCompare(b.plaka, "tr", { numeric: true })), // PLAKAYA göre SABİT sıra (her tazelemede aynı + renkler sabit)
    [birlesikRaporlar, sekmeMap, atananSekmeler],
  );

  // Kamyon plakaları — kamyon izini reglaj çizgisinden AYIRMAK için
  const kamyonPlakaSet = useMemo(() => new Set(kamyonlar.map((r) => plakaNorm(r.plaka))), [kamyonlar]);
  // Kamyon izi: kamyonların KENDİ güzergahı (reglaj değil). Ayrı renk/kalınlıkla çizilir.
  const kamyonIzleri = useMemo(() => tumGuzergahTemiz.filter((k) => kamyonPlakaSet.has(plakaNorm(k.plaka))), [tumGuzergahTemiz, kamyonPlakaSet]);
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
    const rota = tumGuzergahTemiz.find((k) => plakaNorm(k.plaka) === plakaNorm(plaka))?.noktalar;
    if (!aracKonumunaOdaklan(map, plaka, canliVeriRef.current, rota, plakaNorm))
      toast.error("Aracın konumu bulunamadı (canlı kapalı ve güzergah yok).", { duration: toastSuresi() });
  }, [tumGuzergahTemiz]);
  // Reglaj referans çizgileri: greyder hatları, kamyonlar HARİÇ (karışmasın)
  const reglajRefleri = useMemo(() => greyderler.filter((k) => !kamyonPlakaSet.has(plakaNorm(k.plaka))), [greyderler, kamyonPlakaSet]);

  // ── Stabilize ocağı (yükleme noktası) + arıza tespiti ───────────────────────────────
  // Plaka → rota noktaları: damperden önce kamyon ocağa uğramış mı (yüklemiş mi) kontrolü için.
  const rotaByPlaka = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; saat: string | null }[]>();
    for (const k of tumGuzergahTemiz) {
      const key = plakaNorm(k.plaka);
      const arr = m.get(key) ?? [];
      if (Array.isArray(k.noktalar)) for (const p of k.noktalar) if (p?.lat != null && p?.lng != null) arr.push({ lat: p.lat, lng: p.lng, saat: p.saat ?? null });
      m.set(key, arr);
    }
    return m;
  }, [tumGuzergahTemiz]);
  // Otomatik tespit: kamyon rotalarının en yoğun toplandığı nokta (başlangıç tahmini).
  const otomatikOcak = useMemo<LatLng | null>(() => ocakTespit(kamyonIzleri.map((k) => k.noktalar ?? [])), [kamyonIzleri]);
  // GÜN BAZLI ocak: bu tarihin (bas) GEÇERLİ ocağını (≤ bas EN SON kayıt) DB'den çek. Tarih değişince yenilenir.
  // Marker sürüklenince O GÜN için kaydedilir → geçmiş günler kendi ocağını korur, etkilenmez.
  const [gunOcak, setGunOcak] = useState<{ lat: number; lng: number; yaricap: number } | null>(null);
  const basRef = useRef(bas); basRef.current = bas; // sürükleme anında güncel tarihi kullan
  useEffect(() => {
    let iptal = false;
    getOcakForTarih(bas).then((o) => { if (!iptal) setGunOcak(o); }).catch(() => { if (!iptal) setGunOcak(null); });
    return () => { iptal = true; };
  }, [bas]);
  // Çözünürlük: gün-ocağı → (eski global prop ocak) → otomatik tespit. useMemo: referans her render'da
  // değişmesin (yoksa sınıflama memo'ları ve harita çizimi her render tetiklenir = flicker).
  const ocak = useMemo<LatLng | null>(
    () => gunOcak
      ? { lat: gunOcak.lat, lng: gunOcak.lng }
      : (ocakLat != null && ocakLng != null ? { lat: ocakLat, lng: ocakLng } : otomatikOcak),
    [gunOcak, ocakLat, ocakLng, otomatikOcak],
  );
  const etkinOcakYaricap = gunOcak?.yaricap ?? ocakYaricap;            // sayı → sabit
  const ocakElleMi = gunOcak != null || (ocakLat != null && ocakLng != null); // otomatik mi (popup notu)

  // ── Damper manuel sınıflandırma (override) — gerçek/mükerrer/arıza elle değiştirilir, kalıcı ──
  // Anahtar: plaka|tarih(bas)|saat. Liste ve popup AYNI map'ten türediği için otomatik senkron.
  const [damperSinif, setDamperSinifState] = useState<Map<string, DamperSinif>>(new Map());
  const sinifKey = useCallback((plaka: string, saat: string | null) => `${plakaNorm(plaka)}|${bas}|${saat ?? ""}`, [bas]);
  useEffect(() => {
    let iptal = false;
    getDamperSiniflar(bas, bitis)
      .then((rows) => { if (iptal) return; const m = new Map<string, DamperSinif>(); for (const r of rows) m.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif); setDamperSinifState(m); })
      .catch(() => { if (!iptal) setDamperSinifState(new Map()); });
    return () => { iptal = true; };
  }, [bas, bitis, refreshKey]);
  // Bir damperin sınıfını elle değiştir (optimistik + DB'ye yaz). Liste & popup aynı state'ten beslenir.
  const damperSinifDegistir = useCallback((plaka: string, saat: string | null, yeni: DamperSinif) => {
    const key = `${plakaNorm(plaka)}|${bas}|${saat ?? ""}`;
    setDamperSinifState((prev) => { const m = new Map(prev); m.set(key, yeni); return m; });
    setDamperSinif(plaka, bas, saat ?? "", yeni).catch(() => toast.error("Sınıf kaydedilemedi — arvento_damper_sinif tablosu için SQL'i çalıştırın.", { duration: toastSuresi() }));
  }, [bas]);
  // Popup içindeki butonlar (Leaflet HTML) global fonksiyonu çağırır → React state'i günceller.
  const degistirRef = useRef(damperSinifDegistir); degistirRef.current = damperSinifDegistir;
  useEffect(() => {
    (window as unknown as { __damperSinifSet?: (p: string, s: string, k: string) => void }).__damperSinifSet =
      (p, s, k) => degistirRef.current(p, s || null, k as DamperSinif);
    return () => { try { delete (window as unknown as { __damperSinifSet?: unknown }).__damperSinifSet; } catch { /* yoksay */ } };
  }, []);

  // Her kamyona sabit renk ata — chip ↔ harita ↔ liste hep aynı renk
  const plakaRenk = useMemo(() => {
    const m = new Map<string, string>();
    kamyonlar.forEach((r, i) => m.set(r.plaka, KAMYON_RENKLERI[i % KAMYON_RENKLERI.length]));
    return m;
  }, [kamyonlar]);
  const renkAl = useCallback((plaka: string) => plakaRenk.get(plaka) ?? "#f97316", [plakaRenk]);

  // Araç KÜMESİ değişince (tarih/yeni araç) varsayılan: tüm kamyonlar seçili. Periyodik tazelemede
  // aynı plakalar gelirse seçim KORUNUR (kullanıcının kapattığı araçlar geri açılmasın, redraw olmasın).
  const plakaImzaRef = useRef("");
  useEffect(() => {
    const imza = kamyonlar.map((r) => r.plaka).sort().join("|");
    if (plakaImzaRef.current === imza) return;
    plakaImzaRef.current = imza;
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

  // Seçili kamyonların damperleri, MÜKERRER (yanlış tetik) + ARIZA (ocağa uğramadan inen) işaretleriyle.
  // Araç bazında: önce mükerrer, sonra ocak ziyaretine göre arıza. Gerçek = ne mükerrer ne arıza.
  const damperIsaretli = useMemo<(DamperNokta & { mukerrer: boolean; ariza: boolean; dogrulanmamis: boolean })[]>(() => {
    const pencSn = Math.max(0, etkinMukerrer) * 60;
    const out: (DamperNokta & { mukerrer: boolean; ariza: boolean; dogrulanmamis: boolean })[] = [];
    for (const r of kamyonlar) {
      if (!seciliPlakalar.has(r.plaka)) continue;
      const muk = mukerrerIsaretle(damperOlaylariniAl(r), pencSn, etkinYaricap);
      const sinifli = arizaIsaretle(muk, rotaByPlaka.get(plakaNorm(r.plaka)) ?? [], ocak, etkinOcakYaricap);
      for (const o of sinifli) {
        const e = { ...o, plaka: r.plaka, surucu: r.surucu };
        const ov = damperSinif.get(sinifKey(r.plaka, o.saat)); // MANUEL override otomatik sınıfı ezer
        if (ov === "gercek") { e.mukerrer = false; e.ariza = false; e.dogrulanmamis = false; }
        else if (ov === "mukerrer") { e.mukerrer = true; e.ariza = false; }
        else if (ov === "ariza") { e.ariza = true; e.mukerrer = false; }
        out.push(e);
      }
    }
    return out;
  }, [kamyonlar, seciliPlakalar, etkinMukerrer, etkinYaricap, rotaByPlaka, ocak, etkinOcakYaricap, damperSinif, sinifKey]);

  // Haritaya çizilecekler: GERÇEK (mükerrer DEĞİL + arıza DEĞİL) + konumlu damperler
  const damperKoordlu = useMemo(
    () => damperIsaretli.filter((o) => !o.mukerrer && !o.ariza && o.lat != null && o.lng != null),
    [damperIsaretli],
  );
  const mukerrerSayisi = useMemo(() => damperIsaretli.filter((o) => o.mukerrer).length, [damperIsaretli]);
  const arizaSayisi = useMemo(() => damperIsaretli.filter((o) => o.ariza && !o.mukerrer).length, [damperIsaretli]);
  const dogrulanmamisSayisi = useMemo(() => damperIsaretli.filter((o) => o.dogrulanmamis && !o.mukerrer && !o.ariza).length, [damperIsaretli]);
  const konumsuzSayisi = useMemo(() => damperIsaretli.filter((o) => o.lat == null || o.lng == null).length, [damperIsaretli]);

  // Her araç için GERÇEK damper sayısı (mükerrer + arıza ayıklanmış) — chip rozeti (seçimden bağımsız).
  const gercekSayiByPlaka = useMemo(() => {
    const pencSn = Math.max(0, etkinMukerrer) * 60;
    const m = new Map<string, number>();
    for (const r of kamyonlar) {
      const olaylar = damperOlaylariniAl(r);
      const muk = mukerrerIsaretle(olaylar, pencSn, etkinYaricap);
      const sinifli = arizaIsaretle(muk, rotaByPlaka.get(plakaNorm(r.plaka)) ?? [], ocak, etkinOcakYaricap);
      const gercek = sinifli.filter((o) => {
        const ov = damperSinif.get(sinifKey(r.plaka, o.saat));
        if (ov === "gercek") return true;
        if (ov === "mukerrer" || ov === "ariza") return false;
        return !o.mukerrer && !o.ariza;
      }).length;
      m.set(r.plaka, olaylar.length > 0 ? gercek : (r.damper_sayisi ?? 0));
    }
    return m;
  }, [kamyonlar, etkinMukerrer, etkinYaricap, rotaByPlaka, ocak, etkinOcakYaricap, damperSinif, sinifKey]);

  // Seçili kamyonların özeti: araç sayısı, toplam km, toplam GERÇEK damper (mükerrer + arıza ayıklanmış).
  const ozet = useMemo(() => {
    const secilenler = kamyonlar.filter((r) => seciliPlakalar.has(r.plaka));
    const toplamKm = secilenler.reduce((s, r) => s + (r.mesafe_km ?? 0), 0);
    const toplamHareket = secilenler.reduce((s, r) => s + (r.hareket_sn ?? 0), 0);
    const toplamDamper = damperIsaretli.filter((o) => !o.mukerrer && !o.ariza).length;
    return { aracSayisi: secilenler.length, toplamKm, toplamHareket, toplamDamper };
  }, [kamyonlar, seciliPlakalar, damperIsaretli]);

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
      await ekleKayitliKatmanlar(L, map);
      if (iptal || !map) return; // await sırasında harita silinmiş olabilir
      veriKatmanRef.current = L.layerGroup().addTo(map); // çizgi/damper/ocak buraya — temizlenip yeniden çizilir
      canliLayerRef.current = canliKatmanKur(L, map, canliVeriRef.current.konumlar, canliVeriRef.current.cihazMap);
      setTimeout(() => { oto = false; }, 800); // ilk programatik hareketler bitti → kullanıcıyı dinle
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
      setHaritaHazir((h) => h + 1); // ilk çizimi tetikle
    })();
    return () => {
      iptal = true;
      canliLayerRef.current = null;
      veriKatmanRef.current = null;
      mapInstanceRef.current = null;
      leafletRef.current = null;
      if (map) { try { map.remove(); } catch { /* sessiz */ } }
    };
    // loading: yükleme bitince (harita div'i DOM'a girince) kurulum çalışsın. Periyodik tazelemede
    // loading değişmez → harita yeniden kurulmaz (flicker yok); yalnız tarih değişiminde yeniden kurulur.
  }, [gorunumRef, loading]);

  // Veri/seçim/ayar değişince YALNIZ veri katmanını yeniden çiz (harita yerinde kalır → flicker yok).
  useEffect(() => {
    const map = mapInstanceRef.current;
    const grup = veriKatmanRef.current;
    const L = leafletRef.current;
    if (!map || !grup || !L) return;
    grup.clearLayers();
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
        .addTo(grup).bindPopup(`<b>${k.plaka}</b> (reglaj çizgisi)<br>${k.arac_sinifi ?? ""}`);
      for (const seg of cizilen) for (const pt of seg) reglajNoktalari.push(pt);
      for (const ll of latlngs) bounds.push(ll);
    });
    // 2) Kamyon izi (kamyonun KENDİ güzergahı) — reglajdan AYRI renk/kalınlık; yalnız seçili kamyonlar.
    if (kamyonIziGoster) kamyonIzleri.forEach((k) => {
      if (!seciliPlakalar.has(k.plaka)) return;
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
      if (latlngs.length === 0) return;
      L.polyline(latlngs, { color: kamyonIziRenk, weight: kamyonIziKalinlik, opacity: 0.85, dashArray: "6 4" })
        .addTo(grup).bindPopup(`<b>${k.plaka}</b> (kamyon izi)<br>${k.arac_sinifi ?? ""}`);
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
    // Aynı/çok yakın konuma denk gelen damperleri grupla — üst üste binmesin (×N gösterilir).
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
      // Popup'taki her damper için Mükerrer/Arıza butonu — window.__damperSinifSet → React state (liste ile senkron).
      const esc = (s: string) => String(s ?? "").replace(/['\\]/g, "\\$&");
      const bStil = "font-size:10px;padding:0 5px;margin-left:3px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;cursor:pointer";
      const liste = g.olaylar
        .map((o) => `🔻 ${o.saat ?? "—"}${o.adres ? " · " + o.adres : ""}`
          + `<br><button style="${bStil}" onclick="window.__damperSinifSet&&window.__damperSinifSet('${esc(g.plaka)}','${esc(o.saat ?? "")}','mukerrer')">Mükerrer</button>`
          + `<button style="${bStil}" onclick="window.__damperSinifSet&&window.__damperSinifSet('${esc(g.plaka)}','${esc(o.saat ?? "")}','ariza')">Arıza</button>`)
        .join("<hr style='margin:3px 0;border:none;border-top:1px solid #eee'>");
      const ikon = L.divIcon({
        html: damperKamyonIkonHtml(renk, adet),
        className: "damper-ikon",
        iconSize: [26, 26],   // küçültüldü: 34 → 26
        iconAnchor: [13, 13],
        popupAnchor: [0, -12],
      });
      L.marker([g.lat, g.lng], { icon: ikon })
        .addTo(grup)
        .bindPopup(`<b>🔻 ${g.surucu ?? g.plaka}</b> · ${adet} damper<br>${g.plaka}<br>${liste}`);
      bounds.push([g.lat, g.lng]);
    });
    // ── Stabilize ocağı: yarıçap dairesi + işaret (yetki varsa sürüklenebilir) ──
    if (ocak) {
      // Ocak çemberi METRE-tabanlı küçük (50 m) → zoom'la birlikte küçülür: yakında belli, uzaklaşınca
      // neredeyse görünmez. (Sınıflama yine etkinOcakYaricap metresini kullanır; bu yalnız görseldir.)
      L.circle([ocak.lat, ocak.lng], { radius: 50, color: "#1d4ed8", weight: 1.5, opacity: 0.7, fillColor: "#3b82f6", fillOpacity: 0.1, dashArray: "5 4" }).addTo(grup);
      const ocakIkon = L.divIcon({ html: ocakIkonHtml(), className: "ocak-ikon", iconSize: [22, 28], iconAnchor: [11, 27], popupAnchor: [0, -26] });
      const ocakM = L.marker([ocak.lat, ocak.lng], { icon: ocakIkon, draggable: yDuzenle, zIndexOffset: 1000 }).addTo(grup);
      ocakM.bindPopup(`<b>⛏️ Stabilize Ocağı</b> · ${basRef.current}<br>Yükleme noktası (yarıçap ${etkinOcakYaricap} m)${yDuzenle ? "<br><i>Sürükleyerek bu güne kaydedin</i>" : ""}${ocakElleMi ? "" : "<br><i>(otomatik tespit)</i>"}`);
      if (yDuzenle) ocakM.on("dragend", () => {
        const ll = ocakM.getLatLng();
        setGunOcak({ lat: ll.lat, lng: ll.lng, yaricap: etkinOcakYaricap });
        setOcakForTarih(basRef.current, ll.lat, ll.lng, etkinOcakYaricap)
          .catch(() => toast.error("Ocak kaydedilemedi — arvento_ocak tablosu için SQL'i çalıştırın.", { duration: toastSuresi() }));
      });
      bounds.push([ocak.lat, ocak.lng]);
    }
    // Canlı açıksa araç konumlarını da çerçeveye kat (rapor verisi olmayan günde de canlıya odaklan)
    for (const k of canliVeriRef.current.konumlar ?? []) {
      if (k.lat != null && k.lng != null) bounds.push([k.lat, k.lng]);
    }
    // Yalnızca İLK açılışta (görünüm henüz yokken) otomatik ortala; sonra mevcut görünümü KORU.
    if (!gorunumRef.current && bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      const c = map.getCenter();
      gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
    }
  }, [haritaHazir, reglajRefleri, kamyonIzleri, kamyonIziGoster, seciliPlakalar, damperKoordlu, etkinTekrar, gridMesafe, renkAl, reglajKal, reglajRenkV, kamyonIziRenk, kamyonIziKalinlik, gorunumRef, ocak, etkinOcakYaricap, yDuzenle, gunOcak, ocakElleMi]);

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
  if (kamyonlar.length === 0 && greyderler.length === 0 && !(canliKonumlar && canliKonumlar.length > 0)) {
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
    <div className="space-y-3 harita-tamekran-kapsayici relative">
      {/* Kamyon chip'leri (yan yana, çoklu seçim — şoför ismiyle) + özet + KML */}
      <div className="bg-white rounded-lg border p-3 harita-arac-panel">
        {/* Masaüstü: tek satır (özet kartların yanında). Mobil: alt alta (özet kartların altında) → taşma yok. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          {/* Sol: kamyon chip'leri — MOBİL: sarmalı (hepsi görünür). MASAÜSTÜ: tek satır + yatay kaydırma. */}
          <div className="flex flex-wrap items-stretch gap-1.5 md:flex-nowrap md:flex-1 md:min-w-0 md:overflow-x-auto">
          {kamyonlar.length === 0 && <span className="text-xs text-gray-400">Bu aralıkta Stabilize aracı/kamyonu yok.</span>}
          {kamyonlar.map((r) => {
            const secili = seciliPlakalar.has(r.plaka);
            const renk = renkAl(r.plaka);
            const ad = r.surucu?.trim() || r.plaka;
            const adet = gercekSayiByPlaka.get(r.plaka) ?? (damperOlaylariniAl(r).length || (r.damper_sayisi ?? 0));
            return (
              <button key={r.plaka} type="button" onClick={() => toggle(r.plaka)}
                onDoubleClick={() => aracaOdaklan(r.plaka)}
                onContextMenu={(e) => { e.preventDefault(); setOdakMenu({ x: e.clientX, y: e.clientY, plaka: r.plaka }); }}
                title={`${r.plaka}${r.marka ? " · " + r.marka : ""} — çift tıkla/dokun: araca odaklan`}
                style={secili ? { borderColor: renk, background: renk + "14" } : undefined}
                className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors shrink-0 select-none touch-manipulation ${
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
          {/* Sağ: özet + KML — kartların yanında sabit kalır (daralmaz/alta inmez) */}
          <div className="flex items-start gap-3 shrink-0">
            <div className="text-xs text-gray-600 text-right leading-relaxed">
              <div className="text-gray-400">
                <span className="inline-block w-3 h-1 rounded align-middle mr-1" style={{ background: reglajRenkV, opacity: 0.6 }} />
                {reglajRefleri.length} reglaj çizgisi (referans)
              </div>
              {kamyonIzleri.length > 0 && (
                <div className={kamyonIziGoster ? "text-gray-400" : "text-gray-300 line-through"}>
                  <span className="inline-block w-3 h-1 rounded align-middle mr-1" style={{ background: kamyonIziRenk, opacity: kamyonIziGoster ? 1 : 0.4 }} />
                  {kamyonIzleri.length} kamyon izi
                </div>
              )}
              <div className="text-sky-700">📏 Toplam yol: <b>{ozet.toplamKm.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km</b></div>
              <div className="text-purple-700">⏱ Toplam çalışma: <b>{formatSure(ozet.toplamHareket)}</b></div>
              <div className="text-orange-700">🔻 Toplam damper: <b>{ozet.toplamDamper}</b></div>
              {sonGuncelleme && (
                <div className="text-[10px] text-gray-400 mt-0.5 pt-1 border-t border-gray-100">
                  🕒 Rapor güncellendi: <b className="text-gray-500">{sonGuncelleme.toLocaleTimeString("tr-TR")}</b>
                  <span className="text-gray-300"> · {sonGuncelleme.toLocaleDateString("tr-TR")}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {kamyonIzleri.length > 0 && (
                <button type="button" onClick={() => setKamyonIziGoster((v) => !v)}
                  title="Kamyon izi çizgilerini göster/gizle"
                  className={`h-9 px-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${kamyonIziGoster ? "bg-white text-gray-700 border-gray-300 hover:bg-gray-50" : "bg-[#1E3A5F] text-white border-[#1E3A5F]"}`}>
                  {kamyonIziGoster ? "Kamyon izini gizle" : "Kamyon izini göster"}
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
      <div ref={mapRef} className="w-full rounded-lg border bg-gray-100 harita-leaflet" style={{ height: "60vh" }} />

      {/* Sağ-tık menüsü — Araca odaklan */}
      {odakMenu && (
        <div className="fixed z-[1401] bg-white rounded-lg border shadow-lg py-1 text-xs" style={{ left: odakMenu.x, top: odakMenu.y }}>
          <button type="button" onClick={() => { aracaOdaklan(odakMenu.plaka); setOdakMenu(null); }}
            className="px-3 py-1.5 hover:bg-gray-100 w-full text-left flex items-center gap-1.5 whitespace-nowrap">
            🎯 <b>{odakMenu.plaka}</b> — Araca odaklan
          </button>
        </div>
      )}

      {/* Damper indirme listesi (seçili kamyonlar) */}
      {damperOlaylar.length > 0 && (
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs font-semibold text-gray-600 mb-2">
            🔻 {seciliPlakalar.size === kamyonlar.length ? "Tüm kamyonlar" : `${seciliPlakalar.size} kamyon`} — {ozet.toplamDamper} gerçek damper
            {(mukerrerSayisi > 0 || arizaSayisi > 0 || dogrulanmamisSayisi > 0 || konumsuzSayisi > 0) && (
              <span className="text-gray-400 font-normal"> ({damperOlaylar.length} kayıt
                {mukerrerSayisi > 0 && `, ${mukerrerSayisi} mükerrer gizli`}
                {arizaSayisi > 0 && `, ${arizaSayisi} arıza gizli`}
                {dogrulanmamisSayisi > 0 && `, ${dogrulanmamisSayisi} doğrulanmamış`}
                {konumsuzSayisi > 0 && `, ${konumsuzSayisi} konumsuz`})</span>
            )}
          </div>
          <ol className="space-y-0.5 max-h-[28vh] overflow-auto">
            {damperIsaretli.map((o, i) => {
              const gizli = o.mukerrer || o.ariza; // mükerrer veya arıza → soluk, üstü çizili
              return (
              <li key={i} className={`text-xs flex items-center gap-2 ${gizli ? "opacity-60" : ""}`}>
                <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: renkAl(o.plaka), opacity: gizli ? 0.4 : 1 }} />
                <span className={`font-bold w-32 truncate ${gizli ? "text-gray-400" : "text-[#1E3A5F]"}`}>{o.surucu?.trim() || o.plaka}</span>
                <span className="text-gray-400 w-20 truncate">{o.plaka}</span>
                <span className={`font-mono whitespace-nowrap font-semibold ${gizli ? "text-gray-400 line-through" : "text-orange-700"}`}>🔻 {o.saat ?? "—"}</span>
                <span className={`flex-1 truncate ${gizli ? "text-gray-400" : "text-gray-600"}`}>{o.adres ?? "—"}</span>
                {(() => {
                  const aktif: DamperSinif = o.mukerrer ? "mukerrer" : o.ariza ? "ariza" : "gercek";
                  const btn = (k: DamperSinif, etiket: string, renk: string) => (
                    <button type="button" onClick={() => damperSinifDegistir(o.plaka, o.saat, k)}
                      title="Bu damperin sınıfını elle ayarla"
                      className={`text-[9px] leading-none px-1 py-0.5 rounded border transition-colors ${aktif === k ? renk : "bg-white text-gray-400 border-gray-200 hover:bg-gray-100"}`}>{etiket}</button>
                  );
                  return (
                    <span className="flex items-center gap-0.5 shrink-0">
                      {btn("gercek", "Gerçek", "bg-emerald-600 text-white border-emerald-600")}
                      {btn("mukerrer", "Mük.", "bg-amber-500 text-white border-amber-500")}
                      {btn("ariza", "Arıza", "bg-rose-600 text-white border-rose-600")}
                      {aktif === "gercek" && o.dogrulanmamis && <span className="text-[9px] text-blue-500" title="Rota verisi yok — doğrulanmamış">?</span>}
                      {(o.lat == null || o.lng == null) && <span className="text-[9px] text-gray-400" title="Konumsuz"><MapPin size={9} className="inline" />✕</span>}
                    </span>
                  );
                })()}
              </li>
            );})}
          </ol>
        </div>
      )}
    </div>
  );
}
