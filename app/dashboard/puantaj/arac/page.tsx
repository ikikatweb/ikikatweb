// Araç Puantaj sayfası - Aylık takvim ile şantiye bazlı araç puantajı
// Bir araç bir günde sadece 1 şantiyede puantajlanabilir, 6 farklı durum desteklenir
"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { getAraclar, updateArac } from "@/lib/supabase/queries/araclar";
import { getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import {
  getAracPuantajByAySantiye,
  getAracPuantajByRange,
  getAracPuantajCakisma,
  getDigerSantiyeCakismalari,
  upsertAracPuantaj,
  deleteAracPuantaj,
} from "@/lib/supabase/queries/arac-puantaj";
import {
  getAracKiraBedelleri,
  upsertAracKiraBedeli,
  updateAracKiraBedeli,
  deleteAracKiraBedeli,
  getAracOzetOverridesByRange,
  upsertAracOzetOverride,
} from "@/lib/supabase/queries/arac-ozet";
import { useAuth } from "@/hooks";
import type {
  AracWithRelations, AracPuantaj, AracPuantajDurum,
  AracKiraBedeli, AracPuantajOverride,
} from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ClipboardList, FileDown, FileSpreadsheet, ChevronLeft, ChevronRight,
  ChevronUp, ChevronDown,
  Check, Wrench, UserX, Sun, X as XIcon, Trash2, Plus,
  ArrowRight, ArrowLeft as ArrowLeftIcon, Link2, Link2Off, Lock,
  FileBarChart, Pencil,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import AracForm from "@/components/shared/arac-form";
import toast from "react-hot-toast";
import { tarihIzinliMi } from "@/lib/utils/tarih-izin";
import { filtreliSantiyeler, otomatikSantiyeId } from "@/lib/utils/santiye-filtre";

type SantiyeBasic = { id: string; is_adi: string; durum: string; gecici_kabul_tarihi?: string | null; tasfiye_tarihi?: string | null; devir_tarihi?: string | null };

// Özet Rapor satırları: her araç için, tarih aralığı içindeki her farklı kira tarife
// dönemi ayrı satır olarak döner. Birden fazla tarife varsa araç o kadar satırla gösterilir.
type OzetSatir = {
  key: string;
  arac: AracWithRelations;
  donemBaslangic: string; // YYYY-MM-DD dahil
  donemBitis: string;     // YYYY-MM-DD dahil
  aylikBedel: number | null; // null ise hiç tarife yok
  sayilar: Record<AracPuantajDurum, number>;        // UI'de gösterilen (override varsa override)
  orijinalSayilar: Record<AracPuantajDurum, number>; // Gerçek puantajdan hesaplanan
  override: AracPuantajOverride | null;
  duzenlenebilir: boolean; // Tek ay + tek tarife mi?
  toplamGun: number; // calisti + yarim_gun * 0.5 (override uygulandıktan sonra)
  toplamKira: number;
  donemSayisi: number; // bu araç için üretilen toplam satır sayısı (ilk satırda rowspan için)
  donemIndex: number;  // 0-based
};

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

const AY_ADLARI = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const GUN_KISA = ["Pzr", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

// Durum -> görünüm bilgileri
// pdfShort: jsPDF helvetica fontunda render olabilir ASCII/Latin-1 karakter
// pdfRGB: PDF'te hücre arka planı için RGB
type DurumBilgi = {
  kod: AracPuantajDurum;
  label: string;
  bgClass: string;
  textClass: string;
  pdfShort: string;
  pdfRGB: [number, number, number];
  aciklamaZorunlu: boolean;
  IconComponent: React.ComponentType<{ size?: number; className?: string }>;
};

const DURUM_LISTESI: DurumBilgi[] = [
  { kod: "calisti",      label: "Çalıştı",      bgClass: "bg-emerald-500", textClass: "text-emerald-700", pdfShort: "+",  pdfRGB: [16, 185, 129],  aciklamaZorunlu: false, IconComponent: Check },
  { kod: "yarim_gun",    label: "Yarım Gün",    bgClass: "bg-amber-500",   textClass: "text-amber-700",   pdfShort: "½",  pdfRGB: [245, 158, 11],  aciklamaZorunlu: false, IconComponent: () => <span className="font-bold">½</span> },
  { kod: "calismadi",    label: "Çalışmadı",    bgClass: "bg-red-500",     textClass: "text-red-700",     pdfShort: "-",  pdfRGB: [239, 68, 68],   aciklamaZorunlu: true,  IconComponent: XIcon },
  { kod: "arizali",      label: "Arızalı",      bgClass: "bg-purple-500",  textClass: "text-purple-700",  pdfShort: "A",  pdfRGB: [168, 85, 247],  aciklamaZorunlu: true,  IconComponent: Wrench },
  { kod: "operator_yok", label: "Operatör Yok", bgClass: "bg-slate-500",   textClass: "text-slate-700",   pdfShort: "O",  pdfRGB: [100, 116, 139], aciklamaZorunlu: true,  IconComponent: UserX },
  { kod: "tatil",        label: "Tatil",        bgClass: "bg-cyan-500",    textClass: "text-cyan-700",    pdfShort: "T",  pdfRGB: [6, 182, 212],   aciklamaZorunlu: false, IconComponent: Sun },
];

const DURUM_MAP = new Map<AracPuantajDurum, DurumBilgi>(DURUM_LISTESI.map((d) => [d.kod, d]));
const PDF_RGB_MAP = new Map<string, [number, number, number]>(DURUM_LISTESI.map((d) => [d.pdfShort, d.pdfRGB]));

function gunSayisi(yil: number, ay: number): number {
  return new Date(yil, ay, 0).getDate();
}

function tarihStr(yil: number, ay: number, gun: number): string {
  return `${yil}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}`;
}

function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}

export default function AracPuantajPage() {
  const { kullanici } = useAuth();

  const bugun = new Date();
  const [yil, setYil] = useState(bugun.getFullYear());
  const [ay, setAy] = useState(bugun.getMonth() + 1); // 1-12

  // Özet Rapor için ayrı tarih aralığı (ayın 1'i - ayın sonu varsayılan)
  // Not: toISOString() UTC'ye çevirdiği için Türkiye saat dilimiyle 1 gün kayması yaşanıyordu,
  // bu yüzden yerel tarih bileşenleriyle string oluşturuyoruz.
  const [ozetBaslangic, setOzetBaslangic] = useState(() => {
    const y = bugun.getFullYear();
    const m = bugun.getMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}-01`;
  });
  const [ozetBitis, setOzetBitis] = useState(() => {
    const y = bugun.getFullYear();
    const m = bugun.getMonth() + 1;
    const son = gunSayisi(y, m);
    return `${y}-${String(m).padStart(2, "0")}-${String(son).padStart(2, "0")}`;
  });

  // Aktif tab - PDF/Excel butonları ve çıkış bu değere göre değişir
  const [aktifTab, setAktifTab] = useState<"puantaj" | "atama" | "ozet">("puantaj");

  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [santiyeId, setSantiyeId] = useState("");
  const [puantajlar, setPuantajlar] = useState<AracPuantaj[]>([]);
  // Diğer şantiye çakışmaları: arac_id -> (gün -> { santiye_id, santiye_adi })
  const [digerCakismalar, setDigerCakismalar] = useState<
    Map<string, Map<number, { santiye_id: string; santiye_adi: string }>>
  >(new Map());
  const [loading, setLoading] = useState(true);

  // Hücre tıklama dialog state'i
  const [hucreDialogOpen, setHucreDialogOpen] = useState(false);
  const [seciliArac, setSeciliArac] = useState<AracWithRelations | null>(null);
  const [seciliGun, setSeciliGun] = useState<number | null>(null);
  const [seciliDurum, setSeciliDurum] = useState<AracPuantajDurum | null>(null);
  const [seciliAciklama, setSeciliAciklama] = useState("");
  const [dialogKaydediliyor, setDialogKaydediliyor] = useState(false);
  const aciklamaRef = useRef<HTMLTextAreaElement>(null);

  // Custom tooltip (tüm puantajlı hücreler için - notu olsun/olmasın fark etmez)
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    plaka: string;
    isleyenAd: string;
    durum: AracPuantajDurum;
    aciklama: string | null;
  } | null>(null);

  // Kiralık araç ekleme dialog
  const [kiralikDialogOpen, setKiralikDialogOpen] = useState(false);

  // Atama sekmesi için: hangi araç üzerinde işlem yapılıyor (loader)
  const [atamaYuklenenId, setAtamaYuklenenId] = useState<string | null>(null);

  // Özet Rapor state'leri
  const [kiraMap, setKiraMap] = useState<Map<string, AracKiraBedeli[]>>(new Map());
  // Tarih aralığındaki gerçek puantaj kayıtları
  const [ozetRangePuantajlar, setOzetRangePuantajlar] = useState<AracPuantaj[]>([]);
  // Kira düzenleme modal
  const [kiraDialogOpen, setKiraDialogOpen] = useState(false);
  const [kiraDialogArac, setKiraDialogArac] = useState<AracWithRelations | null>(null);
  const [kiraDialogBedel, setKiraDialogBedel] = useState("");
  const [kiraDialogTarih, setKiraDialogTarih] = useState("");
  const [kiraDialogLoading, setKiraDialogLoading] = useState(false);
  // Kira geçmişi açık/kapalı
  const [kiraGecmisAcik, setKiraGecmisAcik] = useState(false);
  // Geçmişte inline düzenleme
  const [kiraEditId, setKiraEditId] = useState<string | null>(null);
  const [kiraEditBedel, setKiraEditBedel] = useState("");
  const [kiraEditTarih, setKiraEditTarih] = useState("");
  // Silme onayı
  const [kiraSilId, setKiraSilId] = useState<string | null>(null);

  // Özet durum sayıları override state
  const [ozetOverridesMap, setOzetOverridesMap] = useState<Map<string, AracPuantajOverride[]>>(new Map());
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideDialogSatir, setOverrideDialogSatir] = useState<OzetSatir | null>(null);
  const [overrideDialogDurum, setOverrideDialogDurum] = useState<AracPuantajDurum | null>(null);
  const [overrideDialogDeger, setOverrideDialogDeger] = useState("");
  const [overrideDialogLoading, setOverrideDialogLoading] = useState(false);

  // Atama işlemleri
  async function handleAta(aracId: string) {
    if (!santiyeId) {
      toast.error("Önce bir şantiye seçin.");
      return;
    }
    setAtamaYuklenenId(aracId);
    try {
      await updateArac(aracId, { santiye_id: santiyeId });
      await loadAraclar();
      toast.success("Araç şantiyeye atandı.");
    } catch {
      toast.error("Atama sırasında hata oluştu.");
    } finally {
      setAtamaYuklenenId(null);
    }
  }

  async function handleCikar(aracId: string) {
    setAtamaYuklenenId(aracId);
    try {
      await updateArac(aracId, { santiye_id: null });
      await loadAraclar();
      toast.success("Araç şantiyeden çıkarıldı.");
    } catch {
      toast.error("Çıkarma sırasında hata oluştu.");
    } finally {
      setAtamaYuklenenId(null);
    }
  }

  // Atama tab için: boştaki ve şantiyedeki araçlar
  const atamaBostakiler = useMemo(() => {
    return araclar
      .filter((a) => (a.durum ?? "aktif") === "aktif")
      .filter((a) => a.santiye_id !== santiyeId) // null veya başka şantiye
      .sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));
  }, [araclar, santiyeId]);

  const atamaSantiyedeki = useMemo(() => {
    return araclar
      .filter((a) => (a.durum ?? "aktif") === "aktif")
      .filter((a) => a.santiye_id === santiyeId && santiyeId)
      .sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));
  }, [araclar, santiyeId]);

  // Araçları yeniden yükle (yeni kiralık eklendikten sonra)
  const loadAraclar = useCallback(async () => {
    try {
      const aData = await getAraclar();
      setAraclar((aData as AracWithRelations[]) ?? []);
    } catch { /* sessiz */ }
  }, []);

  // İlk yükleme
  useEffect(() => {
    async function init() {
      try {
        const [aData, sData] = await Promise.all([
          getAraclar(),
          getSantiyelerAll(),
        ]);
        setAraclar((aData as AracWithRelations[]) ?? []);
        const sList = ((sData as SantiyeBasic[]) ?? []).filter((s) => s.durum === "aktif");
        setSantiyeler(sList);
        // Kısıtlı kullanıcı tek şantiye atandıysa otomatik seç
        const otoId = otomatikSantiyeId(sList, kullanici);
        if (otoId) setSantiyeId(otoId);
      } catch { toast.error("Veriler yüklenirken hata oluştu."); }
      finally { setLoading(false); }
    }
    init();
  }, []);

  // Şantiye/ay değişince puantajları yükle + diğer şantiye çakışmalarını yükle
  const loadPuantajlar = useCallback(async () => {
    if (!santiyeId) {
      setPuantajlar([]);
      setDigerCakismalar(new Map());
      return;
    }
    try {
      const data = await getAracPuantajByAySantiye(santiyeId, yil, ay);
      setPuantajlar(data);

      // TÜM diğer şantiye çakışmalarını getir (filtresiz).
      // Bu race condition ve stale state sorunlarını engeller -
      // UI'da gösterilen araç listesine bakılmaksızın tüm çakışmalar yüklenir.
      const cakismalar = await getDigerSantiyeCakismalari(null, yil, ay, santiyeId);
      const m = new Map<string, Map<number, { santiye_id: string; santiye_adi: string }>>();
      for (const c of cakismalar) {
        const gun = parseInt(c.tarih.slice(8, 10), 10);
        if (!m.has(c.arac_id)) m.set(c.arac_id, new Map());
        m.get(c.arac_id)!.set(gun, { santiye_id: c.santiye_id, santiye_adi: c.santiye_adi });
      }
      setDigerCakismalar(m);
    } catch { toast.error("Puantaj verileri yüklenirken hata oluştu."); }
  }, [santiyeId, yil, ay]);

  useEffect(() => { loadPuantajlar(); }, [loadPuantajlar]);

  // Özet Rapor verilerini yükle (şantiye + tarih aralığı + araçlar değişince)
  const loadOzet = useCallback(async () => {
    if (!santiyeId) {
      setKiraMap(new Map());
      setOzetRangePuantajlar([]);
      return;
    }
    // Bu şantiyede gösterilecek araçların id listesi
    const idList = araclar
      .filter((a) => (a.durum ?? "aktif") === "aktif" && a.santiye_id === santiyeId)
      .map((a) => a.id);

    // Kira bedelleri
    try {
      const kira = await getAracKiraBedelleri(idList);
      setKiraMap(kira);
    } catch (err) {
      console.error("getAracKiraBedelleri hatası:", err);
      setKiraMap(new Map());
    }

    // Tarih aralığındaki gerçek puantajlar
    try {
      // bitis tarihini "bitis+1" yap çünkü SQL .lt kullanıyor
      // UTC kayma bug'ını önlemek için yerel bileşenlerle hesapla
      const by = parseInt(ozetBitis.slice(0, 4), 10);
      const bm = parseInt(ozetBitis.slice(5, 7), 10);
      const bd = parseInt(ozetBitis.slice(8, 10), 10);
      const ertesiGun = new Date(by, bm - 1, bd + 1);
      const ey = ertesiGun.getFullYear();
      const em = ertesiGun.getMonth() + 1;
      const ed = ertesiGun.getDate();
      const bitisExclusive = `${ey}-${String(em).padStart(2, "0")}-${String(ed).padStart(2, "0")}`;
      const rangePuantajlar = await getAracPuantajByRange(santiyeId, ozetBaslangic, bitisExclusive);
      setOzetRangePuantajlar(rangePuantajlar);
    } catch (err) {
      console.error("getAracPuantajByRange hatası:", err);
      setOzetRangePuantajlar([]);
    }

    // Tarih aralığındaki override'lar
    try {
      const by = parseInt(ozetBaslangic.slice(0, 4), 10);
      const bm = parseInt(ozetBaslangic.slice(5, 7), 10);
      const ey = parseInt(ozetBitis.slice(0, 4), 10);
      const em = parseInt(ozetBitis.slice(5, 7), 10);
      const overridesMap = await getAracOzetOverridesByRange(santiyeId, by, bm, ey, em);
      setOzetOverridesMap(overridesMap);
    } catch (err) {
      console.error("getAracOzetOverridesByRange hatası:", err);
      setOzetOverridesMap(new Map());
    }

  }, [santiyeId, araclar, ozetBaslangic, ozetBitis]);

  useEffect(() => { loadOzet(); }, [loadOzet]);

  const ayinGunSayisi = gunSayisi(yil, ay);
  const gunler = useMemo(() => Array.from({ length: ayinGunSayisi }, (_, i) => i + 1), [ayinGunSayisi]);

  // Sadece üzerinde aktif araç ataması olan şantiyeler
  // (Atama sekmesinde tüm şantiyeler gösterilir; bu liste sadece puantaj sekmesi için)
  const santiyelerAtamalı = useMemo(() => {
    const atamaliIds = new Set(
      araclar
        .filter((a) => (a.durum ?? "aktif") === "aktif" && a.santiye_id)
        .map((a) => a.santiye_id as string)
    );
    return santiyeler.filter((s) => atamaliIds.has(s.id));
  }, [araclar, santiyeler]);

  // Dönem dropdown'u için yıl/ay seçenekleri (geçen yıl + bu yıl + gelecek yıl)
  const ayYilSecenekleri = useMemo(() => {
    const liste: { y: number; m: number }[] = [];
    const buYil = bugun.getFullYear();
    for (let y = buYil - 2; y <= buYil + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        liste.push({ y, m });
      }
    }
    // En yeni en üstte
    liste.reverse();
    // Şu anki yıl/ay yoksa (tarihler dışında) ekle
    if (!liste.some((x) => x.y === yil && x.m === ay)) {
      liste.unshift({ y: yil, m: ay });
    }
    return liste;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yil, ay]);

  // Bu şantiyede gösterilecek araçlar:
  // 1) santiye_id'si bu olan araçlar
  // 2) Bu ay puantajı olan araçlar (isim listesinde değilse bile)
  const goruntulenenAraclar = useMemo(() => {
    const aktifAraclar = araclar.filter((a) => (a.durum ?? "aktif") === "aktif");
    const buAyPuantajVerilmis = new Set(puantajlar.map((p) => p.arac_id));
    const liste = aktifAraclar.filter(
      (a) => a.santiye_id === santiyeId || buAyPuantajVerilmis.has(a.id)
    );
    return liste.sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));
  }, [araclar, puantajlar, santiyeId]);

  // Hızlı erişim için: arac_id -> Map<gün, puantaj>
  const aracGunMap = useMemo(() => {
    const m = new Map<string, Map<number, AracPuantaj>>();
    for (const p of puantajlar) {
      const gun = parseInt(p.tarih.slice(8, 10), 10);
      if (!m.has(p.arac_id)) m.set(p.arac_id, new Map());
      m.get(p.arac_id)!.set(gun, p);
    }
    return m;
  }, [puantajlar]);

  // Bir aracın o ay içindeki toplam çalışma günü (Çalıştı=1, Yarım gün=0.5)
  function aracToplamGun(aracId: string): number {
    const gunMap = aracGunMap.get(aracId);
    if (!gunMap) return 0;
    let toplam = 0;
    for (const p of gunMap.values()) {
      if (p.durum === "calisti") toplam += 1;
      else if (p.durum === "yarim_gun") toplam += 0.5;
    }
    return toplam;
  }

  // ========== ÖZET RAPOR: Tarih aralığı bazlı hesaplamalar ==========

  function formatTL(tutar: number): string {
    return tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
  }

  // Özet Rapor'da görüntülenecek araçlar (sadece bu şantiyeye atanmış olanlar)
  const ozetAraclari = useMemo(() => {
    return araclar
      .filter((a) => (a.durum ?? "aktif") === "aktif" && a.santiye_id === santiyeId)
      .sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));
  }, [araclar, santiyeId]);


  const ozetSatirlari = useMemo<OzetSatir[]>(() => {
    function tarihEkleGun(tarihStr: string, gun: number): string {
      const d = new Date(tarihStr + "T00:00:00");
      d.setDate(d.getDate() + gun);
      return d.toISOString().slice(0, 10);
    }

    const rangeStart = ozetBaslangic;
    const rangeEnd = ozetBitis;
    const satirlar: OzetSatir[] = [];

    for (const arac of ozetAraclari) {
      const kiralar = kiraMap.get(arac.id) ?? [];
      // Artan tarihe göre sırala
      const kiralarAsc = [...kiralar].sort((a, b) =>
        a.gecerli_tarih.localeCompare(b.gecerli_tarih)
      );

      // Tarife dönemlerini aralıkla kes (null = kira tarifesi yok)
      type Donem = { baslangic: string; bitis: string; aylikBedel: number | null };
      const donemler: Donem[] = [];

      if (kiralarAsc.length === 0) {
        // Hiç kira tarifesi yok - yine de aracı tabloda göster; gerçek puantajdan sayıları hesapla
        const orijinalSayilar: Record<AracPuantajDurum, number> = {
          calisti: 0, yarim_gun: 0, calismadi: 0,
          arizali: 0, operator_yok: 0, tatil: 0,
        };
        for (const p of ozetRangePuantajlar) {
          if (p.arac_id !== arac.id) continue;
          if (p.tarih < rangeStart || p.tarih > rangeEnd) continue;
          orijinalSayilar[p.durum]++;
        }
        // Override uygula (rangeStart ay'ından)
        const sayilar: Record<AracPuantajDurum, number> = { ...orijinalSayilar };
        const yilNk = parseInt(rangeStart.slice(0, 4), 10);
        const ayNk = parseInt(rangeStart.slice(5, 7), 10);
        let overrideNk: AracPuantajOverride | null = null;
        const aracOverridesNk = ozetOverridesMap.get(arac.id) ?? [];
        const bulunanNk = aracOverridesNk.find((o) => o.donem_baslangic === rangeStart);
        if (bulunanNk) {
          overrideNk = bulunanNk;
          for (const key of ["calisti", "yarim_gun", "calismadi", "arizali", "operator_yok", "tatil"] as AracPuantajDurum[]) {
            const v = bulunanNk[key];
            if (v !== null && v !== undefined) sayilar[key] = v;
          }
        }
        const toplamGunNk = sayilar.calisti + sayilar.yarim_gun * 0.5;
        satirlar.push({
          key: `${arac.id}-nokira`,
          arac,
          donemBaslangic: rangeStart,
          donemBitis: rangeEnd,
          aylikBedel: null,
          sayilar,
          orijinalSayilar,
          override: overrideNk,
          duzenlenebilir: true,
          toplamGun: toplamGunNk,
          toplamKira: 0,
          donemSayisi: 1,
          donemIndex: 0,
        });
        continue;
      }

      // İlk tarife aralık başlangıcından sonra başlıyorsa, başta kirasız bir boşluk dönemi var.
      // Bu dönem için `aylikBedel: null` ile ayrı bir satır oluşturulur - geriye dönük uygulama YAPMA.
      if (kiralarAsc[0].gecerli_tarih > rangeStart) {
        const ilkBitis = tarihEkleGun(kiralarAsc[0].gecerli_tarih, -1);
        const gapEnd = ilkBitis > rangeEnd ? rangeEnd : ilkBitis;
        if (gapEnd >= rangeStart) {
          donemler.push({
            baslangic: rangeStart,
            bitis: gapEnd,
            aylikBedel: null,
          });
        }
      }

      for (let i = 0; i < kiralarAsc.length; i++) {
        const k = kiralarAsc[i];
        const next = kiralarAsc[i + 1];
        let segStart = k.gecerli_tarih;
        if (segStart < rangeStart) segStart = rangeStart;
        let segEnd = next ? tarihEkleGun(next.gecerli_tarih, -1) : rangeEnd;
        if (segEnd > rangeEnd) segEnd = rangeEnd;
        if (segStart > rangeEnd) continue;
        if (segEnd < rangeStart) continue;
        if (segStart > segEnd) continue;
        donemler.push({ baslangic: segStart, bitis: segEnd, aylikBedel: k.aylik_bedel });
      }

      // Ardışık aynı bedelli dönemleri birleştir (null === null dahil)
      const merged: Donem[] = [];
      for (const d of donemler) {
        const last = merged[merged.length - 1];
        if (last && last.aylikBedel === d.aylikBedel && tarihEkleGun(last.bitis, 1) === d.baslangic) {
          last.bitis = d.bitis;
        } else {
          merged.push({ ...d });
        }
      }

      if (merged.length === 0) {
        // Hiç dönem oluşmadıysa (edge case): boş 1 satır (düzenlenebilir)
        const bosSayilar: Record<AracPuantajDurum, number> = {
          calisti: 0, yarim_gun: 0, calismadi: 0,
          arizali: 0, operator_yok: 0, tatil: 0,
        };
        satirlar.push({
          key: `${arac.id}-empty`,
          arac,
          donemBaslangic: rangeStart,
          donemBitis: rangeEnd,
          aylikBedel: kiralarAsc[kiralarAsc.length - 1]?.aylik_bedel ?? null,
          sayilar: { ...bosSayilar },
          orijinalSayilar: { ...bosSayilar },
          override: null,
          duzenlenebilir: true,
          toplamGun: 0,
          toplamKira: 0,
          donemSayisi: 1,
          donemIndex: 0,
        });
        continue;
      }

      merged.forEach((d, idx) => {
        // Döneme ait puantajları filtrele
        const orijinalSayilar: Record<AracPuantajDurum, number> = {
          calisti: 0, yarim_gun: 0, calismadi: 0,
          arizali: 0, operator_yok: 0, tatil: 0,
        };
        let kira = 0;
        for (const p of ozetRangePuantajlar) {
          if (p.arac_id !== arac.id) continue;
          if (p.tarih < d.baslangic || p.tarih > d.bitis) continue;
          orijinalSayilar[p.durum]++;
          // Kira sadece tarife olan dönemler için hesaplanır (override'dan etkilenmez)
          if (d.aylikBedel !== null && (p.durum === "calisti" || p.durum === "yarim_gun")) {
            const y = parseInt(p.tarih.slice(0, 4), 10);
            const m = parseInt(p.tarih.slice(5, 7), 10);
            const gunBasi = d.aylikBedel / gunSayisi(y, m);
            kira += p.durum === "calisti" ? gunBasi : gunBasi * 0.5;
          }
        }

        // Her satır düzenlenebilir (override donem başlangıç ayına göre saklanır)
        const duzenlenebilir = true;

        // Override varsa uygula (donem başlangıç tarihi bazlı — aynı aracın farklı dönemleri ayrı override)
        let override: AracPuantajOverride | null = null;
        const sayilar: Record<AracPuantajDurum, number> = { ...orijinalSayilar };
        const donemYil = parseInt(d.baslangic.slice(0, 4), 10);
        const donemAy = parseInt(d.baslangic.slice(5, 7), 10);
        const aracOverrides = ozetOverridesMap.get(arac.id) ?? [];
        const bulunan = aracOverrides.find((o) => o.donem_baslangic === d.baslangic);
        if (bulunan) {
          override = bulunan;
          for (const key of ["calisti", "yarim_gun", "calismadi", "arizali", "operator_yok", "tatil"] as AracPuantajDurum[]) {
            const v = bulunan[key];
            if (v !== null && v !== undefined) sayilar[key] = v;
          }
        }

        // Yarım gün sütununda 1, 2, 3 gösterilir ama Toplam Gün'de 0.5 olarak sayılır
        const toplamGun = sayilar.calisti + sayilar.yarim_gun * 0.5;

        // Toplam kira: override varsa override sayılarından, yoksa orijinal puantajdan hesapla
        let toplamKira = kira; // varsayılan: orijinal puantajdan hesaplanan
        if (override && d.aylikBedel !== null) {
          // Override sonrası kira'yı yeniden hesapla (dönemin ay bazlı günlük tarifesi)
          const donemGunSayisi = gunSayisi(donemYil, donemAy);
          const gunBasi = d.aylikBedel / donemGunSayisi;
          toplamKira = (sayilar.calisti * gunBasi) + (sayilar.yarim_gun * gunBasi * 0.5);
        }

        satirlar.push({
          key: `${arac.id}-${idx}`,
          arac,
          donemBaslangic: d.baslangic,
          donemBitis: d.bitis,
          aylikBedel: d.aylikBedel,
          sayilar,
          orijinalSayilar,
          override,
          duzenlenebilir,
          toplamGun,
          toplamKira,
          donemSayisi: merged.length,
          donemIndex: idx,
        });
      });
    }

    return satirlar;
  }, [ozetAraclari, kiraMap, ozetRangePuantajlar, ozetBaslangic, ozetBitis, ozetOverridesMap]);

  // Kira bedeli kaydetme
  async function kiraKaydet() {
    if (!kiraDialogArac) return;
    const bedel = parseFloat(kiraDialogBedel.replace(/[^\d.,]/g, "").replace(",", "."));
    if (isNaN(bedel) || bedel < 0) { toast.error("Geçerli bir tutar girin."); return; }
    if (!kiraDialogTarih) { toast.error("Geçerlilik tarihi girin."); return; }
    setKiraDialogLoading(true);
    try {
      await upsertAracKiraBedeli(kiraDialogArac.id, bedel, kiraDialogTarih, kullanici?.id ?? null);
      await loadOzet();
      toast.success("Kira bedeli güncellendi.");
      setKiraDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Kira bedeli kaydetme hatası:", err);
      // "relation does not exist" -> tablo yok
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("arac_kira_bedeli tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 8000 });
      } else {
        toast.error(`Kaydetme hatası: ${msg}`, { duration: 6000 });
      }
    }
    finally { setKiraDialogLoading(false); }
  }

  function kiraDialogAc(arac: AracWithRelations) {
    setKiraDialogArac(arac);
    setKiraDialogBedel("");
    setKiraDialogTarih(new Date().toISOString().split("T")[0]);
    setKiraEditId(null);
    setKiraGecmisAcik(false);
    setKiraDialogOpen(true);
  }

  // Bir kira kaydını inline düzenlemeye başla
  function kiraEditBasla(k: AracKiraBedeli) {
    setKiraEditId(k.id);
    setKiraEditBedel(String(k.aylik_bedel));
    setKiraEditTarih(k.gecerli_tarih);
  }

  async function kiraEditKaydet() {
    if (!kiraEditId) return;
    const bedel = parseFloat(kiraEditBedel.replace(",", "."));
    if (isNaN(bedel) || bedel < 0) { toast.error("Geçerli bir tutar girin."); return; }
    if (!kiraEditTarih) { toast.error("Tarih girin."); return; }
    try {
      await updateAracKiraBedeli(kiraEditId, bedel, kiraEditTarih);
      await loadOzet();
      toast.success("Kira kaydı güncellendi.");
      setKiraEditId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Güncelleme hatası: ${msg}`);
    }
  }

  async function kiraSilOnayla() {
    if (!kiraSilId) return;
    try {
      await deleteAracKiraBedeli(kiraSilId);
      await loadOzet();
      toast.success("Kira kaydı silindi.");
      setKiraSilId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Silme hatası: ${msg}`);
    }
  }

  // Durum sayıları override dialog - tek bir durum için
  function overrideDialogAc(satir: OzetSatir, durum: AracPuantajDurum) {
    if (!satir.duzenlenebilir) {
      toast.error("Bu satır düzenlenemez: çoklu ay veya kira tarife değişikliği içeriyor.");
      return;
    }
    setOverrideDialogSatir(satir);
    setOverrideDialogDurum(durum);
    setOverrideDialogDeger(String(satir.sayilar[durum]));
    setOverrideDialogOpen(true);
  }

  async function overrideDialogKaydet() {
    if (!overrideDialogSatir || !overrideDialogDurum || !santiyeId) return;
    const yil = parseInt(overrideDialogSatir.donemBaslangic.slice(0, 4), 10);
    const ay = parseInt(overrideDialogSatir.donemBaslangic.slice(5, 7), 10);

    const v = overrideDialogDeger.trim();
    let yeniDeger: number | null;
    if (v === "") {
      yeniDeger = null; // boş = override sıfırla, orijinale dön
    } else {
      const n = parseFloat(v.replace(",", "."));
      if (isNaN(n) || n < 0) {
        toast.error("Geçerli bir sayı girin.");
        return;
      }
      yeniDeger = n;
    }

    // Dönemdeki gün sayısını hesapla
    const donemBas = new Date(overrideDialogSatir.donemBaslangic + "T00:00:00");
    const donemBit = new Date(overrideDialogSatir.donemBitis + "T00:00:00");
    const donemGunSayisi = Math.round((donemBit.getTime() - donemBas.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Toplam gün kontrolü: tüm durumların toplamı dönem gün sayısını aşamaz
    const degerToUse = yeniDeger ?? overrideDialogSatir.orijinalSayilar[overrideDialogDurum];
    let tumDurumlarToplami = 0;
    for (const d of DURUM_LISTESI) {
      if (d.kod === overrideDialogDurum) {
        tumDurumlarToplami += degerToUse;
      } else {
        tumDurumlarToplami += overrideDialogSatir.sayilar[d.kod];
      }
    }
    if (tumDurumlarToplami > donemGunSayisi) {
      toast.error(
        `Toplam gün sayısı (${tumDurumlarToplami}) dönemdeki gün sayısını (${donemGunSayisi}) aşamaz.`,
        { duration: 6000 },
      );
      return;
    }

    // Sadece bu durum alanı gönderilir; upsert diğer alanlara dokunmaz
    const parsed = { [overrideDialogDurum]: yeniDeger };

    setOverrideDialogLoading(true);
    try {
      await upsertAracOzetOverride(
        overrideDialogSatir.arac.id,
        santiyeId,
        yil,
        ay,
        overrideDialogSatir.donemBaslangic,
        parsed,
        kullanici?.id ?? null,
      );
      await loadOzet();
      toast.success("Güncellendi.");
      setOverrideDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Override kaydetme hatası:", err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("arac_puantaj_override tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 8000 });
      } else {
        toast.error(`Kaydetme hatası: ${msg}`, { duration: 6000 });
      }
    } finally {
      setOverrideDialogLoading(false);
    }
  }

  // Hücreye tıkla -> dialog aç (diğer şantiyede puantajlıysa engelle)
  function hucreTikla(arac: AracWithRelations, gun: number) {
    if (!santiyeId) return;

    // Geriye dönük gün sınırı kontrolü
    const tarih = tarihStr(yil, ay, gun);
    if (!tarihIzinliMi(kullanici, tarih)) {
      toast.error(
        `Bu tarihe işlem yapamazsınız. Geriye dönük en fazla ${kullanici?.geriye_donus_gun ?? 0} gün izniniz var.`,
      );
      return;
    }

    const mevcut = aracGunMap.get(arac.id)?.get(gun);

    // Bu gün başka şantiyede puantajlı mı? (Bu şantiyede kayıt yoksa engelle)
    const digerCakisma = digerCakismalar.get(arac.id)?.get(gun);
    if (digerCakisma && !mevcut) {
      toast.error(
        `Bu araç ${gun}/${ay}/${yil} tarihinde "${digerCakisma.santiye_adi}" şantiyesinde puantajlı. Aynı araç aynı gün sadece 1 şantiyede olabilir.`
      );
      return;
    }

    setSeciliArac(arac);
    setSeciliGun(gun);
    setSeciliDurum(mevcut?.durum ?? null);
    setSeciliAciklama(mevcut?.aciklama ?? "");
    setHucreDialogOpen(true);
  }

  // Durum butonuna tıklama:
  // - Açıklama zorunlu DEĞİLse: direkt kaydet ve kapat
  // - Açıklama zorunluysa:
  //   - Açıklama doluysa: direkt kaydet ve kapat
  //   - Açıklama boşsa: durumu highlight et, textarea'yı focus et, uyarı ver
  async function durumSec(durum: AracPuantajDurum) {
    if (!seciliArac || seciliGun === null || !santiyeId) return;
    const dBilgi = DURUM_MAP.get(durum)!;

    // Açıklama zorunlu ama boşsa -> uyarı + textarea focus
    if (dBilgi.aciklamaZorunlu && !seciliAciklama.trim()) {
      setSeciliDurum(durum); // Highlight için
      toast.error(`"${dBilgi.label}" için açıklama girmek zorunludur.`);
      // Render sonrası focus için bir tick bekle
      setTimeout(() => aciklamaRef.current?.focus(), 50);
      return;
    }

    const tarih = tarihStr(yil, ay, seciliGun);
    setDialogKaydediliyor(true);
    try {
      // Çakışma kontrolü
      const cakisma = await getAracPuantajCakisma(seciliArac.id, tarih);
      if (cakisma && cakisma.santiye_id !== santiyeId) {
        const isAdi = (cakisma as { santiyeler?: { is_adi: string } }).santiyeler?.is_adi ?? "başka şantiye";
        toast.error(`Bu araç ${tarih} tarihinde "${isAdi}" şantiyesinde puantajlanmış. Önce oradan kaldırın.`);
        return;
      }
      // Açıklama: kullanıcı yazdıysa kaydet, yoksa null
      const aciklamaToSave = seciliAciklama.trim() || null;
      await upsertAracPuantaj(seciliArac.id, santiyeId, tarih, durum, aciklamaToSave, kullanici?.id ?? null);
      // Lokal state güncelle
      setPuantajlar((prev) => {
        const filtered = prev.filter((x) => !(x.arac_id === seciliArac.id && x.tarih === tarih));
        return [
          ...filtered,
          {
            id: cakisma?.id ?? crypto.randomUUID(),
            arac_id: seciliArac.id,
            santiye_id: santiyeId,
            tarih,
            durum,
            aciklama: aciklamaToSave,
            created_at: new Date().toISOString(),
            created_by: kullanici?.id ?? null,
            created_by_ad: kullanici?.ad_soyad ?? null,
          },
        ];
      });
      toast.success(`${dBilgi.label} olarak işaretlendi.`);
      setHucreDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu";
      toast.error(`Kaydedilirken hata: ${msg}`);
    } finally {
      setDialogKaydediliyor(false);
    }
  }

  // Hücreyi kaldır
  async function hucreyiKaldir() {
    if (!seciliArac || seciliGun === null) return;
    const tarih = tarihStr(yil, ay, seciliGun);
    setDialogKaydediliyor(true);
    try {
      await deleteAracPuantaj(seciliArac.id, tarih);
      setPuantajlar((prev) => prev.filter((x) => !(x.arac_id === seciliArac.id && x.tarih === tarih)));
      toast.success("Puantaj kaldırıldı.");
      setHucreDialogOpen(false);
    } catch { toast.error("Kaldırılırken hata oluştu."); }
    finally { setDialogKaydediliyor(false); }
  }

  function oncekiAy() {
    if (ay === 1) { setAy(12); setYil(yil - 1); }
    else setAy(ay - 1);
  }
  function sonrakiAy() {
    if (ay === 12) { setAy(1); setYil(yil + 1); }
    else setAy(ay + 1);
  }

  const seciliSantiye = santiyeler.find((s) => s.id === santiyeId);

  function gunHaftaSonu(gun: number): boolean {
    const d = new Date(yil, ay - 1, gun).getDay();
    return d === 0 || d === 6;
  }
  function gunAdi(gun: number): string {
    return GUN_KISA[new Date(yil, ay - 1, gun).getDay()];
  }

  // Aktif tab'a göre PDF veya Excel export et
  function exportPDF() {
    if (aktifTab === "ozet") return ozetExportPDF();
    return puantajExportPDF();
  }
  function exportExcel() {
    if (aktifTab === "ozet") return ozetExportExcel();
    return puantajExportExcel();
  }

  function puantajExportPDF() {
    if (!seciliSantiye) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Sağ üst: oluşturma tarihi/saati (silik küçük)
    const simdi = new Date().toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 150, 150);
    doc.text(`Olusturma: ${simdi}`, pageWidth - 14, 8, { align: "right" });
    doc.setTextColor(0, 0, 0);

    // Başlık
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Arac Puantaj - ${tr(seciliSantiye.is_adi)}`, 14, 12);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${AY_ADLARI[ay - 1]} ${yil}`, 14, 17);

    // Lejant - renkli kutular + etiketler (üst kısımda yatay)
    let lejantX = 14;
    const lejantY = 22;
    doc.setFontSize(7);
    for (const d of DURUM_LISTESI) {
      // Renkli kutu
      doc.setFillColor(d.pdfRGB[0], d.pdfRGB[1], d.pdfRGB[2]);
      doc.roundedRect(lejantX, lejantY - 3, 5, 4, 0.5, 0.5, "F");
      // Sembol kutu içinde
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.text(d.pdfShort, lejantX + 2.5, lejantY, { align: "center" });
      // Etiket
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(tr(d.label), lejantX + 6.5, lejantY);
      // Sonraki için x pozisyonunu güncelle (etiket genişliği + boşluk)
      lejantX += 6.5 + doc.getTextWidth(tr(d.label)) + 5;
    }
    doc.setTextColor(0, 0, 0);

    // Body: ilk kolon boş bırakılır (didDrawCell ile özel çizilir),
    // gün hücreleri pdfShort, son kolon toplam
    const body = goruntulenenAraclar.map((a) => {
      const gunMap = aracGunMap.get(a.id);
      return [
        "", // İlk kolon - özel çizim
        ...gunler.map((g) => {
          const p = gunMap?.get(g);
          return p ? DURUM_MAP.get(p.durum)?.pdfShort ?? "" : "";
        }),
        String(aracToplamGun(a.id)),
      ];
    });

    autoTable(doc, {
      startY: 26,
      head: [["Plaka / Marka-Model", ...gunler.map(String), "Toplam"]],
      body,
      styles: { fontSize: 7, cellPadding: 0.8, halign: "center", valign: "middle" },
      headStyles: { fillColor: [30, 58, 95], fontSize: 6, textColor: 255 },
      columnStyles: { 0: { halign: "left", cellWidth: 32, minCellHeight: 9 } },
      // Gün hücrelerini durum rengiyle boyat
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index >= 1 && data.column.index <= gunler.length) {
          const txt = (data.cell.text[0] ?? "").trim();
          const rgb = PDF_RGB_MAP.get(txt);
          if (rgb) {
            data.cell.styles.fillColor = rgb;
            data.cell.styles.textColor = [255, 255, 255];
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fontSize = 8;
          }
        }
      },
      // İlk kolon: plaka büyük + marka/model küçük yazıyla manuel çiz
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const arac = goruntulenenAraclar[data.row.index];
          if (!arac) return;
          const x = data.cell.x + 1.5;
          const y = data.cell.y;
          const h = data.cell.height;

          // Plaka - büyük ve kalın
          doc.setFontSize(9);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(20, 20, 30);
          doc.text(tr(arac.plaka), x, y + h * 0.45);

          // Marka / Model - daha küçük ve gri
          const mm = [arac.marka, arac.model].filter(Boolean).join(" ");
          if (mm) {
            doc.setFontSize(5.5);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(110, 110, 120);
            doc.text(tr(mm), x, y + h * 0.85);
          }
          doc.setTextColor(0, 0, 0);
        }
      },
    });

    // Açıklamalı puantajları altta listele
    const aciklamalilar: { plaka: string; tarih: string; durum: string; aciklama: string }[] = [];
    for (const a of goruntulenenAraclar) {
      const gunMap = aracGunMap.get(a.id);
      if (!gunMap) continue;
      for (const [g, p] of gunMap.entries()) {
        if (p.aciklama) {
          aciklamalilar.push({
            plaka: tr(a.plaka),
            tarih: `${g}/${ay}/${yil}`,
            durum: tr(DURUM_MAP.get(p.durum)?.label ?? ""),
            aciklama: tr(p.aciklama),
          });
        }
      }
    }
    if (aciklamalilar.length > 0) {
      const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.text("Aciklamali Puantajlar", 14, finalY);
      autoTable(doc, {
        startY: finalY + 2,
        head: [["Plaka", "Tarih", "Durum", "Aciklama"]],
        body: aciklamalilar.map((x) => [x.plaka, x.tarih, x.durum, x.aciklama]),
        styles: { fontSize: 7, cellPadding: 1 },
        headStyles: { fillColor: [30, 58, 95], fontSize: 7, textColor: 255 },
        columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 22 }, 2: { cellWidth: 30 } },
      });
    }

    doc.save(`arac-puantaj-${seciliSantiye.is_adi.replace(/\s+/g, "-")}-${yil}-${String(ay).padStart(2, "0")}.pdf`);
  }

  function puantajExportExcel() {
    if (!seciliSantiye) return;
    const headers = ["Plaka", "Marka", "Model", ...gunler.map((g) => `${g} (${gunAdi(g)})`), "Toplam"];
    const data = goruntulenenAraclar.map((a) => {
      const gunMap = aracGunMap.get(a.id);
      return [
        a.plaka,
        a.marka ?? "",
        a.model ?? "",
        ...gunler.map((g) => {
          const p = gunMap?.get(g);
          if (!p) return "";
          const d = DURUM_MAP.get(p.durum);
          return d ? d.label + (p.aciklama ? ` (${p.aciklama})` : "") : "";
        }),
        aracToplamGun(a.id),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h, i) => ({
      wch: i < 3 ? Math.max(h.length + 2, 12) : i === headers.length - 1 ? 8 : 14,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${AY_ADLARI[ay - 1]}-${yil}`);
    XLSX.writeFile(wb, `arac-puantaj-${seciliSantiye.is_adi.replace(/\s+/g, "-")}-${yil}-${String(ay).padStart(2, "0")}.xlsx`);
  }

  // ========== ÖZET RAPOR EXPORT (tarih aralığı bazlı) ==========
  function formatDateTR(d: string): string {
    return new Date(d).toLocaleDateString("tr-TR");
  }

  function ozetExportPDF() {
    if (!seciliSantiye) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Sağ üst: oluşturma tarihi/saati
    const simdi = new Date().toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 150, 150);
    doc.text(`Olusturma: ${simdi}`, pageWidth - 14, 8, { align: "right" });
    doc.setTextColor(0, 0, 0);

    // Başlık
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Arac Ozet Rapor - ${tr(seciliSantiye.is_adi)}`, 14, 12);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${formatDateTR(ozetBaslangic)} - ${formatDateTR(ozetBitis)}`, 14, 17);

    const head = [
      "Sahibi", "Plaka", "Marka/Model", "Aylik Kira",
      ...DURUM_LISTESI.map((d) => d.pdfShort),
      "Top.Gun", "Toplam Kira",
    ];

    const body = ozetSatirlari.map((s) => {
      const a = s.arac;
      const cokDonem = s.donemSayisi > 1;
      const sahibi = a.tip === "ozmal"
        ? (a.firmalar?.firma_adi ?? "—")
        : (a.kiralama_firmasi ?? "—");
      const aylikKiraText = s.aylikBedel !== null ? formatTL(s.aylikBedel) : "-";
      return [
        s.donemIndex === 0 ? tr(sahibi) : "",
        s.donemIndex === 0 ? tr(a.plaka) : tr(a.plaka),
        s.donemIndex === 0 ? tr([a.marka, a.model].filter(Boolean).join(" ")) : "",
        aylikKiraText, // tarih didDrawCell ile ayrıca çizilecek
        // Durum sayıları: override varsa "yeni (eski)" göster
        ...DURUM_LISTESI.map((d) => {
          const val = String(s.sayilar[d.kod]);
          if (s.override && s.sayilar[d.kod] !== s.orijinalSayilar[d.kod]) {
            return `${val}\n(${s.orijinalSayilar[d.kod]})`;
          }
          return val;
        }),
        String(s.toplamGun % 1 === 0 ? s.toplamGun : s.toplamGun.toFixed(1)),
        formatTL(s.toplamKira),
      ];
    });

    // Alt satır: toplamlar (GENEL TOPLAM yazısı ve Toplam Kira sağa yaslı)
    const toplamKiraGenel = ozetSatirlari.reduce((acc, s) => acc + s.toplamKira, 0);
    const toplamGunGenel = ozetSatirlari.reduce((acc, s) => acc + s.toplamGun, 0);
    const durumToplamlari: Record<AracPuantajDurum, number> = {
      calisti: 0, yarim_gun: 0, calismadi: 0, arizali: 0, operator_yok: 0, tatil: 0,
    };
    for (const s of ozetSatirlari) {
      for (const d of DURUM_LISTESI) durumToplamlari[d.kod] += s.sayilar[d.kod];
    }

    // Kolon boyutları:
    // 0: Sahibi (geniş), 1: Plaka (orta), 2: Marka/Model (geniş),
    // 3: Aylık Kira (orta), 4-9: Durumlar (çok dar, 7mm her biri),
    // 10: Toplam Gün (dar), 11: Toplam Kira (geniş, sağa yaslı)
    // Kolon genişlikleri — tabloyu sayfada ortala
    const durumKolonStyle: Record<number, { cellWidth: number; halign: "center"; fontSize: number; fontStyle: "bold" }> = {};
    DURUM_LISTESI.forEach((_, idx) => {
      durumKolonStyle[4 + idx] = { cellWidth: 12, halign: "center", fontSize: 9, fontStyle: "bold" };
    });
    // Toplam kolon genişliği hesapla ve tabloyu ortala
    const kolonToplamW = 40 + 28 + 44 + 30 + (12 * DURUM_LISTESI.length) + 18 + 32;
    const tabloSolMargin = Math.max(10, (pageWidth - kolonToplamW) / 2);

    autoTable(doc, {
      startY: 22,
      margin: { left: tabloSolMargin, right: tabloSolMargin },
      head: [head],
      body,
      foot: [[
        { content: "GENEL TOPLAM", colSpan: 4, styles: { halign: "right" as const } },
        ...DURUM_LISTESI.map((d) => ({
          content: String(durumToplamlari[d.kod]),
          styles: { halign: "center" as const },
        })),
        {
          content: String(toplamGunGenel % 1 === 0 ? toplamGunGenel : toplamGunGenel.toFixed(1)),
          styles: { halign: "center" as const },
        },
        {
          content: formatTL(toplamKiraGenel),
          styles: { halign: "right" as const },
        },
      ]],
      styles: { fontSize: 8, cellPadding: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 }, overflow: "ellipsize", valign: "middle" },
      headStyles: { fillColor: [30, 58, 95], fontSize: 8, textColor: 255, halign: "center" },
      footStyles: { fillColor: [15, 37, 64], textColor: 255, fontStyle: "bold", fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 40, overflow: "ellipsize" },           // Sahibi
        1: { cellWidth: 28 },                                    // Plaka (tam gözüksün)
        2: { cellWidth: 44, overflow: "ellipsize" },           // Marka/Model (genişletildi)
        3: { cellWidth: 30, halign: "right", overflow: "linebreak" }, // Aylık Kira (küçültüldü)
        ...durumKolonStyle,                                       // Durumlar 12mm × 6 = 72mm
        [4 + DURUM_LISTESI.length]: { cellWidth: 18, halign: "center", fontSize: 9, fontStyle: "bold" }, // Top.Gün
        [4 + DURUM_LISTESI.length + 1]: { cellWidth: 32, halign: "right", fontSize: 9, fontStyle: "bold" },  // Toplam Kira (küçültüldü, punto büyütüldü)
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didParseCell: (data) => {
        // Aylık Kira: cokDonem ise satır yüksekliğini artır (tarih için yer aç)
        if (data.section === "body" && data.column.index === 3) {
          const satir = ozetSatirlari[data.row.index];
          if (satir && satir.donemSayisi > 1) {
            data.cell.styles.minCellHeight = 12;
          }
        }
        // Durum kolonlarını hafif renklendir
        if (data.section === "body" && data.column.index >= 4 && data.column.index < 4 + DURUM_LISTESI.length) {
          const idx = data.column.index - 4;
          const d = DURUM_LISTESI[idx];
          if (d) {
            const [r, g, b] = d.pdfRGB;
            data.cell.styles.fillColor = [
              Math.round(r * 0.15 + 255 * 0.85),
              Math.round(g * 0.15 + 255 * 0.85),
              Math.round(b * 0.15 + 255 * 0.85),
            ] as [number, number, number];
          }
          data.cell.styles.overflow = "linebreak";
        }
      },
      // Kira sütununda tarih metnini küçük puntoda çiz (orijinal body verisinden)
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const satir = ozetSatirlari[data.row.index];
          if (satir && satir.donemSayisi > 1) {
            const tarihText = `${satir.donemBaslangic.slice(8, 10)}.${satir.donemBaslangic.slice(5, 7)}.${satir.donemBaslangic.slice(2, 4)}-${satir.donemBitis.slice(8, 10)}.${satir.donemBitis.slice(5, 7)}.${satir.donemBitis.slice(2, 4)}`;
            const x = data.cell.x + data.cell.width - 1.5;
            const y = data.cell.y + data.cell.height - 1.5;
            doc.setFontSize(5.5);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(120, 120, 120);
            doc.text(tarihText, x, y, { align: "right" });
            doc.setTextColor(0, 0, 0);
          }
        }
      },
    });

    // İkon lejantı — tablonun altında, yan yana sıkı
    const lastY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Ikon Aciklamalari:", 14, lastY);
    doc.setFont("helvetica", "normal");
    // Her öğe dinamik genişlikle dizilir - sabit 52mm değil
    let lejantX = 14;
    const lejantY = lastY + 4;
    DURUM_LISTESI.forEach((d) => {
      const [r, g, b] = d.pdfRGB;
      // Renkli kutu
      doc.setFillColor(r, g, b);
      doc.rect(lejantX, lejantY - 3, 3.5, 3.5, "F");
      // Sembol kutu içinde (beyaz)
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(d.pdfShort, lejantX + 1.75, lejantY, { align: "center" });
      // Etiket
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(tr(d.label), lejantX + 5, lejantY);
      // Yana sıkı geçiş
      lejantX += 5 + doc.getTextWidth(tr(d.label)) + 4;
    });
    doc.setTextColor(0, 0, 0);

    // Firma bazlı toplam kira özeti
    const firmaToplamlari = new Map<string, number>();
    for (const s of ozetSatirlari) {
      const a = s.arac;
      const sahibi = a.tip === "ozmal"
        ? (a.firmalar?.firma_adi ?? "Bilinmiyor")
        : (a.kiralama_firmasi ?? "Bilinmiyor");
      firmaToplamlari.set(sahibi, (firmaToplamlari.get(sahibi) ?? 0) + s.toplamKira);
    }
    const firmaList = Array.from(firmaToplamlari.entries()).sort((x, y) => y[1] - x[1]);
    const firmaYStart = lastY + 12;
    // Firma tablosu sola yaslanır (web ile tutarlı)
    const firmaFirmaW = 120;
    const firmaTutarW = 60;
    const firmaLeftMargin = 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Firma Bazli Toplam Kira Bedeli", firmaLeftMargin, firmaYStart);
    autoTable(doc, {
      startY: firmaYStart + 2,
      margin: { left: firmaLeftMargin, right: 14 },
      head: [["Firma", "Toplam Kira"]],
      body: firmaList.map(([f, t]) => [tr(f), formatTL(t)]),
      foot: [[
        {
          content: `GENEL TOPLAM     ${formatTL(firmaList.reduce((a, [, b]) => a + b, 0))}`,
          colSpan: 2,
          styles: { halign: "right" as const },
        },
      ]],
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      footStyles: { fillColor: [15, 37, 64], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: firmaFirmaW },
        1: { cellWidth: firmaTutarW, halign: "right" },
      },
      didParseCell: (data) => {
        // "Toplam Kira" başlığı sağa yaslansın (halign columnStyles'dan geldiği için bazen head override gerekebilir)
        if (data.section === "head" && data.column.index === 1) {
          data.cell.styles.halign = "right";
        }
      },
    });

    doc.save(`arac-ozet-rapor-${seciliSantiye.is_adi.replace(/\s+/g, "-")}-${ozetBaslangic}-${ozetBitis}.pdf`);
  }

  function ozetExportExcel() {
    if (!seciliSantiye) return;
    const headers = [
      "Sahibi", "Plaka", "Marka", "Model",
      "Dönem Başlangıç", "Dönem Bitiş",
      "Aylık Kira (TL)",
      ...DURUM_LISTESI.map((d) => d.label),
      "Toplam Gün", "Toplam Kira (TL)",
    ];
    const data = ozetSatirlari.map((s) => {
      const a = s.arac;
      const sahibi = a.tip === "ozmal"
        ? (a.firmalar?.firma_adi ?? "")
        : (a.kiralama_firmasi ?? "");
      return [
        sahibi,
        a.plaka,
        a.marka ?? "",
        a.model ?? "",
        s.donemBaslangic,
        s.donemBitis,
        s.aylikBedel ?? "",
        ...DURUM_LISTESI.map((d) => s.sayilar[d.kod]),
        s.toplamGun,
        s.toplamKira,
      ];
    });

    // Toplam satırı
    const toplamKiraGenel = ozetSatirlari.reduce((acc, s) => acc + s.toplamKira, 0);
    const toplamGunGenel = ozetSatirlari.reduce((acc, s) => acc + s.toplamGun, 0);
    const durumToplamlari: Record<AracPuantajDurum, number> = {
      calisti: 0, yarim_gun: 0, calismadi: 0, arizali: 0, operator_yok: 0, tatil: 0,
    };
    for (const s of ozetSatirlari) {
      for (const d of DURUM_LISTESI) durumToplamlari[d.kod] += s.sayilar[d.kod];
    }
    const toplamSatiri: (string | number)[] = [
      "GENEL TOPLAM", "", "", "", "", "", "",
      ...DURUM_LISTESI.map((d) => durumToplamlari[d.kod]),
      toplamGunGenel,
      toplamKiraGenel,
    ];

    const ws = XLSX.utils.aoa_to_sheet([
      [`Özet Rapor: ${seciliSantiye.is_adi}`],
      [`Tarih Aralığı: ${formatDateTR(ozetBaslangic)} - ${formatDateTR(ozetBitis)}`],
      [],
      headers,
      ...data,
      toplamSatiri,
    ]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }));

    // Firma bazlı özet sayfası
    const firmaToplamlari = new Map<string, number>();
    for (const s of ozetSatirlari) {
      const a = s.arac;
      const sahibi = a.tip === "ozmal"
        ? (a.firmalar?.firma_adi ?? "Bilinmiyor")
        : (a.kiralama_firmasi ?? "Bilinmiyor");
      firmaToplamlari.set(sahibi, (firmaToplamlari.get(sahibi) ?? 0) + s.toplamKira);
    }
    const firmaList = Array.from(firmaToplamlari.entries()).sort((x, y) => y[1] - x[1]);
    const firmaSheet = XLSX.utils.aoa_to_sheet([
      ["Firma Bazlı Toplam Kira Bedeli"],
      [`${formatDateTR(ozetBaslangic)} - ${formatDateTR(ozetBitis)}`],
      [],
      ["Firma", "Toplam Kira (TL)"],
      ...firmaList.map(([f, t]) => [f, t]),
      ["GENEL TOPLAM", firmaList.reduce((a, [, b]) => a + b, 0)],
    ]);
    firmaSheet["!cols"] = [{ wch: 40 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ozet Rapor");
    XLSX.utils.book_append_sheet(wb, firmaSheet, "Firma Toplamlari");
    XLSX.writeFile(wb, `arac-ozet-rapor-${seciliSantiye.is_adi.replace(/\s+/g, "-")}-${ozetBaslangic}-${ozetBitis}.xlsx`);
  }

  const seciliDurumBilgi = seciliDurum ? DURUM_MAP.get(seciliDurum) : null;
  const aciklamaGerekli = seciliDurumBilgi?.aciklamaZorunlu ?? false;

  return (
    <div>
      {/* Başlık */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Araç Puantaj</h1>
          <p className="text-xs text-gray-500 mt-0.5">Şantiye bazlı aylık araç çalışma takibi</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="bg-[#F97316] hover:bg-[#ea580c] text-white"
            size="sm"
            onClick={() => setKiralikDialogOpen(true)}
          >
            <Plus size={16} className="mr-1" /> Kiralık Araç Ekle
          </Button>
          {/* PDF/Excel butonları - sadece puantaj ve özet tab'larında aktif */}
          {aktifTab !== "atama" && (() => {
            const puantajAktif = aktifTab === "puantaj";
            const veriVarMi = puantajAktif
              ? (santiyeId && goruntulenenAraclar.length > 0)
              : (santiyeId && ozetAraclari.length > 0);
            const label = puantajAktif ? "Puantaj" : "Özet";
            return (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportPDF}
                  disabled={!veriVarMi}
                  title={`${label} tablosunu PDF olarak indir`}
                >
                  <FileDown size={16} className="mr-1" /> PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportExcel}
                  disabled={!veriVarMi}
                  title={`${label} tablosunu Excel olarak indir`}
                >
                  <FileSpreadsheet size={16} className="mr-1" /> Excel
                </Button>
              </>
            );
          })()}
        </div>
      </div>

      {/* Tab yapısı: Puantaj / Araç Atama / Özet Rapor */}
      <Tabs value={aktifTab} onValueChange={(v) => setAktifTab(v as "puantaj" | "atama" | "ozet")} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="puantaj">
            <ClipboardList size={14} className="mr-1" /> Puantaj
          </TabsTrigger>
          <TabsTrigger value="atama">
            <Link2 size={14} className="mr-1" /> Araç Atama
          </TabsTrigger>
          <TabsTrigger value="ozet">
            <FileBarChart size={14} className="mr-1" /> Özet Rapor
          </TabsTrigger>
        </TabsList>

        {/* === PUANTAJ TAB === */}
        <TabsContent value="puantaj">
          {/* Üst kontroller */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-400">
                Şantiye <span className="text-gray-300">(sadece araç atanmış olanlar)</span>
              </Label>
              <SantiyeSelect santiyeler={santiyelerAtamalı} value={santiyeId} onChange={setSantiyeId} className={selectClass + " w-full"} />
              {santiyelerAtamalı.length === 0 && (
                <p className="text-[10px] text-amber-600">
                  Henüz araç ataması yapılmamış. &quot;Araç Atama&quot; sekmesinden atama yapabilirsiniz.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-400">Dönem</Label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={oncekiAy}
                  className="px-2 h-9 border rounded hover:bg-gray-50 flex items-center"
                  title="Önceki Ay"
                >
                  <ChevronLeft size={16} />
                </button>
                <select
                  value={`${yil}-${ay}`}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setYil(y); setAy(m);
                  }}
                  className={selectClass + " flex-1 font-medium text-center"}
                >
                  {ayYilSecenekleri.map(({ y, m }) => (
                    <option key={`${y}-${m}`} value={`${y}-${m}`}>
                      {AY_ADLARI[m - 1]} {y}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={sonrakiAy}
                  className="px-2 h-9 border rounded hover:bg-gray-50 flex items-center"
                  title="Sonraki Ay"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Tablo */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : !santiyeId ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <ClipboardList size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Lütfen bir şantiye seçin.</p>
        </div>
      ) : goruntulenenAraclar.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <ClipboardList size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Bu şantiyede gösterilecek araç yok.</p>
          <p className="text-xs text-gray-400 mt-1">Aracın bu şantiyeye atanmış olması veya bu ay içinde puantajının olması gerekir.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#1E3A5F]">
                <TableHead className="text-white text-[11px] px-2 sticky left-0 bg-[#1E3A5F] z-10 min-w-[160px]">Araç</TableHead>
                {gunler.map((g) => (
                  <TableHead
                    key={g}
                    className={`text-white text-[10px] text-center px-0 w-12 sm:w-8 ${gunHaftaSonu(g) ? "bg-[#2c5278]" : ""}`}
                    title={gunAdi(g)}
                  >
                    <div>{g}</div>
                    <div className="text-[8px] opacity-75">{gunAdi(g).slice(0, 1)}</div>
                  </TableHead>
                ))}
                <TableHead className="text-white text-[11px] text-center px-2 min-w-[60px] bg-[#0f2540]">Toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {goruntulenenAraclar.map((a) => {
                const gunMap = aracGunMap.get(a.id);
                const toplam = aracToplamGun(a.id);
                return (
                  <TableRow key={a.id} className="hover:bg-gray-50">
                    {/* Araç kolonu - plaka üstte, marka/model altta küçük punto */}
                    <TableCell className="px-2 sticky left-0 bg-white z-10 border-r">
                      <div className="font-bold text-sm leading-tight">{a.plaka}</div>
                      <div className="text-[10px] text-gray-500 leading-tight truncate max-w-[150px]">
                        {[a.marka, a.model].filter(Boolean).join(" ") || "—"}
                      </div>
                    </TableCell>
                    {gunler.map((g) => {
                      const p = gunMap?.get(g);
                      const dBilgi = p ? DURUM_MAP.get(p.durum) : null;
                      const haftaSonu = gunHaftaSonu(g);
                      const notVar = !!p?.aciklama;
                      // Bu gün başka şantiyede puantajlı mı? (Bu şantiyede de kayıt varsa, bu şantiye kazanır)
                      const digerCakisma = !p ? digerCakismalar.get(a.id)?.get(g) : null;
                      const kilitli = !!digerCakisma;

                      if (kilitli) {
                        return (
                          <TableCell key={g} className={`p-0 text-center w-12 sm:w-8 border-l border-gray-100 ${haftaSonu ? "bg-gray-50" : ""}`}>
                            <button
                              type="button"
                              onClick={() => hucreTikla(a, g)}
                              className="w-full h-9 flex items-center justify-center bg-gray-100 text-gray-400 cursor-not-allowed hover:bg-gray-150"
                              title={`Bu araç ${digerCakisma!.santiye_adi} şantiyesinde puantajlı. Aynı araç aynı gün sadece 1 şantiyede olabilir.`}
                            >
                              <Lock size={11} />
                            </button>
                          </TableCell>
                        );
                      }

                      return (
                        <TableCell key={g} className={`p-0 text-center w-12 sm:w-8 border-l border-gray-100 ${haftaSonu ? "bg-gray-50" : ""}`}>
                          <button
                            type="button"
                            onClick={() => hucreTikla(a, g)}
                            onMouseEnter={(e) => {
                              if (p && dBilgi) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTooltip({
                                  x: rect.left + rect.width / 2,
                                  y: rect.bottom + 8,
                                  plaka: a.plaka,
                                  isleyenAd: p.created_by_ad ?? "Bilinmiyor",
                                  durum: p.durum,
                                  aciklama: p.aciklama ?? null,
                                });
                              }
                            }}
                            onMouseLeave={() => setTooltip(null)}
                            className={`relative w-full h-10 sm:h-9 text-xs font-bold transition-colors flex items-center justify-center ${
                              dBilgi
                                ? `${dBilgi.bgClass} text-white hover:opacity-90`
                                : "hover:bg-gray-200 text-gray-300"
                            }`}
                            title={
                              !dBilgi
                                ? `${g}.${ay} - Tıklayarak puantajla`
                                : undefined
                            }
                          >
                            {dBilgi ? <dBilgi.IconComponent size={14} className="text-white" /> : ""}
                            {notVar && (
                              <span
                                className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-t-yellow-300 border-l-[8px] border-l-transparent shadow-sm pointer-events-none"
                                aria-label="Not var"
                              />
                            )}
                          </button>
                        </TableCell>
                      );
                    })}
                    <TableCell className="px-2 text-center font-bold text-[#1E3A5F] bg-blue-50 border-l">
                      {toplam % 1 === 0 ? toplam : toplam.toFixed(1)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

          {/* Lejant - Durum açıklamaları */}
          {santiyeId && goruntulenenAraclar.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
              {DURUM_LISTESI.map((d) => (
                <span key={d.kod} className="flex items-center gap-1">
                  <span className={`inline-flex items-center justify-center w-4 h-4 rounded ${d.bgClass} text-white`}>
                    <d.IconComponent size={10} className="text-white" />
                  </span>
                  {d.label}
                </span>
              ))}
            </div>
          )}
        </TabsContent>

        {/* === ARAÇ ATAMA TAB === */}
        <TabsContent value="atama">
          <div className="mb-4">
            <Label className="text-[10px] text-gray-400">Şantiye</Label>
            <SantiyeSelect santiyeler={filtreliSantiyeler(santiyeler, kullanici)} value={santiyeId} onChange={setSantiyeId} className={selectClass + " w-full md:w-1/2"} />
            <p className="text-[10px] text-gray-400 mt-1">
              Soldaki &quot;Boştaki Araçlar&quot; tablosundan bir araca tıklayıp seçili şantiyeye ekleyin. Başka şantiyeye atanmış araçlar da burada görünür.
            </p>
          </div>

          {!santiyeId ? (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <Link2 size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Araç atamak için bir şantiye seçin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* SOL: Boştaki Araçlar */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-gray-100 border-b px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2Off size={16} className="text-gray-500" />
                    <h3 className="font-semibold text-[#1E3A5F] text-sm">Boştaki Araçlar</h3>
                  </div>
                  <Badge variant="secondary">{atamaBostakiler.length}</Badge>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {atamaBostakiler.length === 0 ? (
                    <div className="text-center py-10 text-sm text-gray-400">
                      Atanacak araç yok.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {atamaBostakiler.map((a) => {
                        const mevcutSantiye = a.santiyeler?.is_adi;
                        const yukleniyor = atamaYuklenenId === a.id;
                        return (
                          <li key={a.id} className="px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{a.plaka}</span>
                                {a.tip === "kiralik" && (
                                  <Badge className="bg-[#F97316] text-[9px] px-1 py-0">Kiralık</Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-500 truncate">
                                {[a.marka, a.model].filter(Boolean).join(" ") || "—"}
                                {a.cinsi ? ` · ${a.cinsi}` : ""}
                              </div>
                              {mevcutSantiye && (
                                <div className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                                  <Link2 size={10} /> Şu an: {mevcutSantiye}
                                </div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                              onClick={() => handleAta(a.id)}
                              disabled={yukleniyor}
                            >
                              {yukleniyor ? "..." : <>Ata <ArrowRight size={14} className="ml-1" /></>}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* SAĞ: Şantiyedeki Araçlar */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-[#1E3A5F]/10 border-b px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 size={16} className="text-[#1E3A5F]" />
                    <h3 className="font-semibold text-[#1E3A5F] text-sm">
                      {santiyeler.find((s) => s.id === santiyeId)?.is_adi ?? "Şantiye"} Araçları
                    </h3>
                  </div>
                  <Badge className="bg-[#1E3A5F]">{atamaSantiyedeki.length}</Badge>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {atamaSantiyedeki.length === 0 ? (
                    <div className="text-center py-10 text-sm text-gray-400">
                      Bu şantiyede henüz araç yok.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {atamaSantiyedeki.map((a) => {
                        const yukleniyor = atamaYuklenenId === a.id;
                        return (
                          <li key={a.id} className="px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-200 text-red-600 hover:text-red-700 hover:bg-red-50 h-8"
                              onClick={() => handleCikar(a.id)}
                              disabled={yukleniyor}
                            >
                              {yukleniyor ? "..." : <><ArrowLeftIcon size={14} className="mr-1" /> Çıkar</>}
                            </Button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{a.plaka}</span>
                                {a.tip === "kiralik" && (
                                  <Badge className="bg-[#F97316] text-[9px] px-1 py-0">Kiralık</Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-500 truncate">
                                {[a.marka, a.model].filter(Boolean).join(" ") || "—"}
                                {a.cinsi ? ` · ${a.cinsi}` : ""}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* === ÖZET RAPOR TAB === */}
        <TabsContent value="ozet">
          {/* Üst: Şantiye + Tarih Aralığı */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-400">Şantiye</Label>
              <SantiyeSelect santiyeler={santiyelerAtamalı} value={santiyeId} onChange={setSantiyeId} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-400">Başlangıç Tarihi</Label>
              <input
                type="date"
                value={ozetBaslangic}
                onChange={(e) => setOzetBaslangic(e.target.value)}
                className={selectClass + " w-full"}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-400">Bitiş Tarihi</Label>
              <input
                type="date"
                value={ozetBitis}
                onChange={(e) => setOzetBitis(e.target.value)}
                className={selectClass + " w-full"}
              />
            </div>
          </div>

          {/* Hızlı aralık butonları */}
          <div className="flex flex-wrap gap-2 mb-4 text-[11px]">
            <button
              type="button"
              onClick={() => {
                // Bu Ay: içinde bulunduğumuz ayın 1'i - son günü
                const y = bugun.getFullYear();
                const m = bugun.getMonth() + 1;
                const son = gunSayisi(y, m);
                setOzetBaslangic(`${y}-${String(m).padStart(2, "0")}-01`);
                setOzetBitis(`${y}-${String(m).padStart(2, "0")}-${String(son).padStart(2, "0")}`);
              }}
              className="px-2 py-1 border rounded hover:bg-gray-50"
            >
              Bu Ay
            </button>
            <button
              type="button"
              onClick={() => {
                // Son 3 Ay: 2 ay önceki ayın 1'i - içinde bulunduğumuz ayın son günü
                const baslangicDate = new Date(bugun.getFullYear(), bugun.getMonth() - 2, 1);
                const by = baslangicDate.getFullYear();
                const bm = baslangicDate.getMonth() + 1;
                const sy = bugun.getFullYear();
                const sm = bugun.getMonth() + 1;
                const sson = gunSayisi(sy, sm);
                setOzetBaslangic(`${by}-${String(bm).padStart(2, "0")}-01`);
                setOzetBitis(`${sy}-${String(sm).padStart(2, "0")}-${String(sson).padStart(2, "0")}`);
              }}
              className="px-2 py-1 border rounded hover:bg-gray-50"
            >
              Son 3 Ay
            </button>
            <button
              type="button"
              onClick={() => {
                // Son 6 Ay: 5 ay önceki ayın 1'i - içinde bulunduğumuz ayın son günü
                const baslangicDate = new Date(bugun.getFullYear(), bugun.getMonth() - 5, 1);
                const by = baslangicDate.getFullYear();
                const bm = baslangicDate.getMonth() + 1;
                const sy = bugun.getFullYear();
                const sm = bugun.getMonth() + 1;
                const sson = gunSayisi(sy, sm);
                setOzetBaslangic(`${by}-${String(bm).padStart(2, "0")}-01`);
                setOzetBitis(`${sy}-${String(sm).padStart(2, "0")}-${String(sson).padStart(2, "0")}`);
              }}
              className="px-2 py-1 border rounded hover:bg-gray-50"
            >
              Son 6 Ay
            </button>
            <button
              type="button"
              onClick={() => {
                setOzetBaslangic(`${bugun.getFullYear()}-01-01`);
                setOzetBitis(`${bugun.getFullYear()}-12-31`);
              }}
              className="px-2 py-1 border rounded hover:bg-gray-50"
            >
              Bu Yıl
            </button>
          </div>

          {!santiyeId ? (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <FileBarChart size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Lütfen bir şantiye seçin.</p>
            </div>
          ) : ozetAraclari.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <FileBarChart size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Bu şantiyeye atanmış aktif araç yok.</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-[#1E3A5F]">
                      <TableHead className="text-white text-[11px] px-2 min-w-[120px]">Sahibi</TableHead>
                      <TableHead className="text-white text-[11px] px-2 min-w-[90px]">Plaka</TableHead>
                      <TableHead className="text-white text-[11px] px-2 min-w-[110px]">Marka/Model</TableHead>
                      <TableHead className="text-white text-[11px] px-2 text-right min-w-[140px]">Aylık Kira</TableHead>
                      <TableHead className="text-white text-[11px] px-2 text-right min-w-[80px]">Toplam Yakıt</TableHead>
                      {DURUM_LISTESI.map((d) => (
                        <TableHead
                          key={d.kod}
                          className="text-white text-[10px] px-1 text-center min-w-[44px]"
                          title={d.label}
                        >
                          <div className="flex items-center justify-center">
                            <d.IconComponent size={14} className="text-white" />
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="text-white text-[11px] px-2 text-center min-w-[70px] bg-[#0f2540]">Toplam Gün</TableHead>
                      <TableHead className="text-white text-[11px] px-2 text-right min-w-[130px] bg-[#0f2540]">Toplam Kira</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ozetSatirlari.map((s) => {
                      const a = s.arac;
                      const sahibi = a.tip === "ozmal"
                        ? (a.firmalar?.firma_adi ?? "—")
                        : (a.kiralama_firmasi ?? "—");
                      const cokDonem = s.donemSayisi > 1;
                      const donemLabel = `${new Date(s.donemBaslangic).toLocaleDateString("tr-TR")} - ${new Date(s.donemBitis).toLocaleDateString("tr-TR")}`;

                      return (
                        <TableRow
                          key={s.key}
                          className={`hover:bg-gray-50 align-top ${cokDonem && s.donemIndex > 0 ? "border-t-0" : ""}`}
                        >
                          <TableCell className="px-2 text-gray-700 truncate max-w-[120px]" title={sahibi}>
                            {s.donemIndex === 0 ? sahibi : <span className="text-gray-300">·</span>}
                          </TableCell>
                          <TableCell className="px-2 font-bold">
                            {s.donemIndex === 0 ? a.plaka : <span className="text-gray-400 font-normal">{a.plaka}</span>}
                          </TableCell>
                          <TableCell
                            className="px-2 text-gray-600 truncate max-w-[110px] cursor-help"
                            title={[a.marka, a.model].filter(Boolean).join(" ") || ""}
                          >
                            {s.donemIndex === 0
                              ? ([a.marka, a.model].filter(Boolean).join(" ") || "—")
                              : <span className="text-gray-300">·</span>}
                          </TableCell>
                          {/* Aylık Kira + Dönem aralığı */}
                          <TableCell className="px-2 text-right">
                            <button
                              type="button"
                              onClick={() => kiraDialogAc(a)}
                              className="inline-flex flex-col items-end gap-0 px-2 py-1 rounded hover:bg-blue-50 text-right"
                              title="Düzenlemek veya geçmişi görmek için tıkla"
                            >
                              <span className="font-semibold flex items-center gap-1">
                                {s.aylikBedel !== null
                                  ? formatTL(s.aylikBedel)
                                  : <span className="text-red-500 text-[10px]">Belirsiz</span>}
                                <Pencil size={10} className="text-gray-400" />
                              </span>
                              {cokDonem && (
                                <span className="text-[9px] text-gray-500 font-normal">{donemLabel}</span>
                              )}
                            </button>
                          </TableCell>
                          {/* Toplam Yakıt - placeholder */}
                          <TableCell className="px-2 text-right text-gray-400 italic">—</TableCell>
                          {/* Durum sayıları - dönem bazlı (tıklanabilir override) */}
                          {DURUM_LISTESI.map((d) => {
                            const degisti = s.override !== null && s.sayilar[d.kod] !== s.orijinalSayilar[d.kod];
                            return (
                              <TableCell key={d.kod} className="px-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => overrideDialogAc(s, d.kod)}
                                  disabled={!s.duzenlenebilir}
                                  className={`w-full py-1 rounded ${s.duzenlenebilir ? "hover:bg-blue-50 cursor-pointer" : "cursor-not-allowed"}`}
                                  title={s.duzenlenebilir ? `${d.label} değerini düzenlemek için tıkla` : "Bu satır düzenlenemez"}
                                >
                                  <div className={`font-semibold text-xs ${degisti ? "text-blue-700" : "text-gray-700"}`}>
                                    {s.sayilar[d.kod]}
                                  </div>
                                  {degisti && (
                                    <div className="text-[9px] text-gray-400 font-normal leading-tight">
                                      ({s.orijinalSayilar[d.kod]})
                                    </div>
                                  )}
                                </button>
                              </TableCell>
                            );
                          })}
                          <TableCell className="px-2 text-center font-bold text-[#1E3A5F] bg-blue-50">
                            {s.toplamGun % 1 === 0 ? s.toplamGun : s.toplamGun.toFixed(1)}
                          </TableCell>
                          <TableCell className="px-2 text-right font-bold text-[#1E3A5F] bg-blue-50">
                            {formatTL(s.toplamKira)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* İkon lejantı - Durum açıklamaları */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600 bg-gray-50 p-2 rounded border">
                <span className="font-semibold text-gray-700">İkonlar:</span>
                {DURUM_LISTESI.map((d) => (
                  <span key={d.kod} className="flex items-center gap-1">
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded ${d.bgClass} text-white`}>
                      <d.IconComponent size={10} className="text-white" />
                    </span>
                    {d.label}
                  </span>
                ))}
              </div>

              {/* Firma bazlı toplam kira özeti */}
              {(() => {
                const firmaToplamlari = new Map<string, number>();
                for (const s of ozetSatirlari) {
                  const a = s.arac;
                  const sahibi = a.tip === "ozmal"
                    ? (a.firmalar?.firma_adi ?? "Bilinmiyor")
                    : (a.kiralama_firmasi ?? "Bilinmiyor");
                  firmaToplamlari.set(sahibi, (firmaToplamlari.get(sahibi) ?? 0) + s.toplamKira);
                }
                const firmaList = Array.from(firmaToplamlari.entries()).sort((x, y) => y[1] - x[1]);
                const genelToplam = firmaList.reduce((acc, [, t]) => acc + t, 0);
                if (firmaList.length === 0) return null;
                return (
                  <div className="mt-4">
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden w-full md:w-1/2 lg:w-2/5">
                      <div className="bg-[#1E3A5F] text-white px-4 py-2 text-sm font-semibold">
                        Firma Bazlı Toplam Kira Bedeli
                      </div>
                      <Table className="text-sm">
                        <TableHeader>
                          <TableRow className="bg-gray-100">
                            <TableHead className="px-4 py-2 text-[#1E3A5F] text-xs font-semibold">Firma</TableHead>
                            <TableHead className="px-4 py-2 text-[#1E3A5F] text-xs font-semibold text-right">Toplam Kira</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {firmaList.map(([firma, toplam]) => (
                            <TableRow key={firma} className="hover:bg-gray-50">
                              <TableCell className="px-4 py-2 font-medium text-gray-700">{firma}</TableCell>
                              <TableCell className="px-4 py-2 text-right font-semibold text-[#1E3A5F]">
                                {formatTL(toplam)}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-[#1E3A5F]/5 border-t-2 border-[#1E3A5F]">
                            <TableCell colSpan={2} className="px-4 py-2 text-right">
                              <span className="font-bold text-[#1E3A5F] mr-6">GENEL TOPLAM</span>
                              <span className="font-bold text-[#1E3A5F] text-base">{formatTL(genelToplam)}</span>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })()}

              {/* Bilgi notu */}
              <div className="mt-3 text-[10px] text-gray-500 space-y-0.5">
                <div>• <strong>Aylık Kira</strong>: Kira tutarına tıklayarak mevcut tarifeyi düzenleyebilir, geçmiş tarifeleri görebilir, düzenleyebilir veya silebilirsiniz.</div>
                <div>• <strong>Tarife Dönemleri</strong>: Seçili tarih aralığında bir aracın birden fazla kira tarifesi varsa, her tarife dönemi için ayrı bir satır gösterilir. Durum sayıları ve toplam kira o döneme ait gerçek puantajlardan hesaplanır.</div>
                <div>• <strong>Toplam Kira</strong>: Döneme ait her çalışma günü için o ay için geçerli tarife × (1 ÷ ay gün sayısı) kullanılarak hesaplanır.</div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Kira Bedeli Dialog */}
      <Dialog open={kiraDialogOpen} onOpenChange={setKiraDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Aylık Kira Bedeli</DialogTitle>
          </DialogHeader>
          {kiraDialogArac && (() => {
            const tumKiralar = kiraMap.get(kiraDialogArac.id) ?? [];
            const aktifKira = tumKiralar[0];
            const eskiKiralar = tumKiralar.slice(1);
            return (
              <div className="space-y-3 py-2">
                <div className="px-3 py-2 bg-gray-50 rounded border">
                  <div className="font-bold text-sm">{kiraDialogArac.plaka}</div>
                  <div className="text-[11px] text-gray-500">
                    {[kiraDialogArac.marka, kiraDialogArac.model].filter(Boolean).join(" ")}
                  </div>
                </div>

                {/* Mevcut (En Son) Tarife - büyük */}
                {aktifKira ? (
                  <div className="p-3 rounded-lg border-2 border-blue-300 bg-blue-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-blue-700 uppercase font-semibold">Mevcut Tarife</div>
                        {kiraEditId === aktifKira.id ? null : (
                          <>
                            <div className="text-xl font-bold text-[#1E3A5F]">
                              {formatTL(aktifKira.aylik_bedel)}
                            </div>
                            <div className="text-[11px] text-gray-600 mt-0.5">
                              {new Date(aktifKira.gecerli_tarih).toLocaleDateString("tr-TR")} tarihinden itibaren
                            </div>
                          </>
                        )}
                      </div>
                      {kiraEditId === aktifKira.id ? null : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => kiraEditBasla(aktifKira)}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-white rounded"
                            title="Düzenle"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setKiraSilId(aktifKira.id)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-white rounded"
                            title="Sil"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Inline düzenleme */}
                    {kiraEditId === aktifKira.id && (
                      <div className="space-y-2 mt-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={kiraEditBedel}
                            onChange={(e) => setKiraEditBedel(e.target.value)}
                            className="h-8 rounded border border-input bg-white px-2 text-sm"
                          />
                          <input
                            type="date"
                            value={kiraEditTarih}
                            onChange={(e) => setKiraEditTarih(e.target.value)}
                            className="h-8 rounded border border-input bg-white px-2 text-sm"
                          />
                        </div>
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => setKiraEditId(null)}>İptal</Button>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7" onClick={kiraEditKaydet}>Kaydet</Button>
                        </div>
                      </div>
                    )}
                    {/* Geçmiş ok butonu - altta */}
                    {eskiKiralar.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setKiraGecmisAcik(!kiraGecmisAcik)}
                        className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-blue-700 hover:bg-blue-100 py-1 rounded"
                      >
                        {kiraGecmisAcik ? (
                          <>Geçmişi Gizle <ChevronUp size={12} /></>
                        ) : (
                          <>Geçmiş Tarifeler ({eskiKiralar.length}) <ChevronDown size={12} /></>
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border-2 border-gray-200 bg-gray-50 text-center text-sm text-gray-500">
                    Henüz tarife tanımlanmamış
                  </div>
                )}

                {/* Geçmiş tarifeler (accordion) */}
                {kiraGecmisAcik && eskiKiralar.length > 0 && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto border rounded-lg p-2 bg-gray-50">
                    <Label className="text-[10px] text-gray-500 uppercase font-semibold">Geçmiş Tarifeler</Label>
                    {eskiKiralar.map((k) => {
                      const editing = kiraEditId === k.id;
                      return (
                        <div key={k.id} className="p-2 rounded border bg-white">
                          {editing ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={kiraEditBedel}
                                  onChange={(e) => setKiraEditBedel(e.target.value)}
                                  className="h-8 rounded border border-input bg-white px-2 text-sm"
                                />
                                <input
                                  type="date"
                                  value={kiraEditTarih}
                                  onChange={(e) => setKiraEditTarih(e.target.value)}
                                  className="h-8 rounded border border-input bg-white px-2 text-sm"
                                />
                              </div>
                              <div className="flex gap-1 justify-end">
                                <Button size="sm" variant="outline" className="h-7" onClick={() => setKiraEditId(null)}>İptal</Button>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7" onClick={kiraEditKaydet}>Kaydet</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <span className="font-semibold text-sm">{formatTL(k.aylik_bedel)}</span>
                                <div className="text-[10px] text-gray-500">
                                  {new Date(k.gecerli_tarih).toLocaleDateString("tr-TR")}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => kiraEditBasla(k)}
                                  className="p-1 text-gray-500 hover:text-blue-600"
                                  title="Düzenle"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setKiraSilId(k.id)}
                                  className="p-1 text-gray-500 hover:text-red-600"
                                  title="Sil"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Yeni kayıt ekleme */}
                <div className="space-y-2 p-3 border rounded-lg bg-orange-50/30 border-orange-200">
                  <Label className="text-xs font-semibold text-orange-700">+ Yeni Kira Tarifesi</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Aylık Bedel (TL)</Label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={kiraDialogBedel}
                        onChange={(e) => setKiraDialogBedel(e.target.value)}
                        placeholder="25000"
                        className="w-full h-9 rounded-lg border border-input bg-white px-3 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Geçerlilik Tarihi</Label>
                      <input
                        type="date"
                        value={kiraDialogTarih}
                        onChange={(e) => setKiraDialogTarih(e.target.value)}
                        className="w-full h-9 rounded-lg border border-input bg-white px-3 text-sm"
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full bg-[#F97316] hover:bg-[#ea580c] text-white h-8"
                    onClick={kiraKaydet}
                    disabled={kiraDialogLoading || !kiraDialogBedel || !kiraDialogTarih}
                    size="sm"
                  >
                    {kiraDialogLoading ? "Ekleniyor..." : "Yeni Tarife Ekle"}
                  </Button>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => setKiraDialogOpen(false)} disabled={kiraDialogLoading}>Kapat</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Durum Sayıları Override Dialog - tek durum */}
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent className="max-w-sm">
          {overrideDialogSatir && overrideDialogDurum && (() => {
            const d = DURUM_LISTESI.find((x) => x.kod === overrideDialogDurum);
            if (!d) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${d.bgClass} text-white`}>
                      <d.IconComponent size={12} className="text-white" />
                    </span>
                    {d.label} Düzenle
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded border">
                    <div><strong>Araç:</strong> {overrideDialogSatir.arac.plaka} {overrideDialogSatir.arac.marka ?? ""} {overrideDialogSatir.arac.model ?? ""}</div>
                    <div><strong>Dönem:</strong> {new Date(overrideDialogSatir.donemBaslangic).toLocaleDateString("tr-TR")} - {new Date(overrideDialogSatir.donemBitis).toLocaleDateString("tr-TR")}</div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="override-deger" className="text-xs">Yeni Değer</Label>
                    <input
                      id="override-deger"
                      type="text"
                      inputMode="decimal"
                      value={overrideDialogDeger}
                      onChange={(e) => setOverrideDialogDeger(e.target.value)}
                      disabled={overrideDialogLoading}
                      autoFocus
                      className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
                    />
                    <div className="text-[10px] text-gray-400">
                      Orijinal: {overrideDialogSatir.orijinalSayilar[overrideDialogDurum]} · Boş bırakıp kaydedersen orijinale döner.
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <Button variant="outline" onClick={() => setOverrideDialogOpen(false)} disabled={overrideDialogLoading}>
                      İptal
                    </Button>
                    <Button
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={overrideDialogKaydet}
                      disabled={overrideDialogLoading}
                    >
                      Kaydet
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Kira Silme Onay */}
      <Dialog open={!!kiraSilId} onOpenChange={(o) => !o && setKiraSilId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Kira Kaydını Sil</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-gray-600">Bu kira kaydı kalıcı olarak silinecek. Emin misiniz?</p>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setKiraSilId(null)}>İptal</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={kiraSilOnayla}>
              <Trash2 size={14} className="mr-1" /> Sil
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Custom Tooltip - notlu hücreler için */}
      {tooltip && (() => {
        const dBilgi = DURUM_MAP.get(tooltip.durum);
        if (!dBilgi) return null;
        return (
          <div
            className="fixed z-[100] pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: "translateX(-50%)",
            }}
          >
            <div className="bg-white border-2 rounded-lg shadow-2xl overflow-hidden min-w-[220px] max-w-[340px]"
                 style={{ borderColor: `rgb(${dBilgi.pdfRGB.join(",")})` }}>
              {/* Renkli üst bant */}
              <div className={`${dBilgi.bgClass} text-white px-3 py-2 flex items-center gap-2`}>
                <dBilgi.IconComponent size={18} className="text-white flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm leading-tight">{dBilgi.label}</div>
                  <div className="text-[10px] opacity-90 leading-tight">{tooltip.plaka}</div>
                </div>
              </div>
              {/* İşleyen + Açıklama (varsa) */}
              <div className="p-3 space-y-2">
                <div className="text-[11px] text-gray-500 flex items-center gap-1">
                  <span className="font-semibold">İşleyen:</span>
                  <span className="text-gray-700">{tooltip.isleyenAd}</span>
                </div>
                {tooltip.aciklama && (
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase font-semibold mb-0.5">Not</div>
                    <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {tooltip.aciklama}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Hücre Puantaj Dialog */}
      <Dialog open={hucreDialogOpen} onOpenChange={setHucreDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {seciliArac && seciliGun !== null ? (
                <div className="flex flex-col gap-0.5">
                  <span className="text-base">{seciliArac.plaka} <span className="text-xs text-gray-500 font-normal">({[seciliArac.marka, seciliArac.model].filter(Boolean).join(" ")})</span></span>
                  <span className="text-xs text-gray-500 font-normal">
                    {seciliGun} {AY_ADLARI[ay - 1]} {yil} ({GUN_KISA[new Date(yil, ay - 1, seciliGun).getDay()]})
                  </span>
                </div>
              ) : "Puantaj"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 6 durum butonu - büyük */}
            <div className="grid grid-cols-2 gap-2.5">
              {DURUM_LISTESI.map((d) => {
                const aktif = seciliDurum === d.kod;
                return (
                  <button
                    key={d.kod}
                    type="button"
                    disabled={dialogKaydediliyor}
                    onClick={() => durumSec(d.kod)}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border-2 transition-all text-sm font-semibold disabled:opacity-50 ${
                      aktif
                        ? `${d.bgClass} text-white border-transparent shadow-lg scale-[1.02]`
                        : `border-gray-200 hover:border-gray-400 hover:shadow-md ${d.textClass} bg-white`
                    }`}
                    title={d.aciklamaZorunlu ? "Açıklama zorunlu" : "Tıklayınca direkt kaydedilir"}
                  >
                    <d.IconComponent size={20} className={aktif ? "text-white" : ""} />
                    <span className="text-[13px]">{d.label}</span>
                    {d.aciklamaZorunlu && (
                      <span className={`ml-auto text-[10px] font-bold ${aktif ? "text-white" : "text-red-500"}`}>
                        *
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Açıklama alanı - her zaman görünür */}
            <div className="space-y-1.5 pt-3 border-t">
              <Label className="text-xs flex items-center gap-1">
                Açıklama
                {aciklamaGerekli ? (
                  <span className="text-red-500 font-bold">* (zorunlu)</span>
                ) : (
                  <span className="text-[10px] text-gray-400 font-normal">(opsiyonel)</span>
                )}
              </Label>
              <textarea
                ref={aciklamaRef}
                value={seciliAciklama}
                onChange={(e) => setSeciliAciklama(e.target.value)}
                placeholder={
                  aciklamaGerekli
                    ? `${seciliDurumBilgi?.label} nedenini yazın...`
                    : "İstersen not ekleyebilirsin..."
                }
                rows={3}
                className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 ${
                  aciklamaGerekli && !seciliAciklama.trim()
                    ? "border-red-300 focus:ring-red-200"
                    : "border-input"
                }`}
              />
              {aciklamaGerekli && !seciliAciklama.trim() && (
                <p className="text-[10px] text-red-500">
                  Açıklama girip yukarıdan {seciliDurumBilgi?.label} butonuna tekrar tıklayın.
                </p>
              )}
              {aciklamaGerekli && seciliAciklama.trim() && (
                <p className="text-[10px] text-emerald-600">
                  ✓ Yukarıdan {seciliDurumBilgi?.label} butonuna tekrar tıklayarak kaydedebilirsiniz.
                </p>
              )}
            </div>

            {/* Kaldır butonu - sadece mevcut puantaj varsa */}
            {seciliArac && seciliGun !== null && aracGunMap.get(seciliArac.id)?.has(seciliGun) && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={hucreyiKaldir}
                  disabled={dialogKaydediliyor}
                  className="w-full text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                >
                  <Trash2 size={14} className="mr-1" /> Puantajı Kaldır
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Kiralık Araç Ekleme Dialog */}
      <Dialog open={kiralikDialogOpen} onOpenChange={setKiralikDialogOpen}>
        <DialogContent className="!max-w-4xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={18} className="text-[#F97316]" /> Yeni Kiralık Araç Ekle
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <AracForm
              tip="kiralik"
              onSuccess={() => {
                setKiralikDialogOpen(false);
                loadAraclar();
              }}
              onCancel={() => setKiralikDialogOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
