// Arvento Serme & Sıkıştırma haritaları.
// Temel: greyder (reglaj) güzergahı ALTLI ÜSTLÜ (paralel çift) çizgi olarak çizilir.
//   - Serme      → altlı üstlü çizgi (yeşil) + ortada yuvarlak renkli damper noktaları
//   - Sıkıştırma → altlı üstlü çizgi (yeşil, soluk referans) + ortada silindir ZİKZAK (mor)
// Greyder çizgisi "Güzergah Tekrar Eşiği", silindir zikzak "Silindir Tekrar Eşiği" ile sadeleşir.
// Harita uydu (Google Earth) görünümünde.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange, plakaNorm, birlestirGuzergahPlaka, getStabilizeOzetDirect, damperNoktalariRange, oncekiDamperCek, guzergahVeriImza, raporVeriImza } from "@/lib/supabase/queries/arvento";
import { aracRenkSecici } from "@/lib/arvento/arac-renk";
import { mesafeMetre } from "@/lib/arvento/ocak";
import { HaritaIskelet } from "@/components/shared/harita-iskelet";
import { kmlRenk, yukluKatmanlarKml } from "@/lib/arvento/kml-export";
import { type OzetDamper } from "@/lib/arvento/stabilize-ozet";
import { sadelesGuzergah, kapsananYolKm, parcalarUzunlukKm, tsSaniye } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar, type KatmanIzin } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, aracKonumunaOdaklan, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject, ReactNode } from "react";
import { usePasifSecim } from "@/lib/arvento/use-pasif-secim";
import { OPERASYONLAR, operasyondaGorunur, atananSekmeleriHesapla, type OperasyonTip, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Layers, Download } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

const DAMPER_RENK = "#f97316";
// Damper GÖSTERİMİ (kamyon noktaları) sezon başından itibaren TÜM sezonu kapsar — serme rotaları seçili
// aralıkta kalır ama "nereye damper döküldü" haritası tüm sezonu gösterir (dashboard sezonuyla aynı baş).
const SEZON_BAS = "2026-01-01";

// GEÇMİŞ greyder rotaları (sezon başı → aralık öncesi) — "serilmiş damper" tespiti için oturum cache'i.
// Geçmiş değişmez → aynı (aralık başı + plaka kümesi) için tablo taraması oturumda 1 kez yapılır.
const gecmisRotaCache = new Map<string, AracArventoGuzergah[]>();
function gunOnce(t: string): string {
  const d = new Date(t + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Serme: "önceden damper dökülmüş yol" tespiti için ~50 m sabit ızgara (bölge ~41° enlem).
// Geçmiş damper noktaları bu ızgaraya (±1 komşu) işlenir; seçilen günün greyder rotasının
// bu hücrelere denk gelen kısmı = SERME (reglaj sonrası malzeme serilen yol).
const SERME_HUCRE_M = 50;
const SERME_LAT_STEP = SERME_HUCRE_M / 111320;
const SERME_LNG_STEP = SERME_HUCRE_M / (111320 * Math.cos((41 * Math.PI) / 180));
function sermeHucreIdx(lat: number, lng: number): [number, number] {
  return [Math.round(lat / SERME_LAT_STEP), Math.round(lng / SERME_LNG_STEP)];
}
function sermeHucreKey(lat: number, lng: number): string {
  const [y, x] = sermeHucreIdx(lat, lng);
  return `${y}_${x}`;
}
// Bir çizgiyi yerel yöne DİK ±offsetM kaydırıp ALT + ÜST iki paralel çizgi üret (serme = serilen şerit, çift çizgi).
function altUstParalel(seg: [number, number][], offsetM: number): { ust: [number, number][]; alt: [number, number][] } {
  const ust: [number, number][] = [], alt: [number, number][] = [];
  const n = seg.length;
  for (let i = 0; i < n; i++) {
    const [la, ln] = seg[i];
    const [pla, pln] = seg[Math.max(0, i - 1)];
    const [nla, nln] = seg[Math.min(n - 1, i + 1)];
    const cosL = Math.cos((la * Math.PI) / 180) || 1;
    let dx = (nln - pln) * 111320 * cosL, dy = (nla - pla) * 111320; // yön (metre): dx=doğu, dy=kuzey
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const oLat = (dx * offsetM) / 111320;            // dik vektör (-dy, dx) → kuzey bileşeni = dx
    const oLng = (-dy * offsetM) / (111320 * cosL);  // doğu bileşeni = -dy
    ust.push([la + oLat, ln + oLng]);
    alt.push([la - oLat, ln - oLng]);
  }
  return { ust, alt };
}
// Araç renkleri MERKEZİ atanır (lib/arvento/arac-renk) → aynı plaka her sekmede aynı renk.

// saniye → "2sa 15dk" / "0"
function formatSure(sn: number): string {
  if (!sn) return "0";
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  return sa > 0 ? `${sa}sa ${dk}dk` : `${dk}dk`;
}

type DamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
// _rawLat/_rawLng: damperin HAM (alarm GPS) konumu. Gösterim DURAK'a oturur ama serme yol eşleşmesi HAM ile
// yapılır (serme tespiti de ham konumu kullanıyor → tutarlı; durak snap'i yarısını kaçırıyordu).
type DamperNokta = DamperOlay & { plaka: string; _rawLat?: number | null; _rawLng?: number | null; _t?: string | null }; // _t: döküm TARİHİ (YYYY-MM-DD) — "sonradan serildi mi" karşılaştırması için
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
function yakinDamperVar(noktalar: { lat: number; lng: number }[], damperler: { lat?: number | null; lng?: number | null }[], esikM = 80): boolean {
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
function parcalar(noktalar: { lat: number; lng: number; hiz?: number | null }[], esik: number, gridM: number, hizEsik: number): [number, number][][] {
  const latlngs: [number, number][] = noktalar.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng]);
  if (latlngs.length === 0) return [];
  if (esik >= 1) return sadelesGuzergah(noktalar, esik, gridM, hizEsik).parcalar; // eşik (tekrar) ile açılır

  return [latlngs];
}

export default function ArventoOperasyon({ bas, bitis, operasyon, tekrarEsigi = 0, tekrarPencereSaat = 0, silindirEsik = 0, gridMesafe = 12, transitHiz = 20, mukerrerDk = 0, mukerrerYaricap = 0, ocakLat = null, ocakLng = null, ocakYaricap = 150, damperSinif, kalinliklar, renkler, kontakRolantiMap, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, modelGoster = false, modelMap, ilkSonKontakMap, izinliPlakalar, katmanIzinli, refreshKey = 0, sonGuncelleme, canliButton, kmlIndir = true }: {
  bas: string; bitis: string; operasyon: OperasyonTip; tekrarEsigi?: number; tekrarPencereSaat?: number; silindirEsik?: number; gridMesafe?: number; transitHiz?: number; mukerrerDk?: number; mukerrerYaricap?: number; ocakLat?: number | null; ocakLng?: number | null; ocakYaricap?: number; damperSinif?: Map<string, "gercek" | "mukerrer" | "ariza">; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; kontakRolantiMap?: Map<string, { kontak: number; rolanti: number }>; ilkSonKontakMap?: Map<string, { ilk: string | null; son: string | null; ilkT?: boolean; sonT?: boolean }>; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; modelGoster?: boolean; modelMap?: Map<string, string | null>; izinliPlakalar?: string[] | null; katmanIzinli?: KatmanIzin; refreshKey?: number; sonGuncelleme?: Date | null; canliButton?: ReactNode; kmlIndir?: boolean;
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
  // SERME: seçilen günden ÖNCE damper dökülmüş yol hücreleri (tüm geçmiş taranır). Serme = greyder
  // rotasının bu hücrelere denk gelen kısmı. Boş = henüz yükleniyor / önceden damper yok.
  // SERME: seçilen aralık BAŞINDAN ÖNCEKİ damperler (tarih+saat = dt). Aralık içi damperler raporlar'dan gelir.
  const [oncekiDamper, setOncekiDamper] = useState<{ lat: number; lng: number; dt: string }[]>([]);
  const [tumGuzergahHam, setTumGuzergah] = useState<AracArventoGuzergah[]>([]);
  // GEÇMİŞ greyder rotaları (sezon başı → aralık öncesi) — yalnız SERME'de, "serilmiş damper" tespiti için.
  const [gecmisGreyder, setGecmisGreyder] = useState<AracArventoGuzergah[]>([]);
  const [raporlarHam, setRaporlar] = useState<AracArventoRapor[]>([]);
  // ÖZET damperler: sınıflama (gerçek/arıza/mükerrer) SUNUCUDA hazır (stabilize özetiyle BİREBİR, gün-bazlı
  // ocak). Serme kamyon GPS çekmediği için arizaIsaretle'yi BURADA çalıştıramıyoruz → özetten alıyoruz.
  const [ozetDampers, setOzetDampers] = useState<OzetDamper[]>([]);
  // Sezon (SEZON_BAS→bitiş) TÜM ham damperleri — özet boşsa ikon fallback'i (bugün değil, tüm sezon görünür).
  const [sezonHamDamper, setSezonHamDamper] = useState<{ plaka: string; saat: string | null; adres: string | null; lat: number; lng: number }[]>([]);
  // İZİN FİLTRESİ: kısıtlı kullanıcı yalnız izinli plakaları (yakınlık şantiyesine göre) görür.
  const izinSet = useMemo(() => (izinliPlakalar ? new Set(izinliPlakalar.map(plakaNorm)) : null), [izinliPlakalar]);
  const tumGuzergah = useMemo(() => (izinSet ? tumGuzergahHam.filter((k) => izinSet.has(plakaNorm(k.plaka))) : tumGuzergahHam), [tumGuzergahHam, izinSet]);
  // OMURGA/chip için plaka-bazında birleşik (TÜM günler tek hat). Damper sınıflaması ise GÜN-BAZLI
  // tumGuzergah kullanır (rotaByGun, plaka|tarih) — birleşik kullanılırsa günler karışıp damper bozulur.
  const tumGuzergahBirlesik = useMemo(() => birlestirGuzergahPlaka(tumGuzergah), [tumGuzergah]);
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

  // SERME + SIKIŞTIRMA = GÜNLÜK/ARALIK: ikisi de SEÇİLEN tarih aralığını (bas→bitis) uygular; aralık seçilmezse
  // yalnız o günü gösterir (reglaj gibi, dashboard "günlük" ile tutar). Serme için "bu yola daha önce damper
  // döküldü mü" geçmişi, aralık ÖNCESİNDEN oncekiDamper ile gelir → kümülatif fetch gerekmez.
  const sermeBas = bas;
  const yapiRef = useRef(""); // yükleme göstergesi yalnız tarih/operasyon değişiminde; periyodik tazelemede sessiz
  const yukNoRef = useRef(0); // yükleme sıra no — ESKİ (geçersiz kılınmış) isteğin yanıtı yeni veriyi EZMESİN
  useEffect(() => {
    if (!bitis) { yukNoRef.current++; setTumGuzergah([]); setRaporlar([]); setLoading(false); return; }
    const yapi = `${sermeBas}|${bitis}|${sermeMi}`;
    const yapisal = yapiRef.current !== yapi;
    // Tarih değişti → ESKİ VERİYİ HEMEN TEMİZLE (yoksa yeni veri/çizim gelene kadar eski rakamlar görünür) + yükleniyor göster.
    if (yapisal) { yapiRef.current = yapi; setLoading(true); setTumGuzergah([]); setRaporlar([]); }
    const benimNo = ++yukNoRef.current; // bu yüklemenin sırası; yanıt gelince hâlâ en güncel mi diye bakılır
    // Veri SEZON BAŞINDAN bitişe (sermeBas→bitis): greyder/silindir rotası + özet damperler + rapor. Greyder
    // küçük olduğundan tek sorgu (geniş aralıkta gün-gün yüzlerce istek yerine).
    (async () => {
      try {
        // Damper GÖSTERİMİ tüm sezonu kapsar (SEZON_BAS→bitiş) — serme rotaları aralıkta kalır. Özet (sınıflı)
        // + ham (fallback, özet boşsa) sezon bazında paralel çekilir. Rapor'a bağımsız → hemen başlat.
        const ozetPromise = getStabilizeOzetDirect(SEZON_BAS, bitis).then((d) => {
          if (d.dampers.length > 0) return d.dampers;
          return fetch(`/api/arvento/stabilize-ozet?bas=${SEZON_BAS}&bitis=${bitis}`)
            .then((res) => (res.ok ? res.json() : { dampers: [] })).then((j) => (j.dampers ?? []) as OzetDamper[]).catch(() => [] as OzetDamper[]);
        });
        const r = (await getArventoRaporByRange(sermeBas, bitis)) as AracArventoRapor[];
        if (benimNo !== yukNoRef.current) return;
        const ilgili = [...new Set(r
          .filter((x) =>
            operasyondaGorunur(sekmeMap, atananSekmeler, null, "serme", x.plaka) ||
            operasyondaGorunur(sekmeMap, atananSekmeler, null, "sikistirma", x.plaka))
          .map((x) => x.plaka))];
        // GEÇMİŞ greyder rotası (sezon başı → aralık öncesi) de yalnız `ilgili`ye bağlı → ana sorguyla
        // PARALEL başlat. Önce sıralı bekletiliyordu; Serme sekmesi bu yüzden diğerlerinden geç açılıyordu.
        const gecmisPromise: Promise<AracArventoGuzergah[]> = (() => {
          if (!(sermeMi && sermeBas > SEZON_BAS && ilgili.length > 0)) return Promise.resolve([] as AracArventoGuzergah[]);
          const ck = `${sermeBas}|${[...ilgili].sort().join(",")}`;
          const ez = gecmisRotaCache.get(ck);
          if (ez) return Promise.resolve(ez);
          return getGuzergahByRange(SEZON_BAS, gunOnce(sermeBas), ilgili, { tekSorgu: true })
            .then((v) => { gecmisRotaCache.set(ck, v); return v; })
            .catch(() => [] as AracArventoGuzergah[]);
        })();
        const [g, oz] = await Promise.all([getGuzergahByRange(sermeBas, bitis, ilgili, { tekSorgu: true }), ozetPromise]);
        if (benimNo !== yukNoRef.current) return;
        // Özet (sınıflı sezon damperi) doluysa ham sezon scan'ini ATLA (havuzu yorma); yalnız özet boşsa çek.
        const sezonHam = (oz as OzetDamper[]).length > 0 ? [] : await damperNoktalariRange(SEZON_BAS, bitis).catch(() => []);
        if (benimNo !== yukNoRef.current) return;
        // GEÇMİŞ GREYDER GEÇİŞLERİ (sezon başı → aralık öncesi) — "serilmiş damper" tespiti için:
        // damper, aralıktan ÖNCEKİ günlerde serilmişse de gizlenmeli (kullanıcı isteği). Geçmiş değişmez
        // → oturum cache'i (yukarıda): aynı aralık başı + plaka kümesi için tarama oturumda 1 kez yapılır.
        const gecmis = await gecmisPromise;
        if (benimNo !== yukNoRef.current) return;
        setGecmisGreyder(gecmis);
        // Veri AYNIYSA eski referansları koru → periyodik tazelemede serme ızgarası/omurga/harita boş yere kurulmaz.
        setTumGuzergah((prev) => (guzergahVeriImza(prev) === guzergahVeriImza(g) ? prev : g));
        setRaporlar((prev) => (raporVeriImza(prev) === raporVeriImza(r) ? prev : r));
        setOzetDampers(oz as OzetDamper[]); setSezonHamDamper(sezonHam);
      } catch (err) {
        if (benimNo !== yukNoRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      } finally {
        if (benimNo === yukNoRef.current) setLoading(false);
      }
    })();
  }, [sermeBas, bitis, refreshKey, sermeMi, sekmeMap, atananSekmeler]);

  // Serme = greyder hattı; atama varsa "serme" ataması esas alınır, yoksa otomatik sınıf tespiti.
  const greyderler = useMemo(() => tumGuzergahBirlesik.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi, "serme", k.plaka)), [tumGuzergahBirlesik, sekmeMap, atananSekmeler]);
  const silindirler = useMemo(() => tumGuzergahBirlesik.filter((k) => operasyondaGorunur(sekmeMap, atananSekmeler, k.arac_sinifi, "sikistirma", k.plaka)), [tumGuzergahBirlesik, sekmeMap, atananSekmeler]);

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
  // PASİF silindirler — gün değişse de KORUNUR; F5'te sıfırlanır (modül-seviyesi store).
  const [pasifSilindirler, setPasifSilindirler] = usePasifSecim(`arvento-pasif-silindir-${operasyon}`);
  const seciliSilindirler = useMemo(() => new Set(silindirChipler.map((k) => k.plaka).filter((p) => !pasifSilindirler.has(p))), [silindirChipler, pasifSilindirler]);
  // Merkezi renk — her sekmede aynı. Greyder + silindir TEK listede verilir: bu ekranda görünen
  // hiçbir iki araç (iki greyder dahil) aynı rengi paylaşmaz — çakışma onarımı.
  const ekranRenkAl = useMemo(
    () => aracRenkSecici([...greyderler.map((k) => k.plaka), ...silindirChipler.map((k) => k.plaka)]),
    [greyderler, silindirChipler],
  );
  const silindirRenkAl = ekranRenkAl;
  const secilenSilindirler = useMemo(() => silindirler.filter((k) => seciliSilindirler.has(k.plaka)), [silindirler, seciliSilindirler]);
  const silindirToggle = (p: string) => setPasifSilindirler((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }); // pasife ekle/çıkar (gün değişse korunur)

  // Serme: greyderler de Stabilize kamyonları gibi renkli chip — çoklu seçim
  // PASİF greyderler — gün değişse de KORUNUR; F5'te sıfırlanır (modül-seviyesi store).
  const [pasifGreyderler, setPasifGreyderler] = usePasifSecim(`arvento-pasif-greyder-${operasyon}`);
  const seciliGreyderler = useMemo(() => new Set(greyderler.map((k) => k.plaka).filter((p) => !pasifGreyderler.has(p))), [greyderler, pasifGreyderler]);
  const greyderRenkAl = ekranRenkAl;
  const greyderToggle = (p: string) => setPasifGreyderler((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }); // pasife ekle/çıkar (gün değişse korunur)

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
    const rota = tumGuzergahBirlesik.find((k) => plakaNorm(k.plaka) === plakaNorm(plaka))?.noktalar;
    if (!aracKonumunaOdaklan(map, plaka, canliVeriRef.current, rota, plakaNorm))
      toast.error("Aracın konumu bulunamadı (canlı kapalı ve güzergah yok).", { duration: toastSuresi() });
  }, [tumGuzergahBirlesik]);

  // Kamyon damperleri (serme'de ortada gösterilir)
  // Damper noktaları — YALNIZ GERÇEK (Stabilize ile aynı sınıflama): mükerrer + arıza ayıklanır,
  // manuel override uygulanır. (Arızalı/mükerrer damper serme sayılmaz; Serme/Sıkıştırma bunları kullanmaz.)
  const damperKoordlu = useMemo<DamperNokta[]>(() => {
    // ÖZET'ten: yalnız GERÇEK damperler (mükerrer/arıza ayıklanır) + manuel override + izin filtresi.
    // Konum = durak (oturtulmuş) varsa o, yoksa ham. Sınıflama sunucuda (gün-bazlı ocak) → stabilize ile birebir.
    const out: DamperNokta[] = [];
    for (const d of ozetDampers) {
      if (izinSet && !izinSet.has(plakaNorm(d.plaka))) continue; // kısıtlı kullanıcı: yalnız izinli plakalar
      let mk = d.mukerrer, ar = d.ariza;
      const ov = damperSinif?.get(`${plakaNorm(d.plaka)}|${d.tarih}|${d.saat ?? ""}`); // manuel override
      if (ov === "gercek") { mk = false; ar = false; } else if (ov === "mukerrer") { mk = true; ar = false; } else if (ov === "ariza") { ar = true; mk = false; }
      if (mk || ar) continue; // yalnız gerçek
      // MESAFE KORUMASI: eski özetlerdeki durak konumu, alarm (ham) konumdan >80m uzağa oturmuş
      // olabilir (200m'ye varan kayma) → o durumda HAM konumu göster (ham, araç rotasına ≤25m isabetli).
      const durakOk = d.durakLat != null && d.durakLng != null
        && (d.rawLat == null || d.rawLng == null || mesafeMetre(d.durakLat, d.durakLng, d.rawLat, d.rawLng) <= 80);
      const la = durakOk ? d.durakLat : (d.rawLat ?? d.durakLat);
      const ln = durakOk ? d.durakLng : (d.rawLng ?? d.durakLng);
      if (la == null || ln == null) continue;
      out.push({ saat: d.saat, adres: d.adres, lat: la, lng: ln, plaka: d.plaka, _rawLat: d.rawLat, _rawLng: d.rawLng, _t: d.tarih });
    }
    return out;
  }, [ozetDampers, izinSet, damperSinif]);

  // HAM damperler (rapor'daki damper_olaylar) — serme ROTASI bu kaynaktan çizilir. ÖZET (damperKoordlu) boş
  // dönebiliyor (o aralık için sunucu özeti yoksa) → o durumda rotalar var ama ikon yok, serme reglaj gibi
  // görünüyordu. Fallback: özet boşsa ikonları buradan göster ki rota olan yerde damper ikonu da olsun.
  const hamDamperNoktalar = useMemo<DamperNokta[]>(() => {
    const out: DamperNokta[] = [];
    const seen = new Set<string>();
    for (const d of sezonHamDamper) { // TÜM sezon (SEZON_BAS→bitiş) ham damperleri
      if (izinSet && !izinSet.has(plakaNorm(d.plaka))) continue; // kısıtlı kullanıcı: yalnız izinli plakalar
      if (d.lat == null || d.lng == null) continue;
      const key = `${plakaNorm(d.plaka)}|${d.lat.toFixed(5)}|${d.lng.toFixed(5)}`;
      if (seen.has(key)) continue; // aynı konumdaki mükerrer ping'i tekle
      seen.add(key);
      out.push({ saat: d.saat, adres: d.adres, lat: d.lat, lng: d.lng, plaka: d.plaka, _rawLat: d.lat, _rawLng: d.lng });
    }
    return out;
  }, [sezonHamDamper, izinSet]);

  // Serme haritasında/özetinde gösterilecek damperler: ÖZET (sınıflı, mükerrer/arıza ayıklı) varsa o; YOKSA
  // ham raporlar damperleri (rotayla aynı kaynak → "rota var ikon yok" olmaz).
  const damperGoster = useMemo<DamperNokta[]>(
    () => (damperKoordlu.length > 0 ? damperKoordlu : hamDamperNoktalar),
    [damperKoordlu, hamDamperNoktalar],
  );

  // SERME ROTA NOKTALARI (Sıkıştırma için): serme YAPILAN (damper ≤80 m yakını) greyder omurgalarının
  // noktaları. Silindir bu noktaların üstünden gidip geldiyse o kısım sıkıştırma sayılır.
  // "km yol" = HARİTADA ÇİZİLEN çizginin (eşikli omurga) uzunluğu. Eşik ≥ 1 ama yol eşik kadar
  // taranmamışsa omurga BOŞ → 0. SERME'de AYRICA: greyder hattının ≤80 m'sinde damper YOKSA serme
  // yapılmamıştır → 0 ("damper olmayan yolda serme olmaz"). Ham modda (eşik < 1) kapsanan yol.
  // omurgaKmMap, sermeByPlaka'dan SONRA tanımlı (serme km'si oradan gelir) — aşağıya taşındı.

  // SERME ızgarası: her hücreye o hücredeki EN ERKEN damper tarihi. Aralık öncesi (oncekiDamper) +
  // aralık içi (raporlar) damperleri birleşir. Böylece "bu yola, bu greyder geçişinden ÖNCE damper
  // dökülmüş mü?" gün-gün sorulabilir (aralıkta da çalışır; tek güne de uyar).
  const damperHucreTarih = useMemo(() => {
    const m = new Map<string, string>(); // hücre → en erken damper DATETIME ("YYYY-MM-DD HH:MM:SS")
    const ekle = (lat: number, lng: number, dt: string) => {
      const [cy, cx] = sermeHucreIdx(lat, lng);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const key = `${cy + dy}_${cx + dx}`;
        const mevcut = m.get(key);
        if (mevcut == null || dt < mevcut) m.set(key, dt);
      }
    };
    for (const d of oncekiDamper) ekle(d.lat, d.lng, d.dt);
    for (const r of raporlar) {
      for (const o of (r.damper_olaylar ?? []) as { lat?: number | null; lng?: number | null; saat?: string | null }[]) {
        if (o?.lat == null || o?.lng == null) continue;
        ekle(o.lat, o.lng, `${r.rapor_tarihi} ${o.saat ?? "00:00:00"}`);
      }
    }
    return m;
  }, [oncekiDamper, raporlar]);

  // SERME = greyderin GÜN-GÜN rotasının, o günden ÖNCE damper dökülmüş hücrelere denk gelen kısmı.
  // Plaka bazında toplanır → omurga (tek çizgi). Reglajı (taze yol, önceden damper yok) serme'den ayırır.
  const sermeByPlaka = useMemo(() => {
    if (!sermeMi) return [] as { plaka: string; arac_sinifi: string | null; parcalar: [number, number][][] }[];
    const greyderPlakalar = new Set(greyderler.filter((k) => seciliGreyderler.has(k.plaka)).map((k) => plakaNorm(k.plaka)));
    const byP = new Map<string, { plaka: string; arac_sinifi: string | null; pts: { lat: number; lng: number; hiz?: number | null; ts?: number | null }[] }>();
    for (const row of tumGuzergah) {
      const pk = plakaNorm(row.plaka);
      if (!greyderPlakalar.has(pk)) continue;
      const D = row.rapor_tarihi;
      let g = byP.get(pk);
      if (!g) { g = { plaka: row.plaka, arac_sinifi: row.arac_sinifi ?? null, pts: [] }; byP.set(pk, g); }
      for (const p of (row.noktalar ?? [])) {
        if (p?.lat == null || p?.lng == null) continue;
        // Bu greyder geçişinin DATETIME'ı; o hücreye DAHA ÖNCE damper dökülmüşse (ct < geçiş) = serme.
        // Damperden ÖNCEKİ geçişler (reglaj) elenir → reglaj ile serme artık karışmaz.
        const ct = damperHucreTarih.get(sermeHucreKey(p.lat, p.lng));
        const gecisDt = `${D} ${p.saat ?? "23:59:59"}`;
        if (ct != null && ct < gecisDt) g.pts.push({ lat: p.lat, lng: p.lng, hiz: p.hiz, ts: tsSaniye(D, p.saat) });
      }
    }
    const out: { plaka: string; arac_sinifi: string | null; parcalar: [number, number][][] }[] = [];
    for (const g of byP.values()) {
      if (g.pts.length < 2) continue;
      out.push({ plaka: g.plaka, arac_sinifi: g.arac_sinifi, parcalar: sadelesGuzergah(g.pts, etkinTekrar, gridMesafe, transitHiz, tekrarPencereSaat * 3600).parcalar });
    }
    return out;
  }, [sermeMi, greyderler, seciliGreyderler, tumGuzergah, damperHucreTarih, etkinTekrar, gridMesafe, transitHiz, tekrarPencereSaat]);

  // Yol tıklandığında popup için TÜM araçların (greyder + silindir) HAM noktaları (saat + hız + tarih).
  // Tıklanan konuma EN YAKIN nokta → plaka/model/hız/tarih/saat. (Omurga tek değer taşımaz; ham noktadan alınır.)
  const hamNoktaByPlaka = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; saat: string | null; hiz: number | null; tarih: string }[]>();
    for (const row of tumGuzergah) {
      const pk = plakaNorm(row.plaka);
      let arr = m.get(pk); if (!arr) { arr = []; m.set(pk, arr); }
      for (const p of (row.noktalar ?? [])) {
        if (p.lat != null && p.lng != null) arr.push({ lat: p.lat, lng: p.lng, saat: p.saat, hiz: p.hiz, tarih: row.rapor_tarihi });
      }
    }
    return m;
  }, [tumGuzergah]);

  // Her hücre için SON greyder geçiş DATETIME'ı — GEÇMİŞ (sezon→aralık öncesi) + aralık rotaları birlikte.
  // "Serilmiş damper" tespitinin kaynağı: damper kendi döküm anından SONRA bu hücrelerden geçilmişse
  // serilmiştir. Chip seçiminden BAĞIMSIZ (greyder chip'i kapatınca damperler geri gelmesin).
  const sonGecisHucre = useMemo(() => {
    const m = new Map<string, string>();
    if (!sermeMi) return m;
    const isle = (rows: AracArventoGuzergah[]) => {
      for (const row of rows) {
        if (!operasyondaGorunur(sekmeMap, atananSekmeler, row.arac_sinifi, "serme", row.plaka)) continue;
        const D = row.rapor_tarihi;
        for (const p of (row.noktalar ?? [])) {
          if (p?.lat == null || p?.lng == null) continue;
          const dt = `${D} ${p.saat ?? "23:59:59"}`;
          const [cy, cx] = sermeHucreIdx(p.lat, p.lng);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const key = `${cy + dy}_${cx + dx}`;
            const mev = m.get(key);
            if (mev == null || dt > mev) m.set(key, dt);
          }
        }
      }
    };
    isle(gecmisGreyder);
    isle(tumGuzergah);
    return m;
  }, [sermeMi, gecmisGreyder, tumGuzergah, sekmeMap, atananSekmeler]);

  // SERME DAMPERLERİ: TÜM gerçek damperler GÖSTERİLİR, AMA SERİLMİŞ (dökümünden SONRA üzerinden greyder
  // geçmiş) damperler KALDIRILIR — önceki günlerde serilenler DAHİL (kullanıcı isteği). Aynı yere yeni
  // döküm yapılırsa yeni yığının tarihi son geçişten YENİ olur → yine görünür. Kalan turuncu noktalar =
  // serilmeyi bekleyen dökümler.
  const sermeDamperleri = useMemo<DamperNokta[]>(() => {
    if (!sermeMi) return [];
    // Tarihsiz damper (ham fallback — özet boşken) için eski yöntem: aralıktaki serme yoluna denk gelme.
    const hucreler = new Set<string>(); // serme YAPILAN yol hücreleri (±1)
    for (const g of sermeByPlaka) for (const seg of g.parcalar) for (const [la, ln] of seg) {
      const [cy, cx] = sermeHucreIdx(la, ln);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) hucreler.add(`${cy + dy}_${cx + dx}`);
    }
    const serilmisMi = (o: DamperNokta): boolean => {
      const dt = o._t ? `${o._t} ${o.saat ?? "00:00:00"}` : null;
      const konumlar: [number, number][] = [];
      const rl = o._rawLat ?? o.lat, rg = o._rawLng ?? o.lng;
      if (rl != null && rg != null) konumlar.push([rl as number, rg as number]);
      if (o.lat != null && o.lng != null) konumlar.push([o.lat as number, o.lng as number]);
      for (const [la, ln] of konumlar) {
        const key = sermeHucreKey(la, ln);
        if (dt) {
          const g = sonGecisHucre.get(key);
          if (g != null && g > dt) return true; // dökümden SONRA geçiş var → serilmiş
        } else if (hucreler.has(key)) {
          return true; // tarihsiz → aralık serme yoluna denk geliyor
        }
      }
      return false;
    };
    return damperGoster.filter((o) => !serilmisMi(o));
  }, [sermeMi, sermeByPlaka, sonGecisHucre, damperGoster]);

  // Çip "km yol": SERME'de damper-SONRASI serme omurgası (sermeByPlaka); SIKIŞTIRMA'da silindir omurgası.
  // Serme greyderinin TOPLAM rotası DEĞİL → reglaj ile aynı görünmez. Serme'si olmayan greyder = 0.
  const omurgaKmMap = useMemo(() => {
    const m = new Map<string, number>();
    if (sermeMi) {
      for (const k of greyderler) m.set(k.plaka, 0); // varsayılan: serme yok → 0
      for (const g of sermeByPlaka) m.set(g.plaka, parcalarUzunlukKm(g.parcalar));
      return m;
    }
    const esik = etkinSilindir;
    for (const k of silindirler) {
      const ns = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (ns.length < 2) continue;
      m.set(k.plaka, esik < 1 ? kapsananYolKm(ns, gridMesafe) : parcalarUzunlukKm(parcalar(ns, esik, gridMesafe, transitHiz)));
    }
    return m;
  }, [sermeMi, greyderler, sermeByPlaka, silindirler, gridMesafe, etkinSilindir, transitHiz]);
  // Seçili aralıkta yapılan TOPLAM serme (km) — seçili greyderlerin serme omurgalarının toplamı (header'da gösterilir).
  const sermeToplamKm = useMemo(() => (sermeMi ? sermeByPlaka.reduce((s, g) => s + parcalarUzunlukKm(g.parcalar), 0) : 0), [sermeMi, sermeByPlaka]);
  // TOPLAM sıkıştırma (km) — seçili silindirlerin omurga km'lerinin (chip "km yol") toplamı (header'da gösterilir).
  const sikistirmaToplamKm = useMemo(() => (!sermeMi ? secilenSilindirler.reduce((s, k) => s + (omurgaKmMap.get(k.plaka) ?? 0), 0) : 0), [sermeMi, secilenSilindirler, omurgaKmMap]);

  // Serme: greyder hattı yalnızca ÜZERİNDE/yakınında damper varsa gösterilir
  // (reglaj→damper→reglaj). Damper yoksa serme yapılmamıştır → boş.
  const gosterilenGreyder = useMemo(() => {
    // Sıkıştırma: greyder yalnızca soluk referans → tüm greyderler
    if (!sermeMi) return greyderler;
    // Serme: çoklu chip seçimi + yakınında damper olan greyder hatları
    return greyderler
      .filter((k) => seciliGreyderler.has(k.plaka))
      .filter((k) => yakinDamperVar(k.noktalar ?? [], damperGoster));
  }, [greyderler, seciliGreyderler, sermeMi, damperGoster]);

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
      // Güzergah/serme çizgileri için AYRI pane (z 450) — KML pane'inin (350) ÜSTÜnde → KML altta, çizgiler
      // üstte ve TIKLANABİLİR olur (SVG DOM path). preferCanvas damper noktalarını canvas'ta (400) bırakır.
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

  // SERME geçmiş damper taraması: SEZON BAŞINDAN (sermeBas) önceki damperler (genelde boş — sezon içi
  // damperler raporlar'dan gelir). oncekiDamperCek KULLANILIR: deterministik sıralı sayfalama + oturum
  // cache'i (geçmiş değişmez → tabloyu bir kez tarar; eskiden buradaki kopya her seferinde tarıyordu).
  useEffect(() => {
    if (!sermeMi || !sermeBas) { setOncekiDamper([]); return; }
    let iptal = false;
    oncekiDamperCek(sermeBas).then((out) => { if (!iptal) setOncekiDamper(out); }).catch(() => { if (!iptal) setOncekiDamper([]); });
    return () => { iptal = true; };
  }, [sermeMi, sermeBas]);

  // Veri/seçim/ayar değişince YALNIZ veri katmanını yeniden çiz (harita yerinde kalır → flicker yok).
  useEffect(() => {
    const map = mapInstanceRef.current;
    const grup = veriKatmanRef.current;
    const L = leafletRef.current;
    if (!map || !grup || !L) return;
    grup.clearLayers();
    const bounds: [number, number][] = [];
    // Güzergah/serme çizgileri SVG + üst pane (opYolPane z450) → KML'nin (350) üstünde, DOM path = KESİN tıklanır
    // (preferCanvas'ın canvas çizgisi ince hatlarda tıklamayı kaçırıyordu; damper noktaları canvas'ta kalır).
    const yolRenderer = L.svg({ pane: "opYolPane" });
    // ORTAK yol popup'ı — tıklanan konuma EN YAKIN ham nokta (verilen plakalar arasında) → plaka·model / hız / tarih saat.
    // Havuzlanmış (birleşik) çizgide birden çok plaka olabilir; en yakın nokta hangi araca aitse o gösterilir.
    const yolPopup = (plakalar: string[], ll: { lat: number; lng: number }) => {
      let best: { saat: string | null; hiz: number | null; tarih: string } | null = null, bestPk = plakalar[0] ?? "", bestD = Infinity;
      for (const pk of plakalar) for (const p of (hamNoktaByPlaka.get(plakaNorm(pk)) ?? [])) { const dx = p.lat - ll.lat, dy = p.lng - ll.lng, d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = p; bestPk = pk; } }
      const model = modelMap?.get(plakaNorm(bestPk)) || "";
      const hiz = best?.hiz != null ? `${Math.round(best.hiz)} km/s` : "—";
      const tarih = best?.tarih ? best.tarih.split("-").reverse().join(".") : "";
      const saat = best?.saat ? best.saat.slice(0, 8) : "";
      return `<b>${bestPk}</b>${model ? ` · ${model}` : ""}<br>Hız: ${hiz}<br>${tarih}${saat ? " " + saat : ""}`;
    };
    const yolTikla = (cizgi: ReturnType<typeof L.polyline>, plakalar: string[]) => cizgi.on("click", (e) => {
      const p = (e as unknown as { latlng: { lat: number; lng: number } }).latlng;
      cizgi.bindPopup(yolPopup(plakalar, p)).openPopup([p.lat, p.lng]);
    });
    // Altlı üstlü greyder çizgisi — YALNIZ Serme'de. Sıkıştırma'da greyder GÖSTERİLMEZ (sadece silindir güzergahı).
    // SERME: greyderin GÜN-GÜN, o günden ÖNCE damper dökülmüş yola denk gelen rotası — TEK ÇİZGİ (omurga).
    // (Aralıkta da doğru: 10.06'da damper, 15.06'da serme → yakalanır; taze reglaj → yakalanmaz.)
    if (sermeMi) sermeByPlaka.forEach((g) => {
      const renk = greyderRenkAl(g.plaka);
      for (const seg of g.parcalar) {
        // İKİ PARALEL ÇİZGİ (altlı üstlü) — serilen şeridi belli eder.
        const { ust, alt } = altUstParalel(seg, 6);
        yolTikla(L.polyline(ust, { color: renk, weight: sermeKal, opacity: 0.9, renderer: yolRenderer }).addTo(grup), [g.plaka]);
        yolTikla(L.polyline(alt, { color: renk, weight: sermeKal, opacity: 0.9, renderer: yolRenderer }).addTo(grup), [g.plaka]);
        for (const ll of seg) bounds.push(ll);
      }
    });
    if (sermeMi) {
      // YALNIZ SERİLMEMİŞ damperler — üzerinden greyder geçip serilen (işlenen) yığınların ikonu
      // KALDIRILIR (kullanıcı isteği: yol işlendiyse damper haritada durmasın). Serilen yol zaten
      // çift çizgiyle görünür; kalan turuncu noktalar = serilmeyi bekleyen döküm.
      sermeDamperleri.forEach((o, i) => {
        L.circleMarker([o.lat as number, o.lng as number], { radius: 6, color: "#ffffff", weight: 1.5, fillColor: DAMPER_RENK, fillOpacity: 0.95, renderer: yolRenderer })
          .addTo(grup).bindPopup(`<b>🔻 ${o.plaka}</b> · Damper ${i + 1} (serilmemiş)<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
        bounds.push([o.lat as number, o.lng as number]);
      });
    } else {
      // Silindir SIKIŞTIRMA hattı — YALNIZCA "Silindir Tekrar Eşiği" ile çizilir. Başka hiçbir tanıma bakılmaz:
      //   • serme yoluna kırpma YOK (damper/serme'den bağımsız), • transit-hız filtresi YOK (0 → her geçiş sayılır).
      // Tüm seçili silindirler TEK HAVUZDA birleşir → bir yol eşik kadar geçilmişse tek omurga (tek çizgi) çizilir.
      const silHavuz: { lat: number; lng: number; hiz?: number | null }[] = [];
      for (const k of secilenSilindirler) for (const p of (k.noktalar ?? [])) if (p.lat != null && p.lng != null) silHavuz.push({ lat: p.lat, lng: p.lng, hiz: p.hiz });
      const silPlakalar = secilenSilindirler.map((k) => k.plaka);
      parcalar(silHavuz, etkinSilindir, gridMesafe, 0).forEach((seg) => {
        yolTikla(L.polyline(seg, { color: silindirRenkV, weight: silindirKal, opacity: 0.9, renderer: yolRenderer }).addTo(grup), silPlakalar);
        for (const ll of seg) bounds.push(ll);
      });
    }
    // Canlı açıksa araç konumlarını da çerçeveye kat (rota verisi olmayan günde canlıya odaklan)
    for (const k of canliVeriRef.current.konumlar ?? []) {
      if (k.lat != null && k.lng != null) bounds.push([k.lat, k.lng]);
    }
    // Yalnızca İLK açılışta otomatik ortala; sonra mevcut görünümü KORU. (Harita sekme geçişinde/HMR'de
    // yarı-yıkılmış olabilir → fitBounds _leaflet_pos atabilir; sarıp yutuyoruz.)
    if (!gorunumRef.current && bounds.length) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
        const c = map.getCenter();
        gorunumRef.current = { merkez: [c.lat, c.lng], zoom: map.getZoom() };
      } catch { /* harita hazır değil/yıkılıyor → sessiz geç */ }
    }
  }, [haritaHazir, sermeByPlaka, sermeDamperleri, greyderRenkAl, hamNoktaByPlaka, modelMap, secilenSilindirler, silindirRenkAl, etkinTekrar, etkinSilindir, gridMesafe, transitHiz, sermeMi, sermeKal, silindirKal, reglajKal, sermeRenkV, silindirRenkV, reglajRenkV, gorunumRef]);

  async function exportKML() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Her makine KENDİ renginde: renge göre stil üret (tekrar etme).
    let stiller = "";
    const stilVar = new Set<string>();
    const stilEkle = (hex: string, tip: "line" | "icon") => {
      const sid = `${tip}_${hex.replace(/[^\w]/g, "")}`, c = kmlRenk(hex);
      if (!stilVar.has(sid)) {
        stiller += tip === "line"
          ? `<Style id="${sid}"><LineStyle><color>${c}</color><width>4</width></LineStyle></Style>`
          : `<Style id="${sid}"><IconStyle><color>${c}</color><scale>1.0</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`;
        stilVar.add(sid);
      }
      return sid;
    };
    const cizgiler = gosterilenGreyder.map((k) => {
      const n = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (n.length === 0) return "";
      const coords = n.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
      const sid = stilEkle(greyderRenkAl(k.plaka), "line");
      return `
    <Placemark><name>${esc(k.plaka)} ${esc(def.ad)}</name><styleUrl>#${sid}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
    }).join("");
    const orta = sermeMi
      ? sermeDamperleri.map((o, i) => { // haritayla aynı: yalnız serilmemiş damperler KML'e gider
          const sid = stilEkle(greyderRenkAl(o.plaka), "icon");
          return `
    <Placemark><name>${esc(o.plaka)} damper ${i + 1}</name><styleUrl>#${sid}</styleUrl><Point><coordinates>${(o.lng as number).toFixed(6)},${(o.lat as number).toFixed(6)},0</coordinates></Point></Placemark>`;
        }).join("")
      : silindirler.map((k) => {
          const n = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
          if (n.length === 0) return "";
          const coords = n.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},0`).join(" ");
          const sid = stilEkle(silindirRenkAl(k.plaka), "line");
          return `
    <Placemark><name>${esc(k.plaka)} silindir</name><styleUrl>#${sid}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
        }).join("");
    // Yüklü KML katmanları (referans) — ortak yardımcı
    const { stiller: ykStil, folder: ykFolder } = await yukluKatmanlarKml(katmanIzinliRef.current ?? undefined);
    stiller += ykStil;
    if (!cizgiler && !orta && !ykFolder) { toast.error("Veri yok.", { duration: toastSuresi() }); return; }
    const baslik = `${def.ad} ${bas === bitis ? bas : `${bas}_${bitis}`}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>${stiller}
    <Folder><name>${esc(def.ad)}</name>${cizgiler}${orta}</Folder>${ykFolder}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${def.ad} KML olarak indirildi.`, { duration: toastSuresi() });
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
  const veriYok = (sermeMi
    ? greyderler.length === 0 && damperGoster.length === 0
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
                    {/* PLAKA en üstte, model/cins hemen ALTINDA (ayrı satır) */}
                    <span className="font-semibold">{k.plaka}</span>
                    {(() => { const ik = modelGoster ? (modelMap?.get(plakaNorm(k.plaka)) || k.arac_sinifi) : k.arac_sinifi; return ik ? <span className="text-[10px] font-normal opacity-60">{ik}</span> : null; })()}
                    <span className="text-[10px] opacity-90" title={omurgaKmMap.get(k.plaka) != null ? "Yol uzunluğu — haritadaki tek çizgi (git-gel tekrarları sayılmaz)" : "Toplam kat edilen mesafe"}>
                      {omurgaKmMap.get(k.plaka) != null
                        ? `${omurgaKmMap.get(k.plaka)!.toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km yol`
                        : `${Math.round(k.toplam_mesafe ?? 0)} km`}
                    </span>
                    {/* SIRA: ilk kontak → kontak açık/rölanti → son kontak */}
                    {(() => { const e = ilkSonKontakMap?.get(plakaNorm(k.plaka)); return e?.ilk ? (
                      <span className={`text-[10px] text-emerald-600 ${e.ilkT ? "italic opacity-80" : ""}`} title={e.ilkT ? "GPS'ten türetildi — Arvento kontak vermedi (tahmini)" : undefined}>🟢 {e.ilkT ? "~" : ""}{e.ilk.slice(0, 5)} ilk kontak</span>
                    ) : null; })()}
                    {kontakRolantiMap && (() => {
                      const kr = kontakRolantiMap.get(plakaNorm(k.plaka));
                      return <span className="text-[10px] opacity-80">⏱ {formatSure(Math.max(kr?.kontak ?? 0, kr?.rolanti ?? 0))} çalışma</span>;
                    })()}
                    {(() => { const e = ilkSonKontakMap?.get(plakaNorm(k.plaka)); return e?.son ? (
                      <span className={`text-[10px] text-red-600 ${e.sonT ? "italic opacity-80" : ""}`} title={e.sonT ? "GPS'ten türetildi — Arvento kontak vermedi (tahmini)" : undefined}>🔴 {e.sonT ? "~" : ""}{e.son.slice(0, 5)} son kontak</span>
                    ) : null; })()}
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
                  ? <span><span className="font-semibold" style={{ color: sermeRenkV }}>🟰 {(sermeToplamKm * 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} m serme</span> <span className="text-orange-600 font-semibold" title="Haritada yalnız serilmemiş (üzerinden greyder geçmemiş) damperler gösterilir; serilenler kaldırılır.">· 🔻 {sermeDamperleri.length} serilmemiş damper (toplam {damperGoster.length})</span></span>
                  : <span><span className="font-semibold" style={{ color: silindirRenkV }}>🟰 {(sikistirmaToplamKm * 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} m sıkıştırma</span> <span style={{ color: silindirRenkV }} className="font-semibold">· ⩘ {secilenSilindirler.length} silindir hattı</span></span>}
              </div>
              {sermeMi && (
                <div className="text-[10px] text-gray-400 mt-0.5" title="Seçilen tarih aralığındaki greyder geçişleri gösterilir; aralık öncesinde damper dökülmüş yollar 'serme' sayılır. Aralık seçmezsen yalnız o gün.">
                  📅 Seçilen aralık · önceden damperli yollar serme sayılır
                </div>
              )}
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
