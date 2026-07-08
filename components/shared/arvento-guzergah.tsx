// Arvento Güzergah (Reglaj) sekmesi — "Mesafe Bilgisi" raporundan araçların
// günlük GPS noktalarını haritada rota çizgisi (polyline) olarak gösterir.
// Araçlar Stabilize'daki kamyonlar gibi yan yana renkli chip'ler olarak listelenir;
// tıklayarak çoklu seçim yapılır, her araç kendi renginde çizilir.
// TARİH SEÇİMİ YOK: tarih, sayfanın üstündeki ana tarihten (prop) gelir.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByRange, getArventoRaporByRange, oncekiDamperCek, plakaNorm } from "@/lib/supabase/queries/arvento";
import { atananSekmeleriHesapla, operasyondaGorunur, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import { sadelesGuzergah, kapsananYolKm, parcalarUzunlukKm, tsSaniye } from "@/lib/arvento/guzergah-sadelestir";
import { reglajRotalariniAyikla, type OncekiDamper } from "@/lib/arvento/serme-hesap";
import { ekleHaritaKatmanlari, ekleOlcumKontrolu, ekleKayitliKatmanlar, type KatmanIzin } from "@/lib/arvento/harita-katman";
import { canliKatmanKur, useCanliKatman, type CanliKonum, type CihazMap, type HaritaGorunum } from "@/lib/arvento/canli-katman";
import type { MutableRefObject, ReactNode } from "react";
import { usePasifSecim } from "@/lib/arvento/use-pasif-secim";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
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

export default function ArventoGuzergah({ bas, bitis, tekrarEsigi = 0, gridMesafe = 12, transitHiz = 20, kalinliklar, renkler, plakaFiltre, ekstraAraclar, calismaSnMap, kontakRolantiMap, ilkSonKontakMap, calismaNoktalari, canliKontakByPlaka, sekmeMap, canliKonumlar, canliCihazMap, gorunumRef: disGorunumRef, baslik = "Araçlar (Reglaj)", modelGoster = false, modelMap, izinliPlakalar, katmanIzinli, refreshKey = 0, sonGuncelleme, canliButton, kmlIndir = true, secimKey = "guzergah", tekrarPencereSaat = 0 }: { bas: string; bitis: string; tekrarEsigi?: number; tekrarPencereSaat?: number; gridMesafe?: number; transitHiz?: number; kalinliklar?: { reglaj?: number; serme?: number; silindir?: number }; renkler?: { reglaj?: string; serme?: string; silindir?: string }; plakaFiltre?: string[]; ekstraAraclar?: { plaka: string; arac_sinifi: string | null; toplam_mesafe: number | null; model?: string | null }[]; calismaSnMap?: Map<string, number>; kontakRolantiMap?: Map<string, { kontak: number; rolanti: number }>; ilkSonKontakMap?: Map<string, { ilk: string | null; son: string | null; ilkT?: boolean; sonT?: boolean }>; calismaNoktalari?: { plaka: string; rapor_tarihi: string; saat: string | null; lat: number; lng: number }[]; canliKontakByPlaka?: Map<string, boolean>; sekmeMap?: SekmeAtamaMap; canliKonumlar?: CanliKonum[]; canliCihazMap?: CihazMap; gorunumRef?: MutableRefObject<HaritaGorunum | null>; baslik?: string; modelGoster?: boolean; modelMap?: Map<string, string | null>; izinliPlakalar?: string[] | null; katmanIzinli?: KatmanIzin; refreshKey?: number; sonGuncelleme?: Date | null; canliButton?: ReactNode; kmlIndir?: boolean; secimKey?: string }) {
  const reglajKal = kalinliklar?.reglaj ?? 4;
  const reglajRenkV = renkler?.reglaj ?? "#2563eb"; // BİRLEŞİK reglaj omurgası tek renk (makine bazlı değil)
  const [kayitlar, setKayitlar] = useState<AracArventoGuzergah[]>([]);
  // Reglaj = greyder rotası EKSİ serme → serme noktalarını çıkarmak için damper verisi (aralık içi + öncesi).
  // Yalnız Reglaj sekmesinde (plakaFiltre yok) doldurulur; İş Makineleri haritasında boş kalır.
  const [damperVeri, setDamperVeri] = useState<{ raporlar: AracArventoRapor[]; oncekiDamper: OncekiDamper[] }>({ raporlar: [], oncekiDamper: [] });
  // PASİF (kullanıcının kapattığı) plakalar — gün değişince (parent remount etse bile) KORUNUR; F5'te sıfırlanır
  // (modül-seviyesi store). secimKey ile İş Makineleri ve Reglaj ayrı saklanır. Seçili = araçlar − pasif.
  const [pasifPlakalar, setPasifPlakalar] = usePasifSecim(`arvento-pasif-${secimKey}`);
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
  // Chip "🟢 çalışıyor" rozeti için kontak durumu. Parent HER ZAMAN güncel map geçerse (canliKontakByPlaka)
  // onu kullan (Canlı kapalı olsa da çalışır); geçmezse canliKonumlar'dan türet (yalnız Canlı açıkken dolu).
  const canliKontakTurev = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const k of (canliKonumlar ?? [])) {
      const p = k.node ? canliCihazMap?.get(k.node.trim())?.plaka : null;
      if (p && (k.kontak === true || (k.hiz ?? 0) > 3)) m.set(plakaNorm(p), true);
    }
    return m;
  }, [canliKonumlar, canliCihazMap]);
  const kontakDurum = canliKontakByPlaka ?? canliKontakTurev;
  const canliVeriRef = useRef<{ konumlar?: CanliKonum[]; cihazMap?: CihazMap }>({});
  canliVeriRef.current = { konumlar: canliFiltreli, cihazMap: canliCihazMap };
  const katmanIzinliRef = useRef(katmanIzinli); katmanIzinliRef.current = katmanIzinli; // KML izin filtresi (en güncel)
  useCanliKatman(canliLayerRef, canliFiltreli, canliCihazMap, kontakDurum, plakaNorm); // canlı katman + DÜZELTİLMİŞ "çalışıyor" durumu (nabız halkası/renk mola'da yanılmasın)
  const etkinTekrar = hamGoster ? 0 : tekrarEsigi;

  // Aralığın kayıtlarını yükle. Yükleme göstergesi yalnız TARİH değişiminde; periyodik tazelemede sessiz.
  const yapiRef = useRef("");
  const yukNoRef = useRef(0); // yükleme sıra no — ESKİ (geçersiz kılınmış) isteğin yanıtı yeni veriyi EZMESİN
  useEffect(() => {
    if (!bas || !bitis) { yukNoRef.current++; setKayitlar([]); setLoading(false); return; }
    const yapi = `${bas}|${bitis}`;
    const yapisal = yapiRef.current !== yapi;
    // Tarih değişti → ESKİ VERİYİ HEMEN TEMİZLE (yoksa yeni veri gelene kadar eski rakamlar görünür) + yükleniyor göster.
    if (yapisal) { yapiRef.current = yapi; setLoading(true); setKayitlar([]); }
    const benimNo = ++yukNoRef.current; // bu yüklemenin sırası; yanıt gelince hâlâ en güncel mi diye bakılır
    // HIZLANDIRMA: İş Makineleri haritası → yalnız plakaFiltre; Reglaj → yalnız greyder (rapordan, atamaya
    // saygılı). İlgisiz araçların (oto/kamyon/iş mak.) ağır GPS verisi indirilmez → 13,7 MB yerine ~0,6 MB.
    (async () => {
      try {
        let plakalar: string[] | null;
        if (plakaFiltre && plakaFiltre.length > 0) {
          plakalar = plakaFiltre; // İş Makineleri haritası → bu plakalar
          setDamperVeri({ raporlar: [], oncekiDamper: [] }); // bu haritada serme ayıklama yapılmaz
        } else {
          // Reglaj: rapor (damper_olaylar dahil, reglaj plakaları için) + aralık öncesi damperler paralel çekilir
          // → greyder rotasından serme noktalarını çıkarmak (reglaj = greyder EKSİ serme) için kullanılır.
          const [r, oncekiDamper] = await Promise.all([getArventoRaporByRange(bas, bitis), oncekiDamperCek(bas)]);
          if (benimNo !== yukNoRef.current) return;
          const atananSekmeler = atananSekmeleriHesapla(sekmeMap);
          plakalar = [...new Set((r as { plaka: string }[])
            .filter((x) => operasyondaGorunur(sekmeMap, atananSekmeler, null, "reglaj", x.plaka))
            .map((x) => x.plaka))];
          setDamperVeri({ raporlar: r, oncekiDamper });
        }
        const k = await getGuzergahByRange(bas, bitis, plakalar);
        if (benimNo === yukNoRef.current) setKayitlar(k);
      } catch (err) {
        if (benimNo !== yukNoRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist") || msg.includes("arac_arvento_guzergah")) {
          toast.error("arac_arvento_guzergah tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
        }
      } finally {
        if (benimNo === yukNoRef.current) setLoading(false);
      }
    })();
  }, [bas, bitis, refreshKey, plakaFiltre, sekmeMap]);

  // plakaFiltre verilmişse (İş Makineleri haritası) sadece o plakalar gösterilir.
  // ekstraAraclar: güzergahı OLMAYAN araçlar da chip olarak görünsün (rapordan; 0 km olsa da).
  // REGLAJ = greyder rotası EKSİ serme: Reglaj sekmesinde (plakaFiltre yok) greyderin SERME yaptığı
  // hücrelerdeki noktaları çıkarır → bir yol hem serme hem reglaj sayılmaz. Hem km (araclar) hem HARİTA
  // (hamNoktaByPlaka omurga havuzu) bunu kullanmalı; yoksa km düşer ama çizgi serme yolunu çizmeye devam eder.
  const kayitlarReglaj = useMemo<AracArventoGuzergah[]>(() => {
    if (plakaFiltre || (damperVeri.raporlar.length === 0 && damperVeri.oncekiDamper.length === 0)) return kayitlar;
    const atananSekmeler = atananSekmeleriHesapla(sekmeMap);
    return reglajRotalariniAyikla({ guzergahRows: kayitlar, raporlar: damperVeri.raporlar, oncekiDamper: damperVeri.oncekiDamper, sekmeMap, atananSekmeler });
  }, [kayitlar, plakaFiltre, damperVeri, sekmeMap]);

  const araclar = useMemo<GuzergahArac[]>(() => {
    // plakaFiltre (İş Makineleri haritası) verildiyse o liste kesin; verilmediyse Reglaj sekmesidir:
    // atama VARSA yalnız "reglaj" atanmışlar; atama YOKSA mevcut davranış (tüm güzergahlar).
    const atananSekmeler = atananSekmeleriHesapla(sekmeMap);
    const guzergahliHam: GuzergahArac[] = plakaFiltre
      ? kayitlarReglaj.filter((k) => new Set(plakaFiltre.map(plakaNorm)).has(plakaNorm(k.plaka)))
      : kayitlarReglaj.filter((k) => {
          const atama = sekmeMap?.get(plakaNorm(k.plaka));
          // Atama varsa kesin; yoksa "reglaj"a başka araç atanmışsa gizle, değilse tüm güzergahlar.
          return atama ? atama.includes("reglaj") : !atananSekmeler.has("reglaj");
        });
    // ÇOKLU-GÜN ARALIĞI: aynı plakanın günlük rotalarını TEK kayıtta BİRLEŞTİR (noktaları gün sırasıyla
    // ekle, km'leri topla). Böylece omurga/çizim/kart plaka başına TEK olur; aralıkta üst üste çizmez ve
    // omurga (sadelesGuzergah) tüm günlerin tekrar taranan yollarını TEK ÇİZGİ olarak kapsar. Önceden her
    // gün ayrı işleniyor, omurga map'i plaka anahtarıyla yalnız SON günü tutuyordu → çoklu-günde saçmalıyordu.
    const sirali = [...guzergahliHam].sort((a, b) =>
      String((a as AracArventoGuzergah).rapor_tarihi ?? "").localeCompare(String((b as AracArventoGuzergah).rapor_tarihi ?? "")));
    const birlesikMap = new Map<string, GuzergahArac>();
    for (const k of sirali) {
      const key = plakaNorm(k.plaka);
      const ex = birlesikMap.get(key);
      if (!ex) birlesikMap.set(key, { ...k, noktalar: [...(k.noktalar ?? [])] });
      else {
        ex.noktalar = [...(ex.noktalar ?? []), ...(k.noktalar ?? [])];
        ex.toplam_mesafe = (ex.toplam_mesafe ?? 0) + (k.toplam_mesafe ?? 0);
        ex.arac_sinifi = ex.arac_sinifi ?? k.arac_sinifi;
        ex.marka = ex.marka ?? k.marka;
        ex.model = ex.model ?? k.model;
      }
    }
    const guzergahli = Array.from(birlesikMap.values());
    const varPlaka = new Set(guzergahli.map((k) => plakaNorm(k.plaka)));
    const ekstra: GuzergahArac[] = (ekstraAraclar ?? [])
      .filter((e) => !varPlaka.has(plakaNorm(e.plaka)))
      .map((e) => ({ plaka: e.plaka, arac_sinifi: e.arac_sinifi, toplam_mesafe: e.toplam_mesafe, model: e.model ?? null }));
    const tum = ekstra.length ? [...guzergahli, ...ekstra] : guzergahli;
    if (!izinliPlakalar) return tum; // yönetici/izin yok → hepsi
    const izin = new Set(izinliPlakalar.map(plakaNorm));
    return tum.filter((k) => izin.has(plakaNorm(k.plaka)));
  }, [kayitlarReglaj, plakaFiltre, ekstraAraclar, sekmeMap, izinliPlakalar]);

  // Her SADELEŞTİRİLMİŞ TEK ÇİZGİNİN (omurga parçası) AYRI uzunluğu (km, büyükten küçüğe). Haritada
  // çizilen çizgilerle birebir: git-gel tekrarları sayılmaz. Eşik<1 (ham) ise parça yok → boş.
  const parcaUzunlukMap = useMemo(() => {
    const m = new Map<string, number[]>();
    if (etkinTekrar < 1) return m;
    for (const k of araclar) {
      const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length < 2) continue;
      const uz = sadelesGuzergah(noktalar, etkinTekrar, gridMesafe, transitHiz).parcalar
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

  // Yol tıklandığında popup için HAM noktalar (saat + hız + tarih) — plaka bazında. Omurga birleşik/tek çizgi
  // olduğu için tek değer taşımaz; tıklanan konuma EN YAKIN ham nokta gösterilir → plaka/model/hız/tarih/saat.
  const hamNoktaByPlaka = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; saat: string | null; hiz: number | null; tarih: string; plaka: string }[]>();
    // kayitlarReglaj: serme noktaları çıkarılmış → çizilen omurga havuzu da serme yolunu içermez (map ile km tutar).
    for (const row of kayitlarReglaj) {
      const pk = plakaNorm(row.plaka);
      let arr = m.get(pk); if (!arr) { arr = []; m.set(pk, arr); }
      for (const p of (row.noktalar ?? [])) {
        if (p.lat != null && p.lng != null) arr.push({ lat: p.lat, lng: p.lng, saat: p.saat, hiz: p.hiz, tarih: row.rapor_tarihi, plaka: row.plaka });
      }
    }
    return m;
  }, [kayitlarReglaj]);

  // Seçili = mevcut araçlardan PASİF olmayanlar. Varsayılan hepsi açık; kullanıcı kapatınca pasife eklenir →
  // gün değişse de pasif korunur (yeni araçlar otomatik açık gelir, kapatılanlar kapalı kalır).
  const seciliPlakalar = useMemo(() => new Set(araclar.map((k) => k.plaka).filter((p) => !pasifPlakalar.has(p))), [araclar, pasifPlakalar]);

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

  const toggle = (p: string) => setPasifPlakalar((s) => { // pasife ekle/çıkar (gün değişse de korunur)
    const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n;
  });
  const secilenler = useMemo(() => araclar.filter((k) => seciliPlakalar.has(k.plaka)), [araclar, seciliPlakalar]);

  const ozet = useMemo(() => {
    // toplamKm = omurga (tek çizgi) uzunlukları; omurga yoksa ham toplam_mesafe'ye düş.
    const toplamKm = secilenler.reduce((s, k) => s + (omurgaKmMap.get(k.plaka) ?? k.toplam_mesafe ?? 0), 0);
    const toplamNokta = secilenler.reduce((s, k) => s + (k.noktalar?.length ?? 0), 0);
    // Toplam çalışma (sn) — yalnız İş Makineleri'nde (calismaSnMap verilir): seçili makinelerin çalışma süreleri toplamı.
    const toplamCalismaSn = calismaSnMap ? secilenler.reduce((s, k) => s + (calismaSnMap.get(plakaNorm(k.plaka)) ?? 0), 0) : 0;
    return { arac: secilenler.length, toplamKm, toplamNokta, toplamCalismaSn };
  }, [secilenler, omurgaKmMap, calismaSnMap]);

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
      if (iptal || !map) return;
      // NOT: KML pane'i (350) yükseltilmez → güzergah çizgileri (SVG yolPane 450) KML'nin ÜSTÜNDE görünür.
      // SVG katmanı boş yerlerde tıklamayı alttaki KML'ye geçirdiği için KML yine tıklanabilir kalır.
      veriKatmanRef.current = L.layerGroup().addTo(map);
      canliLayerRef.current = canliKatmanKur(L, map, canliVeriRef.current.konumlar, canliVeriRef.current.cihazMap, kontakDurum, plakaNorm);
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
    // YOL çizgilerini SVG renderer ile çiz (canvas değil): DOM <path> = KESİN tıklanır + SVG'nin BOŞ alanları
    // tıklamayı ALTTAKİ KML'ye geçirir (canvas geçirmiyordu). overlayPane (z 400) KML pane'inin (350) ÜSTÜNDE
    // → güzergah çizgileri KML'nin ÜZERİNDE görünür; özel pane geçiş yapmadığı için STANDART overlayPane kullanılır.
    const yolRenderer = L.svg();
    const tumBounds: [number, number][] = [];
    const tekMi = secilenler.length === 1;
    // Yol tıklama popup'ı: verilen plakalar arasında tıklanan konuma EN YAKIN ham noktayı bul → plaka·model / hız / tarih saat.
    const icerikYap = (ll: { lat: number; lng: number }, plakalar: string[]) => {
      let best: { saat: string | null; hiz: number | null; tarih: string; plaka: string } | null = null, bestD = Infinity;
      for (const pk of plakalar) for (const p of (hamNoktaByPlaka.get(pk) ?? [])) {
        const dx = p.lat - ll.lat, dy = p.lng - ll.lng, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return "";
      const model = (modelMap?.get(plakaNorm(best.plaka)) || "");
      const hiz = best.hiz != null ? `${Math.round(best.hiz)} km/s` : "—";
      const tarih = best.tarih ? best.tarih.split("-").reverse().join(".") : "";
      const saat = best.saat ? best.saat.slice(0, 8) : "";
      return `<b>${best.plaka}</b>${model ? ` · ${model}` : ""}<br>Hız: ${hiz}<br>${tarih}${saat ? " " + saat : ""}`;
    };
    const tiklaBagla = (cizgi: ReturnType<typeof L.polyline>, plakalar: string[]) => cizgi.on("click", (e) => {
      const p = (e as unknown as { latlng: { lat: number; lng: number } }).latlng;
      cizgi.bindPopup(icerikYap(p, plakalar)).openPopup([p.lat, p.lng]);
    });
    if (etkinTekrar >= 1) {
      // ── BİRLEŞİK REGLAJ OMURGASI ──
      // Tüm seçili greyderlerin (tüm günler) noktaları TEK havuzda birleşir → tek omurga çıkarılır.
      // Makine fark etmez: bir yolda TOPLAM geçiş (hangi greyder olursa olsun) ≥ eşik ise tek çizgiye iner.
      // Aynı yolu farklı greyderler taramış olabilir; reglaj birleşik sayılır. Tek renk (reglajRenkV).
      // HAM (per-gün) noktalar → her nokta kendi TARİH+SAAT'ini taşır (ts). "Tekrar süresi" penceresi bunları
      // kullanır; merged araclar.noktalar tarihi kaybettiği için ham kaynaktan (hamNoktaByPlaka) kurulur.
      const havuz: { lat: number; lng: number; hiz?: number | null; ts?: number | null }[] = [];
      for (const kayit of secilenler) {
        for (const p of (hamNoktaByPlaka.get(plakaNorm(kayit.plaka)) ?? [])) {
          havuz.push({ lat: p.lat, lng: p.lng, hiz: p.hiz, ts: tsSaniye(p.tarih, p.saat) }); tumBounds.push([p.lat, p.lng]);
        }
      }
      const cizgiler = sadelesGuzergah(havuz, etkinTekrar, gridMesafe, transitHiz, tekrarPencereSaat * 3600).parcalar;
      const seciliPlakaList = secilenler.map((k) => plakaNorm(k.plaka)); // popup EN YAKIN ham noktayı bu plakalarda arar
      for (const parca of cizgiler) {
        // Popup: tıklanan konuma en yakın ham nokta → plaka·model / hız / tarih saat (km & nokta gösterilmez).
        const cizgi = L.polyline(parca, { color: reglajRenkV, weight: reglajKal, opacity: 0.9, renderer: yolRenderer }).addTo(grup);
        tiklaBagla(cizgi, seciliPlakaList);
        cizgi.on("popupopen", () => cizgi.setStyle({ weight: reglajKal + 3, opacity: 1 }));
        cizgi.on("popupclose", () => cizgi.setStyle({ weight: reglajKal, opacity: 0.9 }));
      }
      // else: omurga yok (hiçbir yol eşik kadar taranmamış) → çizgi yok.
    } else {
      // ── HAM MOD (eşik < 1): her aracın izini AYRI çiz (kendi renginde) ──
      for (const kayit of secilenler) {
        const noktalar = (kayit.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) continue;
        const renk = renkAl(kayit.plaka);
        // Popup: tıklanan konuma en yakın ham nokta → plaka·model / hız / tarih saat (km & nokta gösterilmez).
        const cizgi = L.polyline(latlngs, { color: renk, weight: reglajKal, opacity: 0.85, renderer: yolRenderer }).addTo(grup);
        tiklaBagla(cizgi, [plakaNorm(kayit.plaka)]);
        cizgi.on("popupopen", () => cizgi.setStyle({ weight: reglajKal + 3, opacity: 1 }));
        cizgi.on("popupclose", () => cizgi.setStyle({ weight: reglajKal, opacity: 0.85 }));
        if (tekMi) {
          for (const p of noktalar) {
            L.circleMarker([p.lat, p.lng], { radius: 3, color: renk, fillColor: renk, fillOpacity: 0.6, weight: 1 })
              .addTo(grup).bindPopup(`${p.saat ?? ""}<br>Hız: ${p.hiz ?? "—"} km/s`);
          }
          const ilk = latlngs[0], son = latlngs[latlngs.length - 1];
          L.circleMarker(ilk, { radius: 8, color: "#15803d", fillColor: "#22c55e", fillOpacity: 0.9, weight: 2 })
            .addTo(grup).bindPopup(`<b>BAŞLANGIÇ</b><br>${noktalar[0].saat ?? ""}`);
          L.circleMarker(son, { radius: 8, color: "#991b1b", fillColor: "#ef4444", fillOpacity: 0.9, weight: 2 })
            .addTo(grup).bindPopup(`<b>BİTİŞ</b><br>${noktalar[noktalar.length - 1].saat ?? ""}`);
        }
        for (const ll of latlngs) tumBounds.push(ll);
      }
    }
    // ── EKSKAVATÖR ÇALIŞMA NOKTALARI — yerinde çalışan makinenin geçmişte çalıştığı yerler. Canlı DURUM
    // noktalarıyla (dolu mavi/kırmızı/yeşil) karışmasın diye İÇİ BOŞ HALKA (makine rengi kenar, saydam iç) →
    // "burada çalıştı" izi olduğu net olur, "şu an açık/kapalı" durumu değil. Bkz. makine_calisma_noktasi. ──
    for (const n of calismaNoktalari ?? []) {
      if (n.lat == null || n.lng == null) continue;
      const renk = renkAl(n.plaka);
      const tarih = n.rapor_tarihi ? n.rapor_tarihi.split("-").reverse().join(".") : "";
      L.circleMarker([n.lat, n.lng], { radius: 5, color: renk, weight: 2, fillColor: renk, fillOpacity: 0.15, renderer: yolRenderer })
        .addTo(grup).bindPopup(`<b>🛠️ ${n.plaka}</b> · çalışma noktası (burada çalıştı)<br>${tarih}${n.saat ? " " + String(n.saat).slice(0, 5) : ""}`);
      tumBounds.push([n.lat, n.lng]);
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
  }, [haritaHazir, secilenler, etkinTekrar, gridMesafe, transitHiz, tekrarPencereSaat, reglajKal, reglajRenkV, renkAl, hamNoktaByPlaka, modelMap, gorunumRef, calismaNoktalari]);

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
                  {/* PLAKA en üstte, model/cins hemen ALTINDA (ayrı satır). Kontak açıksa plakanın SOLUNDA yeşil nabız rozeti. */}
                  <span className="font-semibold flex items-center gap-1.5">
                    {kontakDurum.get(plakaNorm(k.plaka)) && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" title="Kontağı açık — şu an çalışıyor" />}
                    {k.plaka}
                  </span>
                  {(() => { const ik = modelGoster ? (modelMap?.get(plakaNorm(k.plaka)) || k.model || k.arac_sinifi) : k.arac_sinifi; return ik ? <span className="text-[10px] font-normal opacity-60">{ik}</span> : null; })()}
                  {/* "km yol" satırı — İş Makineleri'nde gizli (makineler km değil saat bazlı). Nokta sayısı gösterilmez. */}
                  {baslik !== "İş Makineleri" && (
                    <span className="text-[10px] opacity-90" title={omurgaKm != null ? "Yol uzunluğu — haritadaki tek çizgi (git-gel tekrarları sayılmaz)" : "Toplam kat edilen mesafe"}>
                      {omurgaKm != null
                        ? `${omurgaKm.toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km yol`
                        : `${Math.round(k.toplam_mesafe ?? 0)} km`}
                    </span>
                  )}
                  {/* SIRA: ilk kontak → çalışma → (kontak açık/rölanti) → son kontak */}
                  {(() => { const e = ilkSonKontakMap?.get(plakaNorm(k.plaka)); return e?.ilk ? (
                    <span className={`text-[10px] text-emerald-600 ${e.ilkT ? "italic opacity-80" : ""}`} title={e.ilkT ? "GPS'ten türetildi — Arvento kontak vermedi (tahmini)" : undefined}>🟢 {e.ilkT ? "~" : ""}{e.ilk.slice(0, 5)} ilk kontak</span>
                  ) : null; })()}
                  {(calismaSnMap || kontakRolantiMap) && (() => {
                    // Çalışma = İş Makineleri'nde hazır hesap (calismaSnMap), diğerlerinde max(kontak, rölanti).
                    let cal = calismaSnMap
                      ? (calismaSnMap.get(plakaNorm(k.plaka)) ?? 0)
                      : (() => { const kr = kontakRolantiMap!.get(plakaNorm(k.plaka)); return Math.max(kr?.kontak ?? 0, kr?.rolanti ?? 0); })();
                    // İlk→son penceresine kırpma YALNIZ ham (kontakRolantiMap) durumunda: Arvento kontak_sn/rolanti_sn
                    // rapor birikiminden şişebiliyor (ör. 3 saatlik pencerede 16 saat). calismaSnMap ise ZATEN gün-gün
                    // kırpılıp toplandı → tekrar kırpma YOK (aksi halde çok-günlük toplam tek-günlük ~24h pencereye kısılır).
                    const e = ilkSonKontakMap?.get(plakaNorm(k.plaka));
                    if (!calismaSnMap && e?.ilk && e?.son) {
                      const sn = (t: string) => { const p = t.split(":").map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); };
                      const span = sn(e.son) - sn(e.ilk);
                      if (span > 0) cal = Math.min(cal, span);
                    }
                    return <span className="text-[10px] opacity-80">⏱ {formatSure(cal)} çalışma</span>;
                  })()}
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
              {calismaSnMap && (
                <div className="text-[11px] mt-0.5">⏱ Toplam çalışma: <strong className="text-[#1E3A5F]">{formatSure(ozet.toplamCalismaSn)}</strong></div>
              )}
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
