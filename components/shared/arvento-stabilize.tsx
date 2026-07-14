// Arvento Stabilize sekmesi — KAMYONLARIN damper indirmelerini gösterir.
// Kamyonlar yan yana chip olarak listelenir (şoför ismiyle); tıklayarak çoklu seçim yapılır.
// Seçili kamyonların damper noktaları haritada turuncu yuvarlak çizilir. Greyder REGLAJ
// çizgileri arka planda referans olarak durur.
//
// Damper: arac_arvento_rapor.damper_olaylar (kamyonlar). Çizgi: arac_arvento_guzergah (greyder).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange, plakaNorm, birlestirGuzergahPlaka, getStabilizeOzetDirect, guzergahVeriImza, raporVeriImza } from "@/lib/supabase/queries/arvento";
import { aracRengi } from "@/lib/arvento/arac-renk";
import { HaritaIskelet } from "@/components/shared/harita-iskelet";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar, type KatmanIzin } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, aracKonumunaOdaklan, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject, ReactNode } from "react";
import { usePasifSecim } from "@/lib/arvento/use-pasif-secim";
import { yukluKatmanlarKml } from "@/lib/arvento/kml-export";
import { operasyondaGorunur, atananSekmeleriHesapla, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import { ocakTespit, arizaIsaretle, rotaTemizle, mesafeMetre, damperDurakKonumu, type LatLng } from "@/lib/arvento/ocak";
import { mukerrerIsaretle } from "@/lib/arvento/damper-say";
import { gunMetrikTazele } from "@/lib/arvento/gunluk-metrik-client";
import { getOcakForTarih, setOcakForTarih, getGirisForTarih, setGirisForTarih, getDamperSiniflar, setDamperSinif, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import { type OzetDamper, type OzetGiris } from "@/lib/arvento/stabilize-ozet";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Layers, Download, MapPin, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup, Polyline as LeafletPolyline } from "leaflet";

type DamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
type DamperNokta = DamperOlay & { plaka: string; surucu: string | null };
// Sınıflanmış damper (eski yol VEYA özet). _t: damperin günü; _durakLat/_durakLng: özet modunda hazır durak konumu.
type DamperIsaretliEl = DamperNokta & { mukerrer: boolean; ariza: boolean; dogrulanmamis: boolean; _t?: string | null; _durakLat?: number | null; _durakLng?: number | null };

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
// "HH:MM[:SS]" saatinin bugün itibarıyla ÜSTÜNDEN kaç DAKİKA geçti? Saat gelecekteyse (bugünün henüz
// gelmemiş saati = geçersiz tahmin) NEGATİF döner. Rapor periyodik yenilendiği için, tahmini son kontak
// "şu ana yakınsa" araçtan veri geliyordur; 1 saatten eski kalmışsa araç sessizdir. Gece yarısı sarması YOK.
function saatUstundenGecenDk(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [sStr, dStr] = hhmm.split(":");
  const sa = Number(sStr), dk = Number(dStr);
  if (Number.isNaN(sa) || Number.isNaN(dk)) return null;
  const simdi = new Date();
  const ref = new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate(), sa, dk, 0, 0);
  return (simdi.getTime() - ref.getTime()) / 60000;
}
// İki doğru parçası kesişiyor mu (lat=y, lng=x düzlemi; küçük alanlar için yeterli). Kamyon segmenti
// kapı (giriş) çizgisini kesiyorsa "kapıdan geçti".
type Nk = { lat: number; lng: number };
function yon3(p: Nk, q: Nk, r: Nk): number { return (q.lng - p.lng) * (r.lat - q.lat) - (q.lat - p.lat) * (r.lng - q.lng); }
function parcaKesisir(a: Nk, b: Nk, c: Nk, d: Nk): boolean {
  const d1 = yon3(c, d, a), d2 = yon3(c, d, b), d3 = yon3(a, b, c), d4 = yon3(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function damperOlaylariniAl(r: AracArventoRapor): DamperOlay[] {
  return (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[];
}



// Stabilize ocağı (yükleme noktası) işareti — mavi konum pini + kazma/ocak simgesi.
function ocakIkonHtml(): string {
  return `<div class="ocak-wrap"><svg width="22" height="28" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 37 C6 26 1 20 1 13 a14 14 0 0 1 28 0 C29 20 24 26 15 37 Z" fill="#1d4ed8" stroke="#ffffff" stroke-width="2"/>
    <circle cx="15" cy="13" r="8.5" fill="#ffffff"/>
    <g stroke="#1d4ed8" stroke-width="2" stroke-linecap="round"><path d="M10 17 L18 9"/><path d="M16.5 7.5 L20.5 11.5"/><path d="M8.5 15.5 L12.5 19.5"/></g>
  </svg></div>`;
}

// Döküm sahası işareti — kırmızı konum pini + malzeme yığını (üçgen) simgesi. Ocak (mavi) ile ayrışır.
function dokumSahaIkonHtml(): string {
  return `<div class="dokum-wrap"><svg width="22" height="28" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 37 C6 26 1 20 1 13 a14 14 0 0 1 28 0 C29 20 24 26 15 37 Z" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>
    <circle cx="15" cy="13" r="8.5" fill="#ffffff"/>
    <path d="M7.5 17.5 L15 7 L22.5 17.5 Z" fill="#dc2626"/>
  </svg></div>`;
}

// Ocakta çalışan iş makinesi (ekskavatör vb.) işareti — turuncu daire + makine simgesi.
function ocakMakineIkonHtml(): string {
  return `<div style="width:24px;height:24px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h7"/><path d="M5 20v-5H3l3-4h3v9"/><path d="M9 13l5-2 6 4"/><circle cx="6.5" cy="20" r="1.6" fill="#fff" stroke="none"/></svg>
  </div>`;
}

// Kamyon/araç renkleri MERKEZİ atanır (lib/arvento/arac-renk) → aynı plaka her sekmede aynı renk.

// ÖZET MODU: damper sınıflaması SUNUCUDA önceden hesaplanıp (arvento_harita_ozet) küçük JSON olarak çekilir
// → 7,8 MB kamyon GPS inmez, tarayıcıda sınıflama yapılmaz (aylık aralık uçar). Sınıflama mantığı birebir
// aynı (lib/arvento/stabilize-ozet → siniflaGunDamper). Sorun çıkarsa false yap → eski (ham) yola döner.
const OZET_MODU = true;

export default function ArventoStabilize({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, transitHiz = 20, mukerrerDk = 0, mukerrerYaricap = 0, kalinliklar, renkler, kamyonIziRenk = "#dc2626", kamyonIziKalinlik = 3, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, refreshKey = 0, sonGuncelleme, ocakLat = null, ocakLng = null, ocakYaricap = 150, yDuzenle = false, izinliPlakalar, katmanIzinli, canliButton, kmlIndir = true, ocakMakineleri = [], ilkSonKontakMap }: { bas: string; bitis: string; tekrarEsigi?: number; gridMesafe?: number; transitHiz?: number; mukerrerDk?: number; mukerrerYaricap?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; kamyonIziRenk?: string; kamyonIziKalinlik?: number; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; refreshKey?: number; sonGuncelleme?: Date | null; ocakLat?: number | null; ocakLng?: number | null; ocakYaricap?: number; yDuzenle?: boolean; izinliPlakalar?: string[] | null; katmanIzinli?: KatmanIzin; canliButton?: ReactNode; kmlIndir?: boolean; ocakMakineleri?: { plaka: string; model: string | null; cins: string | null; calismaSn: number; lat: number | null; lng: number | null }[]; ilkSonKontakMap?: Map<string, { ilk: string | null; son: string | null; ilkT?: boolean; sonT?: boolean }> }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const reglajRenkV = renkler?.reglaj ?? "#2563eb";
  const [tumGuzergahHam, setTumGuzergah] = useState<AracArventoGuzergah[]>([]); // reglaj çizgileri (referans)
  const [raporlarHam, setRaporlar] = useState<AracArventoRapor[]>([]);          // kamyon damper olayları
  const [ozetDampers, setOzetDampers] = useState<OzetDamper[]>([]);             // ÖZET MODU: sunucuda sınıflanmış damperler
  const [ozetGirisler, setOzetGirisler] = useState<OzetGiris[]>([]);            // ÖZET MODU: sunucuda hesaplanan giriş/döküm sayıları
  // Ana döküm sahası + ocaktan yol mesafesi (sunucuda hesaplanır — kamyon rotası tarayıcıya inmiyor).
  const [dokumSaha, setDokumSaha] = useState<{ saha: { lat: number; lng: number }; mesafeM: number; straightM: number; oran: number; dumpCount: number } | null>(null);
  // İZİN FİLTRESİ: kısıtlı kullanıcı yalnız izinli plakaları görür (yakınlık şantiyesine göre). Tüm
  // downstream aynı isimli (tumGuzergah/raporlar) filtrelenmiş memo'yu kullanır → otomatik kısıtlanır.
  const izinSet = useMemo(() => (izinliPlakalar ? new Set(izinliPlakalar.map(plakaNorm)) : null), [izinliPlakalar]);
  const tumGuzergah = useMemo(() => (izinSet ? tumGuzergahHam.filter((k) => izinSet.has(plakaNorm(k.plaka))) : tumGuzergahHam), [tumGuzergahHam, izinSet]);
  const raporlar = useMemo(() => (izinSet ? raporlarHam.filter((k) => izinSet.has(plakaNorm(k.plaka))) : raporlarHam), [raporlarHam, izinSet]);
  // PASİF (kapatılan) plakalar — gün değişince (parent remount etse bile) KORUNUR; F5'te sıfırlanır (modül-seviyesi store).
  const [pasifPlakalar, setPasifPlakalar] = usePasifSecim("arvento-pasif-stabilize");
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
  const katmanIzinliRef = useRef(katmanIzinli); katmanIzinliRef.current = katmanIzinli; // KML izin filtresi
  useCanliKatman(canliLayerRef, canliStabilize, canliCihazMap); // canlı katman pozisyon güncellemelerini kendi içinde yönetir
  const etkinTekrar = tekrarEsigi;
  const etkinMukerrer = mukerrerDk;
  const etkinYaricap = mukerrerYaricap;

  const yapiRef = useRef(""); // "bas|bitis" — tarih değişti mi? (yükleme göstergesi sadece yapısal değişimde)
  const yukNoRef = useRef(0); // yükleme sıra no — ESKİ (geçersiz kılınmış) isteğin yanıtı yeni veriyi EZMESİN
  useEffect(() => {
    if (!bas || !bitis) { yukNoRef.current++; setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    const yapi = `${bas}|${bitis}`;
    const yapisal = yapiRef.current !== yapi; // tarih değişimi → yükleme göster; periyodik tazeleme → sessiz
    // Tarih değişti → ESKİ VERİYİ HEMEN TEMİZLE (yoksa yeni veri/çizim gelene kadar eski veri görünür) + yükleniyor göster.
    if (yapisal) { yapiRef.current = yapi; setLoading(true); setTumGuzergah([]); setRaporlar([]); }
    const benimNo = ++yukNoRef.current; // bu yüklemenin sırası; yanıt gelince hâlâ en güncel mi diye bakılır
    // HIZLANDIRMA: önce hafif rapor (damper buradan), sonra YALNIZ stabilize araçlarının rotası:
    // damperli kamyon + greyder (reglaj referansı). İlgisiz araçlar (oto/iş mak. ~5 MB) çekilmez + scoped
    // olduğu için TEK aralık sorgusu (gün-gün 29 istek yerine) → çok daha hızlı.
    (async () => {
      try {
        if (OZET_MODU) {
          // ÖZET MODU: damper sınıflaması sunucuda hazır (API) → kamyon GPS İNMEZ. API rapor'a BAĞIMSIZ →
          // hemen (paralel) başlat. rapor (chip/araç listesi) + GREYDER referans (kamyon hariç, hafif, TEK
          // sorgu) ardından. Greyder küçük olduğundan tek sorgu güvenli (8,5 MB kamyon artık çekilmiyor).
          // HIZ: özeti ÖNCE doğrudan tablodan oku (Vercel'i atla, ~2× hızlı). Boş dönerse (RLS politikası
          // henüz yok) API'ye düş → SQL çalıştırılmadan da çalışır, çalıştırılınca uçar.
          const ozetPromise = getStabilizeOzetDirect(bas, bitis).then((d) => {
            if (d.dampers.length > 0 || d.girisler.length > 0) return d;
            return fetch(`/api/arvento/stabilize-ozet?bas=${bas}&bitis=${bitis}`)
              .then((res) => (res.ok ? res.json() : { dampers: [], girisler: [] }))
              .catch(() => ({ dampers: [], girisler: [] }));
          });
          const r = (await getArventoRaporByRange(bas, bitis)) as AracArventoRapor[];
          if (benimNo !== yukNoRef.current) return;
          // KAMYON (damper) kaynağı rapordan gelir → HEMEN yaz. Greyder rota / özet fetch'i (geniş aralıkta ağır)
          // patlasa bile damper listesi/haritası kaybolmasın (önceden Promise.all reddi setRaporlar'ı atlıyordu → "veri yok").
          // Veri AYNIYSA eski referansı koru → periyodik tazelemede damper sınıflama zinciri boş yere koşmaz.
          setRaporlar((prev) => (raporVeriImza(prev) === raporVeriImza(r) ? prev : r));
          // KAMYON İZİ: kısa aralıkta (≤7 gün) kamyon rotasını da çek → tıklanabilir iz (aracın gittiği yol).
          // Geniş aralıkta (ay) çekme (8,5 MB → yavaş). Damperler HER durumda özetten gelir; rota yalnız iz için.
          const gunFark = Math.round((new Date(bitis + "T00:00:00").getTime() - new Date(bas + "T00:00:00").getTime()) / 86400000) + 1;
          const izDahil = gunFark <= 7;
          const cekilecek = izDahil
            ? [...new Set(r // greyder + kamyon (iz dahil)
                .filter((x) => operasyondaGorunur(sekmeMap, atananSekmeler, null, "stabilize", x.plaka)
                  || ((x.damper_olaylar?.length ?? 0) > 0) || ((x.damper_sayisi ?? 0) > 0))
                .map((x) => x.plaka))]
            : [...new Set(r // yalnız greyder referans (kamyon hariç)
                .filter((x) => operasyondaGorunur(sekmeMap, atananSekmeler, null, "stabilize", x.plaka)
                  && !((x.damper_olaylar?.length ?? 0) > 0) && !((x.damper_sayisi ?? 0) > 0))
                .map((x) => x.plaka))];
          // BAĞIMSIZ: greyder rota VE özet ayrı ayrı — biri patlarsa diğeri (özellikle damper özeti) yine yazılır.
          const [gRes, ozRes] = await Promise.allSettled([
            getGuzergahByRange(bas, bitis, cekilecek, izDahil ? undefined : { tekSorgu: true }),
            ozetPromise,
          ]);
          if (benimNo !== yukNoRef.current) return;
          if (gRes.status === "fulfilled") setTumGuzergah((prev) => (guzergahVeriImza(prev) === guzergahVeriImza(gRes.value) ? prev : gRes.value));
          if (ozRes.status === "fulfilled") {
            const ozetRes = ozRes.value;
            setOzetDampers(Array.isArray(ozetRes?.dampers) ? (ozetRes.dampers as OzetDamper[]) : []);
            setOzetGirisler(Array.isArray(ozetRes?.girisler) ? (ozetRes.girisler as OzetGiris[]) : []);
          }
        } else {
          const r = (await getArventoRaporByRange(bas, bitis)) as AracArventoRapor[];
          if (benimNo !== yukNoRef.current) return;
          // ESKİ YOL: ham kamyon+greyder GPS'i çek, sınıflamayı tarayıcıda yap.
          const ilgili = [...new Set(r
            .filter((x) => operasyondaGorunur(sekmeMap, atananSekmeler, null, "stabilize", x.plaka)
              || ((x.damper_olaylar?.length ?? 0) > 0) || ((x.damper_sayisi ?? 0) > 0))
            .map((x) => x.plaka))];
          const g = await getGuzergahByRange(bas, bitis, ilgili);
          if (benimNo !== yukNoRef.current) return;
          setTumGuzergah((prev) => (guzergahVeriImza(prev) === guzergahVeriImza(g) ? prev : g));
          setRaporlar((prev) => (raporVeriImza(prev) === raporVeriImza(r) ? prev : r));
        }
      } catch (err) {
        if (benimNo !== yukNoRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      } finally {
        if (benimNo === yukNoRef.current) setLoading(false);
      }
    })();
  }, [bas, bitis, refreshKey, sekmeMap, atananSekmeler]);

  // Ana döküm sahası + ocaktan yol mesafesi — sunucudan (kamyon rotası tarayıcıya inmediği için).
  // Tarih VEYA rapor verisi GERÇEKTEN güncellenince yenilenir (sonGuncelleme.getTime değişince) — her 20-45 sn'lik
  // boş tazeleme turunda DEĞİL. Vercel Active CPU'yu korur; ağır hesabı yalnız yeni veri gelince yapar.
  // Değer AYNI ise state'i güncelleme (referansı koru) → harita boşuna yeniden çizilip titremesin.
  const sonGuncellemeMs = sonGuncelleme?.getTime() ?? 0;
  useEffect(() => {
    let iptal = false;
    if (!bas || !bitis) { setDokumSaha(null); return; }
    fetch(`/api/arvento/dokum-mesafe?bas=${bas}&bitis=${bitis}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (iptal) return;
        const yeni = d && d.saha ? d : null;
        setDokumSaha((eski) => {
          if (!yeni) return eski ? null : eski;
          if (eski && Math.abs(yeni.mesafeM - eski.mesafeM) < 1
            && Math.abs(yeni.saha.lat - eski.saha.lat) < 1e-6 && Math.abs(yeni.saha.lng - eski.saha.lng) < 1e-6) return eski;
          return yeni;
        });
      })
      .catch(() => { /* hata: eski değeri koru */ });
    return () => { iptal = true; };
  }, [bas, bitis, sonGuncellemeMs]);

  // Rotalardaki İZOLE GPS çöp noktalarını ayıkla (731 km gibi sapan hatalı okumalar) — sonraki tüm
  // hesaplar (çizim, ocak tespiti, mesafe, arıza sınıflama) temiz veri üzerinden yapılır.
  const tumGuzergahTemiz = useMemo(
    () => tumGuzergah.map((k) => (Array.isArray(k.noktalar) ? { ...k, noktalar: rotaTemizle(k.noktalar) } : k)),
    [tumGuzergah],
  );
  // Referans çizgiler: greyder güzergahları (atama varsa "stabilize" ataması esas)
  // Reglaj referans omurgası için plaka-bazında BİRLEŞİK (TÜM günler tek hat). Damper sınıflaması
  // (rotaByPlakaGun, plaka|tarih) ve kamyon izleri ise GÜN-BAZLI tumGuzergahTemiz kullanır.
  const tumGuzergahTemizBirlesik = useMemo(() => birlestirGuzergahPlaka(tumGuzergahTemiz), [tumGuzergahTemiz]);
  const greyderler = useMemo(() => tumGuzergahTemizBirlesik.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi, "stabilize", k.plaka)), [tumGuzergahTemizBirlesik, sekmeMap, atananSekmeler]);

  // Çok günlük aralıkta aynı plaka birden çok satır gelebilir → plakaya göre BİRLEŞTİR
  // (damper olaylarını birleştir, km/hareket/damper sayısını topla). Tek satır/plaka kalır.
  const birlesikRaporlar = useMemo(() => {
    const m = new Map<string, AracArventoRapor>();
    for (const r of raporlar) {
      const anahtar = plakaNorm(r.plaka); // boşluk/harf farkını yok say (mükerrer plakalar birleşsin)
      const ex = m.get(anahtar);
      if (!ex) {
        m.set(anahtar, { ...r, damper_olaylar: damperOlaylariniAl(r).map((o) => ({ ...o, _t: r.rapor_tarihi })) });
      } else {
        ex.mesafe_km = (ex.mesafe_km ?? 0) + (r.mesafe_km ?? 0);
        ex.hareket_sn = (ex.hareket_sn ?? 0) + (r.hareket_sn ?? 0);
        ex.kontak_sn = (ex.kontak_sn ?? 0) + (r.kontak_sn ?? 0);
        ex.damper_sayisi = (ex.damper_sayisi ?? 0) + (r.damper_sayisi ?? 0);
        ex.damper_olaylar = [...(Array.isArray(ex.damper_olaylar) ? ex.damper_olaylar : []), ...damperOlaylariniAl(r).map((o) => ({ ...o, _t: r.rapor_tarihi }))];
        ex.surucu = ex.surucu ?? r.surucu;
        ex.marka = ex.marka ?? r.marka;
        if (r.ilk_kontak && (!ex.ilk_kontak || r.ilk_kontak < ex.ilk_kontak)) ex.ilk_kontak = r.ilk_kontak; // en erken açılış
        if (r.son_kontak && (!ex.son_kontak || r.son_kontak > ex.son_kontak)) ex.son_kontak = r.son_kontak; // en geç kapanış
      }
    }
    return Array.from(m.values());
  }, [raporlar]);

  // Araç sınıfı (guzergah arac_sinifi'nden) → plaka bazlı. Chip sırasında KAMYONLARI SOLA, İŞ
  // MAKİNELERİNİ (loader/greyder/ekskavatör vb.) SAĞA dizmek için.
  // Sınıf, o günkü ROTA satırından gelir → araç o gün hiç yol yapmadıysa sınıf BİLİNMEZ. Eski yedek
  // ("damper atıyorsa kamyon") bu durumda 0 damperli kamyonları iş makinesi tarafına savuruyordu
  // (gün başında 842/844 ortaya düşüyordu). Yeni sıra: sınıf → marka/model tanısı → varsayılan KAMYON
  // (bu sekme esasen kamyon sekmesi; iş makineleri isim/markasından yakalanır: Hidromek/HMK vb.).
  const araSinifMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of tumGuzergahTemizBirlesik) if (k.arac_sinifi) m.set(plakaNorm(k.plaka), k.arac_sinifi);
    return m;
  }, [tumGuzergahTemizBirlesik]);
  const IS_MAKINE_RE = /iş\s*mak|makine|loder|loader|beko|kep[çc]e|greyder|silindir|ekskavat|dozer|paletli|forklift|vin[cç]|hidromek|hmk/i;
  const kamyonMu = useCallback((r: AracArventoRapor) => {
    const sinif = araSinifMap.get(plakaNorm(r.plaka));
    if (sinif) return !IS_MAKINE_RE.test(sinif); // sınıf biliniyorsa: iş makinesi DEĞİLse kamyon
    if (IS_MAKINE_RE.test(`${r.marka ?? ""} ${r.model ?? ""}`)) return false; // marka/model iş makinesi diyor
    return true; // bilinmiyor → kamyon say (rotasız günde kamyonlar sağa savrulmasın)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [araSinifMap]);

  // Stabilize kamyonları:
  //  - Atama VARSA: "stabilize" atanmış her araç (damper ŞART DEĞİL — API'de damper gelmese de
  //    rota/km/kontak ile görünsün).
  //  - Atama YOKSA: damperli her araç (stabilize'e başka atama yoksa).
  // Sıra: önce KAMYONLAR (sola), sonra İŞ MAKİNELERİ (sağa) — her grup içinde plakaya göre sabit.
  const kamyonlar = useMemo(
    () => birlesikRaporlar.filter((r) => {
      const atama = sekmeMap?.get(plakaNorm(r.plaka));
      if (atama) return atama.includes("stabilize");
      const damperli = damperOlaylariniAl(r).length > 0 || (r.damper_sayisi ?? 0) > 0;
      return damperli && !atananSekmeler.has("stabilize");
    }).sort((a, b) =>
      (kamyonMu(b) ? 1 : 0) - (kamyonMu(a) ? 1 : 0) ||           // kamyonlar önce, iş makineleri sonra
      a.plaka.localeCompare(b.plaka, "tr", { numeric: true })),  // grup içinde plakaya göre sabit sıra
    [birlesikRaporlar, sekmeMap, atananSekmeler, kamyonMu],
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
    const m = new Map<string, { lat: number; lng: number; saat: string | null; hiz: number | null }[]>();
    for (const k of tumGuzergahTemiz) {
      const key = plakaNorm(k.plaka);
      const arr = m.get(key) ?? [];
      if (Array.isArray(k.noktalar)) for (const p of k.noktalar) if (p?.lat != null && p?.lng != null) arr.push({ lat: p.lat, lng: p.lng, saat: p.saat ?? null, hiz: p.hiz ?? null });
      m.set(key, arr);
    }
    return m;
  }, [tumGuzergahTemiz]);
  // Otomatik tespit: kamyon rotalarının en yoğun toplandığı nokta (başlangıç tahmini).
  const otomatikOcak = useMemo<LatLng | null>(() => ocakTespit(kamyonIzleri.map((k) => k.noktalar ?? [])), [kamyonIzleri]);
  // GÜN BAZLI ocak: bu tarihin (bas) GEÇERLİ ocağını (≤ bas EN SON kayıt) DB'den çek. Tarih değişince yenilenir.
  // Marker sürüklenince O GÜN için kaydedilir → geçmiş günler kendi ocağını korur, etkilenmez.
  const [gunOcak, setGunOcak] = useState<{ lat: number; lng: number; yaricap: number } | null>(null);
  const [gunGiris, setGunGiris] = useState<{ lat: number; lng: number; lat2: number; lng2: number } | null>(null); // ocak girişi KAPI ÇİZGİSİ (A–B)
  // OCAK işlemleri BİTİŞ gününe göre çözülür. Geniş aralıkta (ör. 01.06–26.06) başlangıç günü ocak
  // KAYDINDAN ÖNCE olabilir (ilk ocak 10.06) → getOcakForTarih(bas)=null → yanlış/yedek ocak → ocaktaki
  // damperler "ocakta döküm" sayılmayıp gerçek görünüyordu. Bitiş gününde gerçek ocak hep vardır.
  const basRef = useRef(bitis); basRef.current = bitis; // ocak sürükleme/kayıt bitiş gününe yazar
  useEffect(() => {
    let iptal = false;
    getOcakForTarih(bitis).then((o) => { if (!iptal) setGunOcak(o); }).catch(() => { if (!iptal) setGunOcak(null); });
    getGirisForTarih(bitis).then((g) => { if (!iptal) setGunGiris(g); }).catch(() => { if (!iptal) setGunGiris(null); });
    return () => { iptal = true; };
  }, [bitis]);
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
  // Bir damperin TARİHİ: merge'de eklenen _t (gerçek rapor_tarihi); yoksa bas. Override aralık görünümünde
  // de damperin KENDİ tarihiyle anahtarlanır → Serme/Sıkıştırma (rapor_tarihi) ile birebir.
  const damperTarih = useCallback((o: unknown): string => ((o as { _t?: string | null } | null)?._t ?? bas), [bas]);
  const sinifKey = useCallback((plaka: string, tarih: string, saat: string | null) => `${plakaNorm(plaka)}|${tarih}|${saat ?? ""}`, []);
  useEffect(() => {
    let iptal = false;
    getDamperSiniflar(bas, bitis)
      .then((rows) => { if (iptal) return; const m = new Map<string, DamperSinif>(); for (const r of rows) m.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif); setDamperSinifState(m); })
      .catch(() => { if (!iptal) setDamperSinifState(new Map()); });
    return () => { iptal = true; };
  }, [bas, bitis, refreshKey]);
  // O günün dashboard metriğini (arvento_gunluk_metrik) tazele — GEÇMİŞ günde override yapılınca "Sezon Özeti"
  // güncellensin diye. Debounce: aynı güne birden çok işaretleme yapılırsa TEK tazeleme (son işaretlemeden ~1.5 sn
  // sonra, DB yazımı bittiğinde tetiklenir; getDamperSiniflar en güncel override'ları okur).
  const metrikTazeleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const gunMetrikTazeleDebounce = useCallback((t: string) => {
    const timers = metrikTazeleTimers.current;
    const mevcut = timers.get(t); if (mevcut) clearTimeout(mevcut);
    timers.set(t, setTimeout(() => { timers.delete(t); void gunMetrikTazele(t).catch(() => { /* cache tazeleme sessiz */ }); }, 1500));
  }, []);
  // Bir damperin sınıfını elle değiştir (optimistik + DB'ye yaz). Liste & popup aynı state'ten beslenir.
  const damperSinifDegistir = useCallback((plaka: string, tarih: string, saat: string | null, yeni: DamperSinif) => {
    const t = tarih || bas;
    const key = `${plakaNorm(plaka)}|${t}|${saat ?? ""}`;
    setDamperSinifState((prev) => { const m = new Map(prev); m.set(key, yeni); return m; });
    setDamperSinif(plaka, t, saat ?? "", yeni).catch((e: unknown) => toast.error(`Sınıf kaydedilemedi — ${e instanceof Error ? e.message : "bilinmeyen hata"}`, { duration: toastSuresi() }));
    gunMetrikTazeleDebounce(t); // dashboard sezon özeti bu günü de güncellesin (geçmiş gün dahil)
  }, [bas, gunMetrikTazeleDebounce]);
  // Popup içindeki butonlar (Leaflet HTML) global fonksiyonu çağırır → React state'i günceller.
  const degistirRef = useRef(damperSinifDegistir); degistirRef.current = damperSinifDegistir;
  useEffect(() => {
    (window as unknown as { __damperSinifSet?: (p: string, t: string, s: string, k: string) => void }).__damperSinifSet =
      (p, t, s, k) => {
        const etiket = k === "ariza" ? "ARIZAYA almak" : k === "mukerrer" ? "MÜKERRER yapmak" : "GERÇEK yapmak";
        if (window.confirm(`${p} · ${s || ""}\nBu damperi ${etiket} istediğinize emin misiniz?`))
          degistirRef.current(p, t || "", s || null, k as DamperSinif);
      };
    return () => { try { delete (window as unknown as { __damperSinifSet?: unknown }).__damperSinifSet; } catch { /* yoksay */ } };
  }, []);

  // Her kamyona sabit renk — merkezi atama: chip ↔ harita ↔ liste ↔ DİĞER SEKMELER hep aynı renk
  const renkAl = useCallback((plaka: string) => aracRengi(plaka), []);

  // Araç KÜMESİ değişince (tarih/yeni araç) varsayılan: tüm kamyonlar seçili. Periyodik tazelemede
  // aynı plakalar gelirse seçim KORUNUR (kullanıcının kapattığı araçlar geri açılmasın, redraw olmasın).
  // Seçili = mevcut kamyonlardan PASİF olmayanlar (varsayılan hepsi açık; kapatılan pasife eklenir, gün değişse korunur).
  const seciliPlakalar = useMemo(() => new Set(kamyonlar.map((r) => r.plaka).filter((p) => !pasifPlakalar.has(p))), [kamyonlar, pasifPlakalar]);

  const toggle = (plaka: string) => setPasifPlakalar((s) => { // pasife ekle/çıkar (gün değişse de korunur)
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

  // GÜN BAZLI rota: plakaNorm|tarih → o günün rotası. Çoklu-gün aralığında damper sınıflaması GÜN GÜN
  // yapılmalı (mükerrer/arıza zaman mantığı gün-içi saate bakar; günler birleşince saatler çakışır → bozulur).
  const rotaByPlakaGun = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; saat: string | null; hiz: number | null }[]>();
    for (const k of tumGuzergahTemiz) {
      const key = `${plakaNorm(k.plaka)}|${k.rapor_tarihi}`;
      const arr = m.get(key) ?? [];
      if (Array.isArray(k.noktalar)) for (const p of k.noktalar) if (p?.lat != null && p?.lng != null) arr.push({ lat: p.lat, lng: p.lng, saat: p.saat ?? null, hiz: p.hiz ?? null });
      m.set(key, arr);
    }
    return m;
  }, [tumGuzergahTemiz]);
  // Bir aracın damperlerini GÜN GÜN sınıfla (her gün kendi rotasıyla), sonuçları birleştir.
  const gunBazliSinifla = useCallback((dampers: DamperOlay[], plaka: string) => {
    const pencSn = Math.max(0, etkinMukerrer) * 60;
    const byGun = new Map<string, DamperOlay[]>();
    for (const o of dampers) { const t = (o as { _t?: string | null })._t ?? bas; let arr = byGun.get(t); if (!arr) { arr = []; byGun.set(t, arr); } arr.push(o); }
    const out: (DamperOlay & { mukerrer: boolean; ariza: boolean; dogrulanmamis: boolean })[] = [];
    for (const [t, grup] of byGun) {
      const muk = mukerrerIsaretle(grup, pencSn, etkinYaricap);
      out.push(...arizaIsaretle(muk, rotaByPlakaGun.get(`${plakaNorm(plaka)}|${t}`) ?? [], ocak, etkinOcakYaricap));
    }
    return out;
  }, [etkinMukerrer, etkinYaricap, rotaByPlakaGun, ocak, etkinOcakYaricap, bas]);

  // TÜM kamyonların damperleri, MÜKERRER + ARIZA işaretli — SEÇİMDEN BAĞIMSIZ (tablo/chip sayıları bunu
  // kullanır). Tek doğru kaynak: özet modunda ozetDampers, eski modda gunBazliSinifla. Manuel override üstüne.
  const tumDamperSinifli = useMemo<DamperIsaretliEl[]>(() => {
    const out: DamperIsaretliEl[] = [];
    if (OZET_MODU) {
      // ÖZET MODU: sınıflama sunucuda hazır (ozetDampers). durak konumu (_durakLat/_durakLng) çizimde kullanılır.
      for (const d of ozetDampers) {
        if (izinSet && !izinSet.has(plakaNorm(d.plaka))) continue; // KISITLI kullanıcı: yalnız izinli plakalar
        const e: DamperIsaretliEl = {
          plaka: d.plaka, surucu: d.surucu, saat: d.saat, adres: d.adres,
          lat: d.rawLat, lng: d.rawLng, _t: d.tarih,
          _durakLat: d.durakLat, _durakLng: d.durakLng,
          mukerrer: d.mukerrer, ariza: d.ariza, dogrulanmamis: d.dogrulanmamis,
        };
        const ov = damperSinif.get(sinifKey(d.plaka, d.tarih, d.saat)); // MANUEL override otomatik sınıfı ezer
        if (ov === "gercek") { e.mukerrer = false; e.ariza = false; e.dogrulanmamis = false; }
        else if (ov === "mukerrer") { e.mukerrer = true; e.ariza = false; }
        else if (ov === "ariza") { e.ariza = true; e.mukerrer = false; }
        out.push(e);
      }
      return out;
    }
    for (const r of kamyonlar) {
      const sinifli = gunBazliSinifla(damperOlaylariniAl(r), r.plaka);
      for (const o of sinifli) {
        const e: DamperIsaretliEl = { ...o, plaka: r.plaka, surucu: r.surucu };
        const ov = damperSinif.get(sinifKey(r.plaka, damperTarih(o), o.saat));
        if (ov === "gercek") { e.mukerrer = false; e.ariza = false; e.dogrulanmamis = false; }
        else if (ov === "mukerrer") { e.mukerrer = true; e.ariza = false; }
        else if (ov === "ariza") { e.ariza = true; e.mukerrer = false; }
        out.push(e);
      }
    }
    return out;
  }, [ozetDampers, izinSet, kamyonlar, gunBazliSinifla, damperSinif, sinifKey, damperTarih]);

  // Haritada gösterilecek = SEÇİLİ kamyonların damperleri (tablo/chip seçimden bağımsızdır, harita değil).
  const damperIsaretli = useMemo<DamperIsaretliEl[]>(
    () => tumDamperSinifli.filter((o) => seciliPlakalar.has(o.plaka)),
    [tumDamperSinifli, seciliPlakalar],
  );

  // Haritaya çizilecekler: GERÇEK (mükerrer DEĞİL + arıza DEĞİL) + konumlu damperler.
  // KML export ve özet sayımları HEP bu (gerçek) seti kullanır — görsel filtreden ETKİLENMEZ.
  const damperKoordlu = useMemo(
    () => damperIsaretli.filter((o) => !o.mukerrer && !o.ariza && o.lat != null && o.lng != null),
    [damperIsaretli],
  );
  // ── SADECE GÖRSEL harita filtresi: Sefer Analizi başlıklarına tıklayınca haritada hangi
  // sınıftaki damperlerin gösterileceğini belirler. VERİYİ DEĞİŞTİRMEZ (sayım/KML/override aynı kalır).
  const [damperFiltre, setDamperFiltre] = useState<"gercek" | "ariza" | "mukerrer">("gercek");
  // Haritada GÖSTERİLECEK set — damperFiltre'ye göre süzülür (gerçek = mevcut davranış, varsayılan).
  const damperGosterilecek = useMemo(
    () => damperIsaretli.filter((o) => {
      if (o.lat == null || o.lng == null) return false; // konumsuz çizilemez
      if (damperFiltre === "mukerrer") return o.mukerrer;
      if (damperFiltre === "ariza") return o.ariza && !o.mukerrer;
      return !o.mukerrer && !o.ariza; // "gercek"
    }),
    [damperIsaretli, damperFiltre],
  );
  const mukerrerSayisi = useMemo(() => damperIsaretli.filter((o) => o.mukerrer).length, [damperIsaretli]);
  const arizaSayisi = useMemo(() => damperIsaretli.filter((o) => o.ariza && !o.mukerrer).length, [damperIsaretli]);
  const dogrulanmamisSayisi = useMemo(() => damperIsaretli.filter((o) => o.dogrulanmamis && !o.mukerrer && !o.ariza).length, [damperIsaretli]);
  const konumsuzSayisi = useMemo(() => damperIsaretli.filter((o) => o.lat == null || o.lng == null).length, [damperIsaretli]);

  // Her araç için GERÇEK damper sayısı (mükerrer + arıza ayıklanmış) — chip rozeti (seçimden bağımsız).
  const gercekSayiByPlaka = useMemo(() => {
    const m = new Map<string, number>();
    // Detay olmayan (yalnız damper_sayisi) kamyon → fallback damper_sayisi; detaylı → tumDamperSinifli'den say.
    for (const r of kamyonlar) m.set(r.plaka, damperOlaylariniAl(r).length === 0 ? (r.damper_sayisi ?? 0) : 0);
    for (const o of tumDamperSinifli) {
      if (!o.mukerrer && !o.ariza && m.has(o.plaka)) m.set(o.plaka, (m.get(o.plaka) ?? 0) + 1);
    }
    return m;
  }, [kamyonlar, tumDamperSinifli]);

  // SEFER ANALİZİ — her kamyon için gerçek/mükerrer/arıza dökümü (TÜM kamyonlar, seçimden bağımsız).
  // Ocağa gidiş (yüklü) = gerçek; Döküme gidiş = gerçek + arıza (arıza = ocağa uğramadan döken).
  const seferAnaliz = useMemo(() => {
    // Giriş KAPI çizgisi tanımlıysa: rota segmentleri bu çizgiyi kestikçe yön (ocağa mı/dökümе mi) ile say.
    const A = gunGiris ? { lat: gunGiris.lat, lng: gunGiris.lng } : null;
    const B = gunGiris ? { lat: gunGiris.lat2, lng: gunGiris.lng2 } : null;
    // Yön: kesişimden sonra araç GİRİŞ ÇİZGİSİNİN ocak tarafına geçtiyse "ocağa", diğer tarafa geçtiyse
    // "döküme". Çizginin tam konumundan BAĞIMSIZ (ocak hangi taraftaysa o taraf = ocağa) → tutarlı.
    const ocakTaraf = (A && B && ocak) ? Math.sign(yon3(A, B, ocak)) : 0;
    // Sınıf sayıları TEK kaynaktan (tumDamperSinifli) — özet/eski fark etmez, manuel override dahil.
    const sinifM = new Map<string, { g: number; m: number; a: number }>();
    for (const o of tumDamperSinifli) {
      let e = sinifM.get(o.plaka); if (!e) { e = { g: 0, m: 0, a: 0 }; sinifM.set(o.plaka, e); }
      if (o.mukerrer) e.m++; else if (o.ariza) e.a++; else e.g++;
    }
    // ÖZET MODU: giriş/döküm sunucuda hesaplanır (kamyon rotası tarayıcıya inmiyor) → ozetGirisler'den oku.
    const girisM = new Map<string, OzetGiris>();
    if (OZET_MODU) for (const gi of ozetGirisler) girisM.set(gi.plaka, gi);
    const sat: { plaka: string; surucu: string | null; gercek: number; mukerrer: number; ariza: number; girisOcak: number; girisDokum: number }[] = [];
    for (const r of kamyonlar) {
      if (!kamyonMu(r)) continue; // Sefer Analizi YALNIZ kamyonlar içindir — iş makinesi (loader vb.) sefer yapmaz
      const c = sinifM.get(r.plaka);
      let g = c?.g ?? 0, m = c?.m ?? 0, a = c?.a ?? 0;
      if (damperOlaylariniAl(r).length === 0) { g = r.damper_sayisi ?? 0; m = 0; a = 0; } // detay yok → damper_sayisi
      // Kapıdan geçiş: özet modunda sunucudan; eski modda tarayıcıda rotadan (yön: ocağa yaklaşan/uzaklaşan).
      let go = 0, gd = 0;
      if (OZET_MODU) {
        const gi = girisM.get(r.plaka); go = gi?.girisOcak ?? 0; gd = gi?.girisDokum ?? 0;
      } else if (A && B && ocak) {
        const rota = rotaByPlaka.get(plakaNorm(r.plaka)) ?? [];
        for (let i = 1; i < rota.length; i++) {
          const p1 = rota[i - 1], p2 = rota[i];
          if (p1.lat == null || p1.lng == null || p2.lat == null || p2.lng == null) continue;
          if (parcaKesisir(p1 as Nk, p2 as Nk, A, B)) { if (Math.sign(yon3(A, B, p2 as Nk)) === ocakTaraf) go++; else gd++; }
        }
      }
      // Damper/sefer 0 olsa bile her kamyon listelensin (tablo hiç gizlenmesin) → 0 değerleriyle eklenir.
      sat.push({ plaka: r.plaka, surucu: r.surucu, gercek: g, mukerrer: m, ariza: a, girisOcak: go, girisDokum: gd });
    }
    sat.sort((x, y) => y.gercek - x.gercek);
    return sat;
  }, [kamyonlar, kamyonMu, tumDamperSinifli, rotaByPlaka, ocak, gunGiris, ozetGirisler]);

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
      // STABİLİZE: kayıtlı KML yollarını canvas damperlerin ÜSTÜNE al → tıklanabilir kalsın (damper canvas'ı
      // altta kalan KML yol tıklamasını yutuyordu). Yalnız bu harita örneğini etkiler.
      const kmlP = map.getPane("kmlPane"); if (kmlP) kmlP.style.zIndex = "460";
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
    // YOLA TIKLA → KIRMIZI VURGULA (baştan sona belli olur). Başka yola tıkla → öncekisi eskiye döner;
    // aynı yola tekrar tıkla → vurgu kalkar (toggle). Greyder reglaj + kamyon izi çizgilerine uygulanır.
    let seciliYol: LeafletPolyline | null = null;
    let seciliStil: { color: string; weight: number; opacity: number; dashArray?: string } | null = null;
    const vurgulaYol = (yol: LeafletPolyline, stil: { color: string; weight: number; opacity: number; dashArray?: string }) => {
      if (seciliYol && seciliStil) seciliYol.setStyle(seciliStil);            // öncekini sıfırla
      if (seciliYol === yol) { seciliYol = null; seciliStil = null; return; } // aynı yol → vurgu kapat
      yol.setStyle({ color: "#ff2d2d", weight: stil.weight + 3, opacity: 1 });
      yol.bringToFront();
      seciliYol = yol; seciliStil = stil;
    };
    // YOL çizgilerini SVG renderer ile, damperlerin (canvas) ÜSTÜNDEKİ ayrı bir pane'de çiz: SVG yolları DOM
    // <path> olduğu için KESİN tıklanır (canvas ince çizgi tıklaması zordu) + boş yerde damperlere geçirir.
    // KATMAN SIRASI (alt→üst): harita(tile) < KML(350) < kamyon izi/reglaj(yolPane 450) < damper(damperPane 500) < canlı(640).
    if (!map.getPane("yolPane")) { const p = map.createPane("yolPane"); p.style.zIndex = "450"; }
    const yolRenderer = L.svg({ pane: "yolPane" });
    // Damper noktaları KAMYON İZİNİN ÜSTÜNDE ayrı pane'de (SVG → DOM daire = KESİN tıklanır; canvas'ta ince/örtüşen
    // yerlerde tıklama kaçıyordu). Canlı (640) hâlâ en üstte.
    if (!map.getPane("damperPane")) { const p = map.createPane("damperPane"); p.style.zIndex = "500"; }
    const damperRenderer = L.svg({ pane: "damperPane" });
    // 1) Reglaj referans çizgileri (greyder hattı) — kamyonlar hariç
    reglajRefleri.forEach((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
      if (latlngs.length === 0) return;
      const cizim: [number, number][][] = etkinTekrar >= 1
        ? sadelesGuzergah(noktalar, etkinTekrar, gridMesafe, transitHiz).parcalar
        : [latlngs];
      const cizilen = cizim.length ? cizim : [latlngs];
      const rStil = { color: reglajRenkV, weight: reglajKal, opacity: 0.6 };
      const cizgi = L.polyline(cizilen, { ...rStil, renderer: yolRenderer })
        .addTo(grup).bindPopup(`<b>${k.plaka}</b> (reglaj çizgisi)<br>${k.arac_sinifi ?? ""}`);
      cizgi.on("click", () => vurgulaYol(cizgi, rStil));
      for (const seg of cizilen) for (const pt of seg) reglajNoktalari.push(pt);
      for (const ll of latlngs) bounds.push(ll);
    });
    // 2) Kamyon izi (kamyonun KENDİ güzergahı) — reglajdan AYRI renk/kalınlık; yalnız seçili kamyonlar.
    if (kamyonIziGoster) kamyonIzleri.forEach((k) => {
      if (!seciliPlakalar.has(k.plaka)) return;
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
      if (latlngs.length === 0) return;
      const iStil = { color: kamyonIziRenk, weight: kamyonIziKalinlik, opacity: 0.85, dashArray: "6 4" };
      const cizgi = L.polyline(latlngs, { ...iStil, interactive: false, renderer: yolRenderer }).addTo(grup); // görünür (kesikli) — tıklamayı YAKALAMAZ
      // GENİŞ görünmez tıklama hedefi (16px): ince/kesikli çizgiyi kolayca tıklamak için. Damperler üstteki pane'de
      // olduğu için onların üzerinde damper öne çıkar; boş yolda bu hedef yakalar. Ölçüm açıkken CSS onu da geçirgen yapar.
      const tikHedef = L.polyline(latlngs, { color: "#000", opacity: 0, weight: 16, renderer: yolRenderer }).addTo(grup);
      tikHedef.on("click", (e) => {
        const pt = (e as unknown as { latlng: { lat: number; lng: number } }).latlng;
        let best: { saat: string | null; hiz: number | null } | null = null, bd = Infinity;
        for (const q of noktalar) { const dx = q.lat - pt.lat, dy = q.lng - pt.lng, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = q; } }
        const hiz = best?.hiz != null ? `${Math.round(best.hiz)} km/s` : "—";
        const tar = k.rapor_tarihi ? String(k.rapor_tarihi).split("-").reverse().join(".") : "";
        const sa = best?.saat ? String(best.saat).slice(0, 8) : "";
        tikHedef.bindPopup(`<b>${k.plaka}</b>${k.arac_sinifi ? " · " + k.arac_sinifi : ""}<br>Hız: ${hiz}<br>${tar}${sa ? " " + sa : ""}`).openPopup([pt.lat, pt.lng]);
        vurgulaYol(cizgi, iStil);
      });
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
    // damperGosterilecek: görsel filtreyle (gerçek/arıza/mükerrer) süzülmüş set.
    const gruplar = new Map<string, { lat: number; lng: number; plaka: string; surucu: string | null; olaylar: DamperNokta[] }>();
    for (const o of damperGosterilecek) {
      // Damper saatine en yakın DURMUŞ rota noktasına (gerçek dökme yeri) oturt; yoksa ≤30 m yola / alarm-GPS.
      // GÜN-BAZLI rota (plaka|tarih) kullan — plaka-bazlı havuz (tüm günler) kullanılırsa damper, BAŞKA bir
      // günün aynı saatteki ocak-duruşuna oturup yanlışlıkla OCAĞA taşınıyordu (ham yeri km'lerce uzakta olsa bile).
      let lat: number, lng: number;
      if (OZET_MODU) {
        // ÖZET: durak konumu sunucuda hazır; MESAFE KORUMASI: eski özetlerdeki durak, alarm (ham) konumdan
        // >80m uzağa oturmuş olabilir (200m'ye varan kayma — eski algoritma). O durumda sırasıyla:
        // 1) gün rotası eldeyse (kısa aralıkta kamyon izi iner) alarm çevresine YENİDEN oturt,
        // 2) yoksa snapReglaj(ham).
        const durakOk = o._durakLat != null && o._durakLng != null
          && (o.lat == null || o.lng == null || mesafeMetre(o._durakLat, o._durakLng, o.lat as number, o.lng as number) <= 80);
        if (durakOk) { lat = o._durakLat as number; lng = o._durakLng as number; }
        else {
          const gunRotasi = rotaByPlakaGun.get(`${plakaNorm(o.plaka)}|${damperTarih(o)}`) ?? [];
          const alarm = (o.lat != null && o.lng != null) ? { lat: o.lat as number, lng: o.lng as number } : null;
          const s = damperDurakKonumu(gunRotasi, o.saat, 420, alarm) ?? snapReglaj(o.lat as number, o.lng as number);
          lat = s[0]; lng = s[1];
        }
      } else {
        const gunRotasi = rotaByPlakaGun.get(`${plakaNorm(o.plaka)}|${damperTarih(o)}`) ?? [];
        const alarm = (o.lat != null && o.lng != null) ? { lat: o.lat as number, lng: o.lng as number } : null;
        const s = damperDurakKonumu(gunRotasi, o.saat, 420, alarm) ?? snapReglaj(o.lat as number, o.lng as number);
        lat = s[0]; lng = s[1];
      }
      const anahtar = `${o.plaka}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      const g = gruplar.get(anahtar);
      if (g) g.olaylar.push(o);
      else gruplar.set(anahtar, { lat, lng, plaka: o.plaka, surucu: o.surucu, olaylar: [o] });
    }
    gruplar.forEach((g) => {
      // SINIFA göre renk: gerçek = aracın kendi rengi (mevcut), arıza = kırmızı, mükerrer = amber.
      const renk = damperFiltre === "ariza" ? "#dc2626" : damperFiltre === "mukerrer" ? "#f59e0b" : renkAl(g.plaka);
      const sinifAd = damperFiltre === "ariza" ? "Arıza" : damperFiltre === "mukerrer" ? "Mükerrer" : "Gerçek";
      const adet = g.olaylar.length;
      // HIZ: popup HTML'i ÖNCEDEN değil, TIKLAYINCA kur (lazy). Aylık aralıkta yüzlerce damper için yüzlerce
      // string'i baştan kurmak render'ı yavaşlatıyordu; bindPopup'a fonksiyon verince yalnız açılınca kurulur.
      const popupFn = () => {
        const esc = (s: string) => String(s ?? "").replace(/['\\]/g, "\\$&");
        const bStil = "font-size:10px;padding:0 5px;margin-left:3px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;cursor:pointer";
        const liste = g.olaylar
          .map((o) => `🔻 ${o.saat ?? "—"}${o.adres ? " · " + o.adres : ""}`
            + (yDuzenle
              ? `<br><button style="${bStil}" onclick="window.__damperSinifSet&&window.__damperSinifSet('${esc(g.plaka)}','${esc(damperTarih(o))}','${esc(o.saat ?? "")}','gercek')">Gerçek</button>`
                + `<button style="${bStil}" onclick="window.__damperSinifSet&&window.__damperSinifSet('${esc(g.plaka)}','${esc(damperTarih(o))}','${esc(o.saat ?? "")}','mukerrer')">Mükerrer</button>`
                + `<button style="${bStil}" onclick="window.__damperSinifSet&&window.__damperSinifSet('${esc(g.plaka)}','${esc(damperTarih(o))}','${esc(o.saat ?? "")}','ariza')">Arıza</button>`
              : ""))
          .join("<hr style='margin:3px 0;border:none;border-top:1px solid #eee'>");
        return `<b>🔻 ${g.surucu ?? g.plaka}</b> · ${adet} damper · <b>${sinifAd}</b><br>${g.plaka}<br>${liste}`;
      };
      // TÜM damperler: kamyon rengine göre YUVARLAK nokta. SVG + damperPane (kamyon izinin üstünde, KESİN tıklanır).
      L.circleMarker([g.lat, g.lng], { radius: 6, color: "#ffffff", weight: 1.5, fillColor: renk, fillOpacity: 0.95, renderer: damperRenderer })
        .addTo(grup).bindPopup(popupFn);
      bounds.push([g.lat, g.lng]);
    });
    // ── Stabilize ocağı: yarıçap dairesi + işaret (yetki varsa sürüklenebilir) ──
    if (ocak) {
      // Ocak çemberi = GERÇEK sınıflama yarıçapı (etkinOcakYaricap, metre → zoom'la ölçeklenir).
      const cember = L.circle([ocak.lat, ocak.lng], { radius: etkinOcakYaricap, color: "#1d4ed8", weight: 1.5, opacity: 0.7, fillColor: "#3b82f6", fillOpacity: 0.08, dashArray: "5 4" }).addTo(grup);
      const ocakIkon = L.divIcon({ html: ocakIkonHtml(), className: "ocak-ikon", iconSize: [22, 28], iconAnchor: [11, 27], popupAnchor: [0, -26] });
      const ocakM = L.marker([ocak.lat, ocak.lng], { icon: ocakIkon, draggable: yDuzenle, zIndexOffset: 1000 }).addTo(grup);
      ocakM.bindPopup(`<b>⛏️ Stabilize Ocağı</b> · ${basRef.current}<br>Yükleme noktası (yarıçap ${Math.round(etkinOcakYaricap)} m)${yDuzenle ? "<br><i>Pini sürükle: taşı · kenar tutamağını sürükle: çapı büyüt/küçült</i>" : ""}${ocakElleMi ? "" : "<br><i>(otomatik tespit)</i>"}`);
      bounds.push([ocak.lat, ocak.lng]);
      if (yDuzenle) {
        // Kenar tutamağı: ocağın doğusunda, çemberin kenarında. Sürükleyince yarıçap = merkez↔tutamak.
        const kenarKonum = () => { const c = ocakM.getLatLng(); const r = cember.getRadius(); return L.latLng(c.lat, c.lng + r / (111320 * Math.cos(c.lat * Math.PI / 180))); };
        const tutamacIkon = L.divIcon({ className: "ocak-tutamac", html: '<div style="width:14px;height:14px;border-radius:50%;background:#1d4ed8;border:2px solid #fff;box-shadow:0 0 0 1.5px #1d4ed8;cursor:ew-resize"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
        const kenarM = L.marker(kenarKonum(), { icon: tutamacIkon, draggable: true, zIndexOffset: 1050 }).addTo(grup);
        const kaydet = () => {
          const c = ocakM.getLatLng(), r = Math.max(20, Math.round(cember.getRadius()));
          setGunOcak({ lat: c.lat, lng: c.lng, yaricap: r });
          setOcakForTarih(basRef.current, c.lat, c.lng, r).catch(() => toast.error("Ocak kaydedilemedi — arvento_ocak tablosu için SQL'i çalıştırın.", { duration: toastSuresi() }));
        };
        ocakM.on("drag", () => { const c = ocakM.getLatLng(); cember.setLatLng(c); kenarM.setLatLng(kenarKonum()); });
        ocakM.on("dragend", kaydet);
        kenarM.on("drag", () => { const c = ocakM.getLatLng(), h = kenarM.getLatLng(); cember.setRadius(Math.max(20, mesafeMetre(c.lat, c.lng, h.lat, h.lng))); });
        kenarM.on("dragend", kaydet);
      }
    }
    // ── Ana döküm sahası: kırmızı işaret + çember (sunucuda tespit — en çok malzeme çekilen yer). ──
    if (dokumSaha?.saha) {
      const ds = dokumSaha.saha;
      const dsKm = (dokumSaha.mesafeM / 1000).toFixed(1);
      const dsKus = (dokumSaha.straightM / 1000).toFixed(1);
      // Popup: işarete VE çembere bağlanır → küçük pini ıskalayıp saha alanına tıklayınca da mesafe görünür.
      const dsPopup = `<b>🔻 Döküm Sahası</b><br>Ocağa uzaklık (yol boyunca): <b>${dsKm} km</b><br><span style="color:#64748b;font-size:11px">Kuş uçuşu ${dsKus} km${dokumSaha.oran ? ` · dökümün %${dokumSaha.oran}'i burada` : ""}</span>`;
      L.circle([ds.lat, ds.lng], { radius: 250, color: "#b91c1c", weight: 1.5, opacity: 0.7, fillColor: "#ef4444", fillOpacity: 0.08, dashArray: "5 4" }).addTo(grup).bindPopup(dsPopup);
      const dsIkon = L.divIcon({ html: dokumSahaIkonHtml(), className: "dokum-ikon", iconSize: [22, 28], iconAnchor: [11, 27], popupAnchor: [0, -26] });
      L.marker([ds.lat, ds.lng], { icon: dsIkon, zIndexOffset: 900 }).addTo(grup).bindPopup(dsPopup);
      bounds.push([ds.lat, ds.lng]);
    }
    // OCAK GİRİŞİ KAPI ÇİZGİSİ (yeşil A–B) — kamyonlar yüklenmeye girerken bu çizgiyi keser. Geniş
    // girişlerde uçlardaki tutamaklar sürüklenerek uzatılıp daraltılır. Tanımlı değilse ve düzenleme
    // yetkisi varsa ocağın yanında kısa bir çizgi gösterilir (ilk tanımlama için).
    {
      const gz = gunGiris ?? (yDuzenle && ocak ? { lat: ocak.lat + 0.0006, lng: ocak.lng, lat2: ocak.lat - 0.0006, lng2: ocak.lng } : null);
      if (gz) {
        const cizgi = L.polyline([[gz.lat, gz.lng], [gz.lat2, gz.lng2]], { color: "#16a34a", weight: 5, opacity: 0.95 }).addTo(grup);
        cizgi.bindPopup(`<b>🚪 Ocak Girişi (kapı)</b> · ${basRef.current}<br>Kamyonlar buradan geçer${yDuzenle ? "<br><i>Uçlardaki tutamakları sürükleyerek uzatın/daraltın + konumlandırın</i>" : ""}${gunGiris ? "" : "<br><i>(henüz tanımlanmadı — uçları sürükleyin)</i>"}`);
        bounds.push([gz.lat, gz.lng], [gz.lat2, gz.lng2]);
        if (yDuzenle) {
          const tutamac = L.divIcon({ className: "giris-tutamac", html: '<div style="width:14px;height:14px;border-radius:50%;background:#16a34a;border:2px solid #fff;box-shadow:0 0 0 1.5px #16a34a"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
          const mA = L.marker([gz.lat, gz.lng], { icon: tutamac, draggable: true, zIndexOffset: 1200 }).addTo(grup);
          const mB = L.marker([gz.lat2, gz.lng2], { icon: tutamac, draggable: true, zIndexOffset: 1200 }).addTo(grup);
          const guncelle = () => cizgi.setLatLngs([mA.getLatLng(), mB.getLatLng()]);
          const kaydet = () => {
            const a = mA.getLatLng(), b = mB.getLatLng();
            setGunGiris({ lat: a.lat, lng: a.lng, lat2: b.lat, lng2: b.lng });
            setGirisForTarih(basRef.current, a.lat, a.lng, b.lat, b.lng)
              .catch((e: unknown) => toast.error(`Giriş kaydedilemedi — ${e instanceof Error ? e.message : "bilinmeyen hata"}`, { duration: toastSuresi() }));
          };
          mA.on("drag", guncelle); mB.on("drag", guncelle); mA.on("dragend", kaydet); mB.on("dragend", kaydet);
        }
      }
    }
    // OCAK İŞ MAKİNELERİ — ocak çemberi içinde çalışan ekskavatör vb. (yükleme yapan). İş Makineleri
    // sekmesinde DEĞİL, burada gösterilir; konum = rotasının ocak içi ağırlık merkezi.
    for (const mk of ocakMakineleri) {
      if (mk.lat == null || mk.lng == null) continue;
      const sa = Math.floor(mk.calismaSn / 3600), dk = Math.floor((mk.calismaSn % 3600) / 60);
      const ikon = L.divIcon({ html: ocakMakineIkonHtml(), className: "ocak-makine-ikon", iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
      L.marker([mk.lat, mk.lng], { icon: ikon, zIndexOffset: 900 })
        .addTo(grup)
        .bindPopup(`<b>⛏️ ${mk.model || mk.cins || "İş Makinesi"}</b><br>${mk.plaka}<br>Çalışma: ${sa}:${String(dk).padStart(2, "0")} (sa:dk)`);
      bounds.push([mk.lat, mk.lng]);
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
  }, [haritaHazir, reglajRefleri, kamyonIzleri, kamyonIziGoster, seciliPlakalar, damperGosterilecek, damperFiltre, rotaByPlaka, rotaByPlakaGun, etkinTekrar, gridMesafe, renkAl, reglajKal, reglajRenkV, kamyonIziRenk, kamyonIziKalinlik, gorunumRef, ocak, etkinOcakYaricap, yDuzenle, gunOcak, gunGiris, ocakElleMi, ocakMakineleri, damperTarih, dokumSaha]);

  // KML: kamyon damper noktaları (+ referans greyder çizgileri)
  async function exportKML() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // KML rengi aabbggrr formatında — #rrggbb → ff bb gg rr
    const kmlRenk = (hex: string) => "ff" + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
    let ekStil = "";
    const cizgiler = reglajRefleri.map((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return "";
      const coords = noktalar.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      return `
    <Placemark><name>${esc(k.plaka)} reglaj</name><styleUrl>#rota</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }).join("");
    // Kamyon izi — HER KAMYON KENDİ renginde (renkAl per plaka).
    const izStilVar = new Set<string>();
    const izStilId = (hex: string) => "iz" + hex.replace(/[^\w]/g, "");
    const izCizgiler = kamyonIzleri.filter((k) => seciliPlakalar.has(k.plaka)).map((k) => {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length === 0) return "";
      const coords = noktalar.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      const hex = renkAl(k.plaka), sid = izStilId(hex);
      if (!izStilVar.has(sid)) { ekStil += `<Style id="${sid}"><LineStyle><color>${kmlRenk(hex)}</color><width>${kamyonIziKalinlik}</width></LineStyle></Style>`; izStilVar.add(sid); }
      return `
    <Placemark><name>${esc(k.plaka)} kamyon izi</name><styleUrl>#${sid}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }).join("");
    const renkStilId = (hex: string) => "d" + hex.slice(1);
    const kullanilanRenkler = Array.from(new Set(damperKoordlu.map((o) => renkAl(o.plaka))));
    const damperStilleri = kullanilanRenkler.map((hex) =>
      `<Style id="${renkStilId(hex)}"><IconStyle><color>${kmlRenk(hex)}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`,
    ).join("");
    const damperPlacemarks = damperKoordlu.map((o, i) => `
    <Placemark><name>${esc((o.surucu ?? o.plaka) + " damper " + (i + 1))}</name><description>${esc([o.plaka, o.saat ?? "", o.adres ?? ""].filter(Boolean).join(" · "))}</description><styleUrl>#${renkStilId(renkAl(o.plaka))}</styleUrl><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`).join("");
    // Yüklü KML katmanları (referans) — ortak yardımcı
    const { stiller: ykStil, folder: ykFolder } = await yukluKatmanlarKml(katmanIzinliRef.current ?? undefined);
    if (!cizgiler && !izCizgiler && !damperPlacemarks && !ykFolder) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `Stabilize ${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>
    <Style id="rota"><LineStyle><color>${kmlRenk(reglajRenkV)}</color><width>${reglajKal}</width></LineStyle></Style>${ekStil}${damperStilleri}${ykStil}
    <Folder><name>Stabilize</name>${cizgiler}${izCizgiler}${damperPlacemarks}</Folder>${ykFolder}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Stabilize KML olarak indirildi.", { duration: toastSuresi() });
  }

  if (loading) return <HaritaIskelet chip={7} />;
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
                  {/* PLAKA en üstte, ŞÖFÖR adı hemen ALTINDA (ayrı satır) */}
                  <span className="font-semibold">{r.plaka}</span>
                  {r.surucu?.trim() && <span className="text-[10px] font-normal opacity-60">{r.surucu.trim()}</span>}
                  {/* Alt satır: km + damper sayısı */}
                  <span className="text-[10px] opacity-90 flex items-center gap-1.5">
                    <span>{Math.round(r.mesafe_km ?? 0)} km</span>
                    <span className="px-1 rounded" style={{ background: secili ? renk + "2e" : "#f3f4f6" }}>🔻{adet}</span>
                  </span>
                  {/* İlk kontak açılış saati → kontak açık süresi → çalışma → son kontak kapanış saati.
                      ilk/son ilkSonKontakMap'ten alınır → güvenilmez kontak (ör. kapsama dışı kapatma) GPS'ten
                      türetilmiş "~tahmini" saatle gösterilir; yoksa ham r değerine düşer. */}
                  {(() => { const e = ilkSonKontakMap?.get(plakaNorm(r.plaka)); const ilk = e?.ilk ?? r.ilk_kontak; const t = !!e?.ilkT; return ilk ? (
                    <span className={`text-[10px] text-emerald-600 ${t ? "italic opacity-80" : ""}`} title={t ? "GPS'ten türetildi — gerçek kontak verisi henüz gelmedi (tahmini)" : undefined}>🟢 {t ? "~" : ""}{ilk.slice(0, 5)} ilk kontak</span>
                  ) : null; })()}
                  <span className="text-[10px] opacity-80">⏱ {formatSure(r.kontak_sn ?? 0)} kontak açık</span>
                  <span className="text-[10px] opacity-80">⏱ {formatSure(r.hareket_sn ?? 0)} çalışma</span>
                  {(() => {
                    const e = ilkSonKontakMap?.get(plakaNorm(r.plaka));
                    const son = e?.son ?? r.son_kontak; const t = !!e?.sonT;
                    if (!son) return null;
                    // Tahmini (~) son kontak: SADECE araçtan ≥1 saattir HİÇ veri gelmediyse (rapor donmuş) göster.
                    // Rapor periyodik yenilendiği için tahmini son "şu ana yakınsa" araç aktiftir (veri geliyor) → boş;
                    // 60 dk'dan eskiyse araç sessizdir → göster. Geleceğe ait (negatif) tahmin de geçersiz → boş.
                    if (t) { const gecenDk = saatUstundenGecenDk(son); if (gecenDk == null || gecenDk < 60) return null; }
                    return (
                      <span className={`text-[10px] text-red-600 ${t ? "italic opacity-80" : ""}`} title={t ? "GPS'ten türetildi — gerçek kontak verisi henüz gelmedi (tahmini son kontak)" : undefined}>🔴 {t ? "~" : ""}{son.slice(0, 5)} son kontak</span>
                    );
                  })()}
                </span>
              </button>
            );
          })}
          {/* OCAK İŞ MAKİNELERİ — kamyonların yanında, amber chip (ocak çemberi içinde çalışanlar) */}
          {ocakMakineleri.map((mk) => {
            const sa = Math.floor(mk.calismaSn / 3600), dk = Math.floor((mk.calismaSn % 3600) / 60);
            return (
              <div key={`om-${mk.plaka}`} title={`${mk.model || mk.cins || "İş Makinesi"} · ${mk.plaka} — çift tıkla/sağ tık: makineye odaklan`}
                onDoubleClick={() => aracaOdaklan(mk.plaka)}
                onContextMenu={(e) => { e.preventDefault(); setOdakMenu({ x: e.clientX, y: e.clientY, plaka: mk.plaka }); }}
                className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-xs flex items-center gap-2 shrink-0 select-none cursor-pointer">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-amber-500" />
                <span className="flex flex-col items-start leading-tight text-gray-700 max-w-[104px]">
                  <span className="font-semibold truncate max-w-full">⛏️ {mk.plaka}</span>
                  <span className="text-[10px] opacity-60 truncate max-w-full">{mk.model || mk.cins || "İş Makinesi"}</span>
                  <span className="text-[10px] text-amber-700">ocakta çalışıyor</span>
                  {(() => { const e = ilkSonKontakMap?.get(plakaNorm(mk.plaka)); return e?.ilk ? (
                    <span className={`text-[10px] text-emerald-600 ${e.ilkT ? "italic opacity-80" : ""}`} title={e.ilkT ? "GPS'ten türetildi — Arvento kontak vermedi (tahmini)" : undefined}>🟢 {e.ilkT ? "~" : ""}{e.ilk.slice(0, 5)} ilk kontak</span>
                  ) : null; })()}
                  <span className="text-[10px] opacity-80">⏱ {sa}:{String(dk).padStart(2, "0")} çalışma</span>
                  {(() => { const e = ilkSonKontakMap?.get(plakaNorm(mk.plaka)); return e?.son ? (
                    <span className={`text-[10px] text-red-600 ${e.sonT ? "italic opacity-80" : ""}`} title={e.sonT ? "GPS'ten türetildi — Arvento kontak vermedi (tahmini)" : undefined}>🔴 {e.sonT ? "~" : ""}{e.son.slice(0, 5)} son kontak</span>
                  ) : null; })()}
                </span>
              </div>
            );
          })}
          </div>
          {/* Sağ: özet + KML — kartların yanında sabit kalır (daralmaz/alta inmez) */}
          <div className="flex items-start gap-3 shrink-0">
            <div className="text-xs text-gray-600 text-right leading-relaxed">
              <div className="text-sky-700">📏 Toplam yol: <b>{ozet.toplamKm.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km</b></div>
              <div className="text-purple-700">⏱ Toplam çalışma: <b>{formatSure(ozet.toplamHareket)}</b></div>
              <div className="text-orange-700">🔻 Toplam damper: <b>{ozet.toplamDamper}</b></div>
              {dokumSaha && dokumSaha.mesafeM > 0 && (
                <div className="text-red-700" title={`Ana döküm sahası (dökümün %${dokumSaha.oran}'i burada) · kuş uçuşu ${(dokumSaha.straightM / 1000).toFixed(1)} km`}>
                  📍 Döküm sahası: <b>{(dokumSaha.mesafeM / 1000).toFixed(1)} km</b> <span className="text-gray-400 font-normal">(ocaktan, yol)</span>
                </div>
              )}
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
              {kmlIndir && (
                <Button variant="outline" size="sm" onClick={exportKML} className="h-9 gap-1 text-xs">
                  <Download size={14} /> KML İndir
                </Button>
              )}
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

      {/* SEFER ANALİZİ tablosu — kamyon başına ocak/döküm seferi + gerçek/arıza/mükerrer */}
      {seferAnaliz.length > 0 && (
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs font-semibold text-gray-600 mb-2">📋 Sefer Analizi · {formatAralik(bas, bitis)}
            <span className="font-normal text-gray-400"> — başlığa tıkla: haritada o sınıfı göster (gerçek/arızalı/mükerrer)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-[10px] border-b">
                  <th className="text-left py-1 pr-2">Kamyon</th>
                  <th className="text-right px-2" title="Kamyonun ocak çemberine giriş (yükleme) sayısı — GPS rotasından">Ocağa gidiş</th>
                  <th className="text-right px-2" title="Kamyonun ocak çemberinden çıkış (döküme gidiş) sayısı — GPS rotasından">Döküme gidiş</th>
                  {/* TIKLANABİLİR sınıf başlıkları → haritada SADECE o sınıftaki damperleri göster (görsel filtre). */}
                  <th className="text-right px-2">
                    <button type="button" onClick={() => setDamperFiltre("gercek")} title="Haritada gerçek damperleri göster"
                      className={`cursor-pointer transition-colors inline-flex items-center gap-1 ${damperFiltre === "gercek" ? "font-bold text-emerald-700" : "text-gray-400 hover:text-emerald-600"}`}><CheckCircle2 size={13} />Gerçek</button>
                  </th>
                  <th className="text-right px-2">
                    <button type="button" onClick={() => setDamperFiltre("ariza")} title="Haritada arızalı damperleri göster"
                      className={`cursor-pointer transition-colors inline-flex items-center gap-1 ${damperFiltre === "ariza" ? "font-bold text-rose-600" : "text-gray-400 hover:text-rose-500"}`}><AlertTriangle size={13} />Arızalı</button>
                  </th>
                  <th className="text-right px-2">
                    <button type="button" onClick={() => setDamperFiltre("mukerrer")} title="Haritada mükerrer damperleri göster"
                      className={`cursor-pointer transition-colors inline-flex items-center gap-1 ${damperFiltre === "mukerrer" ? "font-bold text-amber-600" : "text-gray-400 hover:text-amber-500"}`}><Copy size={13} />Mükerrer</button>
                  </th>
                  <th className="text-right pl-2">Toplam</th>
                </tr>
              </thead>
              <tbody>
                {seferAnaliz.map((s) => (
                  <tr key={s.plaka} className="border-b border-gray-50 last:border-0">
                    <td className="py-1 pr-2"><span className="font-semibold text-[#1E3A5F]">{s.plaka}</span>{s.surucu ? <span className="text-gray-400"> · {s.surucu}</span> : null}</td>
                    <td className="text-right px-2 tabular-nums">{s.girisOcak}</td>
                    <td className="text-right px-2 tabular-nums">{s.girisDokum}</td>
                    <td className="text-right px-2 tabular-nums font-semibold text-emerald-700">{s.gercek}</td>
                    <td className="text-right px-2 tabular-nums text-rose-600">{s.ariza}</td>
                    <td className="text-right px-2 tabular-nums text-amber-600">{s.mukerrer}</td>
                    <td className="text-right pl-2 tabular-nums">{s.gercek + s.ariza + s.mukerrer}</td>
                  </tr>
                ))}
              </tbody>
              {(() => {
                const tG = seferAnaliz.reduce((a, s) => a + s.gercek, 0), tA = seferAnaliz.reduce((a, s) => a + s.ariza, 0), tM = seferAnaliz.reduce((a, s) => a + s.mukerrer, 0);
                const tGO = seferAnaliz.reduce((a, s) => a + s.girisOcak, 0), tGD = seferAnaliz.reduce((a, s) => a + s.girisDokum, 0);
                return (
                  <tfoot>
                    <tr className="border-t font-semibold text-[#1E3A5F]">
                      <td className="py-1 pr-2">TOPLAM</td>
                      <td className="text-right px-2 tabular-nums">{tGO}</td>
                      <td className="text-right px-2 tabular-nums">{tGD}</td>
                      <td className="text-right px-2 tabular-nums text-emerald-700">{tG}</td>
                      <td className="text-right px-2 tabular-nums text-rose-600">{tA}</td>
                      <td className="text-right px-2 tabular-nums text-amber-600">{tM}</td>
                      <td className="text-right pl-2 tabular-nums">{tG + tA + tM}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            Ocağa gidiş = kamyonun ocak çemberine giriş (yükleme) sayısı; Döküme gidiş = çemberden çıkış sayısı — GPS rotasından (damper gerekmez).
            Arızalı = ocağa uğramadan döken (yüklemesiz). Mükerrer = aynı yerde yanlış tetiklenen.
          </p>
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
                {/* Plaka artık tıklanamaz (düz metin) — tıklama arıza-toggle sorgusunu tetikliyordu.
                    Sınıflama yine sağdaki GERÇEK/MÜKERRER/ARIZA butonlarından yapılır. */}
                <span className="text-gray-400 w-20 truncate text-left">{o.plaka}</span>
                <span className={`font-mono whitespace-nowrap font-semibold ${gizli ? "text-gray-400 line-through" : ""}`}
                  style={gizli ? undefined : { color: renkAl(o.plaka) }}>🔻 {o.saat ?? "—"}</span>
                <span className={`flex-1 truncate ${gizli ? "text-gray-400" : "text-gray-600"}`}>{o.adres ?? "—"}</span>
                {(() => {
                  const aktif: DamperSinif = o.mukerrer ? "mukerrer" : o.ariza ? "ariza" : "gercek";
                  const arac = renkAl(o.plaka); // GERÇEK butonu, aracın harita damper rengiyle aynı
                  // DÜZENLEME yetkisi yoksa sınıf butonları GÖSTERİLMEZ → yalnız mevcut sınıf rozeti (salt-okunur).
                  if (!yDuzenle) {
                    const etiket = aktif === "gercek" ? "Gerçek" : aktif === "mukerrer" ? "Mük." : "Arıza";
                    const stil = aktif === "gercek" ? { background: arac, color: "#fff" } : aktif === "mukerrer" ? { background: "#f59e0b", color: "#fff" } : { background: "#e11d48", color: "#fff" };
                    return (
                      <span className="flex items-center gap-0.5 shrink-0">
                        <span className="text-[9px] leading-none px-1 py-0.5 rounded" style={stil}>{etiket}</span>
                        {aktif === "gercek" && o.dogrulanmamis && <span className="text-[9px] text-blue-500" title="Rota verisi yok — doğrulanmamış">?</span>}
                        {(o.lat == null || o.lng == null) && <span className="text-[9px] text-gray-400" title="Konumsuz"><MapPin size={9} className="inline" />✕</span>}
                      </span>
                    );
                  }
                  const pasif = "bg-white text-gray-400 border-gray-200 hover:bg-gray-100";
                  const sinifBtn = "text-[9px] leading-none px-1 py-0.5 rounded border transition-colors";
                  return (
                    <span className="flex items-center gap-0.5 shrink-0">
                      <button type="button" onClick={() => damperSinifDegistir(o.plaka, damperTarih(o), o.saat,"gercek")} title="Bu damperin sınıfını elle ayarla"
                        style={aktif === "gercek" ? { background: arac, borderColor: arac, color: "#fff" } : undefined}
                        className={`${sinifBtn} ${aktif === "gercek" ? "" : pasif}`}>Gerçek</button>
                      <button type="button" onClick={() => damperSinifDegistir(o.plaka, damperTarih(o), o.saat,"mukerrer")} title="Bu damperin sınıfını elle ayarla"
                        className={`${sinifBtn} ${aktif === "mukerrer" ? "bg-amber-500 text-white border-amber-500" : pasif}`}>Mük.</button>
                      <button type="button" onClick={() => damperSinifDegistir(o.plaka, damperTarih(o), o.saat,"ariza")} title="Bu damperin sınıfını elle ayarla"
                        className={`${sinifBtn} ${aktif === "ariza" ? "bg-rose-600 text-white border-rose-600" : pasif}`}>Arıza</button>
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
