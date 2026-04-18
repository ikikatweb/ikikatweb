// Personel Puantaj sayfası - Aylık takvim ile şantiye bazlı personel puantajı
// Bir personel bir günde sadece 1 şantiyede puantajlanabilir, 5 farklı durum desteklenir
"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { getPersoneller, setPersonelPasif } from "@/lib/supabase/queries/personel";
import {
  getPersonelSantiyeler,
  addPersonelSantiye,
  removePersonelSantiye,
} from "@/lib/supabase/queries/personel-santiye";
import { getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import {
  getPersonelPuantajByAySantiye,
  getDigerSantiyePersonelCakismalari,
  getPersonelPuantajKayitlari,
  upsertPersonelPuantaj,
  deletePersonelPuantaj,
} from "@/lib/supabase/queries/personel-puantaj";
import { useAuth } from "@/hooks";
import type {
  PersonelWithRelations, PersonelPuantaj, PersonelPuantajDurum,
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
  Check, X as XIcon, Trash2, Plane, Cross, Sun, Lock,
  Car, CloudRain, Clock3,
  Link2, Link2Off, ArrowRight, ArrowLeft as ArrowLeftIcon, UserPlus,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { tarihIzinliMi } from "@/lib/utils/tarih-izin";
import { filtreliSantiyeler, otomatikSantiyeId } from "@/lib/utils/santiye-filtre";

type SantiyeBasic = { id: string; is_adi: string; durum: string; gecici_kabul_tarihi?: string | null; kesin_kabul_tarihi?: string | null; tasfiye_tarihi?: string | null; devir_tarihi?: string | null };

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

const AY_ADLARI = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const GUN_KISA = ["Pzr", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

type DurumBilgi = {
  kod: PersonelPuantajDurum;
  label: string;
  bgClass: string;
  textClass: string;
  pdfShort: string;
  pdfRGB: [number, number, number];
  aciklamaZorunlu: boolean;
  IconComponent: React.ComponentType<{ size?: number; className?: string }>;
};

const DURUM_LISTESI: DurumBilgi[] = [
  { kod: "calisti",     label: "Çalıştı",      bgClass: "bg-emerald-500", textClass: "text-emerald-700", pdfShort: "+",  pdfRGB: [16, 185, 129],  aciklamaZorunlu: false, IconComponent: Check },
  { kod: "yarim_gun",   label: "Yarım Gün",    bgClass: "bg-lime-500",    textClass: "text-lime-700",    pdfShort: "½",  pdfRGB: [132, 204, 22],  aciklamaZorunlu: false, IconComponent: Clock3 },
  { kod: "gelmedi",     label: "Gelmedi",      bgClass: "bg-red-500",     textClass: "text-red-700",     pdfShort: "-",  pdfRGB: [239, 68, 68],   aciklamaZorunlu: true,  IconComponent: XIcon },
  { kod: "izinli",      label: "İzinli",       bgClass: "bg-amber-500",   textClass: "text-amber-700",   pdfShort: "I",  pdfRGB: [245, 158, 11],  aciklamaZorunlu: false, IconComponent: Plane },
  { kod: "raporlu",     label: "Raporlu",      bgClass: "bg-purple-500",  textClass: "text-purple-700",  pdfShort: "R",  pdfRGB: [168, 85, 247],  aciklamaZorunlu: false, IconComponent: Cross },
  { kod: "dis_gorev",   label: "Dış Görev",    bgClass: "bg-indigo-500",  textClass: "text-indigo-700",  pdfShort: "D",  pdfRGB: [99, 102, 241],  aciklamaZorunlu: false, IconComponent: Car },
  { kod: "yagmur",      label: "Yağmur",       bgClass: "bg-sky-500",     textClass: "text-sky-700",     pdfShort: "Y",  pdfRGB: [14, 165, 233],  aciklamaZorunlu: false, IconComponent: CloudRain },
  { kod: "resmi_tatil", label: "Resmi Tatil",  bgClass: "bg-cyan-500",    textClass: "text-cyan-700",    pdfShort: "T",  pdfRGB: [6, 182, 212],   aciklamaZorunlu: false, IconComponent: Sun },
];

const DURUM_MAP = new Map<PersonelPuantajDurum, DurumBilgi>(DURUM_LISTESI.map((d) => [d.kod, d]));
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

export default function PersonelPuantajPage() {
  const { kullanici, isYonetici } = useAuth();

  const bugun = new Date();
  const [yil, setYil] = useState(bugun.getFullYear());
  const [ay, setAy] = useState(bugun.getMonth() + 1); // 1-12

  const [loading, setLoading] = useState(true);
  const [personeller, setPersoneller] = useState<PersonelWithRelations[]>([]);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [santiyeId, setSantiyeId] = useState<string>("");
  // Çoklu atama: personel_id -> Set<santiye_id>
  const [personelSantiyeMap, setPersonelSantiyeMap] = useState<Map<string, Set<string>>>(new Map());

  // Tab
  const [aktifTab, setAktifTab] = useState<"puantaj" | "atama">("puantaj");
  // Atama yükleme göstergesi
  const [atamaYuklenenId, setAtamaYuklenenId] = useState<string | null>(null);

  const [puantajlar, setPuantajlar] = useState<PersonelPuantaj[]>([]);
  // personel_id -> gun -> { santiye_id, santiye_adi }
  const [digerCakismalar, setDigerCakismalar] = useState<
    Map<string, Map<number, { santiye_id: string; santiye_adi: string }>>
  >(new Map());

  // Hücre dialog state
  const [hucreDialogOpen, setHucreDialogOpen] = useState(false);
  const [seciliPersonel, setSeciliPersonel] = useState<PersonelWithRelations | null>(null);
  const [seciliGun, setSeciliGun] = useState<number | null>(null);
  const [seciliDurum, setSeciliDurum] = useState<PersonelPuantajDurum | null>(null);
  const [seciliAciklama, setSeciliAciklama] = useState("");
  const [seciliMesaiSaat, setSeciliMesaiSaat] = useState("");
  const [dialogKaydediliyor, setDialogKaydediliyor] = useState(false);
  const aciklamaRef = useRef<HTMLTextAreaElement>(null);

  // Tooltip state (hover için)
  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    ad: string;
    isleyenAd: string;
    durum: PersonelPuantajDurum;
    aciklama: string | null;
    mesaiSaat: number | null;
  } | null>(null);

  // Junction map yardımcısı
  function buildPersonelSantiyeMap(rows: { personel_id: string; santiye_id: string }[]): Map<string, Set<string>> {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!m.has(r.personel_id)) m.set(r.personel_id, new Set());
      m.get(r.personel_id)!.add(r.santiye_id);
    }
    return m;
  }

  // Personel listesini + atama junction'ı yenile (atama değişikliği sonrası)
  const loadPersoneller = useCallback(async () => {
    try {
      const [pData, psData] = await Promise.all([
        getPersoneller(),
        getPersonelSantiyeler().catch(() => []),
      ]);
      setPersoneller((pData as PersonelWithRelations[]) ?? []);
      setPersonelSantiyeMap(buildPersonelSantiyeMap(psData));
    } catch {
      toast.error("Personel listesi yüklenirken hata oluştu.");
    }
  }, []);

  // İlk yükleme
  useEffect(() => {
    async function init() {
      // Her sorguyu ayrı ayrı çağır - biri hata verse bile diğerleri çalışsın
      let pData: PersonelWithRelations[] = [];
      let sData: SantiyeBasic[] = [];
      let psData: { personel_id: string; santiye_id: string }[] = [];

      try {
        pData = (await getPersoneller()) as PersonelWithRelations[];
      } catch (err) {
        console.error("getPersoneller hata:", err);
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Personel yüklenemedi: ${msg}`, { duration: 8000 });
      }

      try {
        sData = (await getSantiyelerAll()) as SantiyeBasic[];
      } catch (err) {
        console.error("getSantiyelerBasic hata:", err);
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Şantiyeler yüklenemedi: ${msg}`, { duration: 8000 });
      }

      try {
        psData = await getPersonelSantiyeler();
      } catch (err) {
        console.error("getPersonelSantiyeler hata:", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("personel_santiye")) {
          toast.error("personel_santiye tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 10000 });
        } else {
          toast.error(`Personel atamaları yüklenemedi: ${msg}`, { duration: 8000 });
        }
      }

      setPersoneller(pData ?? []);
      const sList = (sData ?? []).filter((s) => s.durum === "aktif");
      setSantiyeler(sList);
      setPersonelSantiyeMap(buildPersonelSantiyeMap(psData));
      // Kısıtlı kullanıcı tek şantiye atandıysa otomatik seç
      const otoId = otomatikSantiyeId(sList, kullanici);
      if (otoId) setSantiyeId(otoId);
      setLoading(false);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atama fonksiyonları — çoklu atama destekli
  async function handleAta(personelId: string) {
    if (!santiyeId) {
      toast.error("Önce bir şantiye seçin.");
      return;
    }
    setAtamaYuklenenId(personelId);
    try {
      await addPersonelSantiye(personelId, santiyeId);
      await loadPersoneller();
      toast.success("Personel şantiyeye atandı.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("personel_santiye tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 10000 });
      } else {
        toast.error("Atama sırasında hata oluştu.");
      }
    } finally {
      setAtamaYuklenenId(null);
    }
  }

  async function handleCikar(personelId: string) {
    if (!santiyeId) return;
    setAtamaYuklenenId(personelId);
    try {
      await removePersonelSantiye(personelId, santiyeId);
      await loadPersoneller();
      toast.success("Personel bu şantiyeden çıkarıldı.");
    } catch {
      toast.error("Çıkarma sırasında hata oluştu.");
    } finally {
      setAtamaYuklenenId(null);
    }
  }

  // Şantiye / ay değişince puantaj ve çakışmaları yükle
  const loadPuantajlar = useCallback(async () => {
    if (!santiyeId) {
      setPuantajlar([]);
      setDigerCakismalar(new Map());
      return;
    }
    try {
      const data = await getPersonelPuantajByAySantiye(santiyeId, yil, ay);
      setPuantajlar(data);

      // Tüm diğer şantiye çakışmalarını filtresiz yükle (race condition guard)
      const cakismalar = await getDigerSantiyePersonelCakismalari(null, yil, ay, santiyeId);
      const m = new Map<string, Map<number, { santiye_id: string; santiye_adi: string }>>();
      for (const c of cakismalar) {
        const gun = parseInt(c.tarih.slice(8, 10), 10);
        if (!m.has(c.personel_id)) m.set(c.personel_id, new Map());
        m.get(c.personel_id)!.set(gun, { santiye_id: c.santiye_id, santiye_adi: c.santiye_adi });
      }
      setDigerCakismalar(m);
    } catch {
      toast.error("Puantaj verileri yüklenirken hata oluştu.");
    }
  }, [santiyeId, yil, ay]);

  useEffect(() => { loadPuantajlar(); }, [loadPuantajlar]);

  const ayinGunSayisi = gunSayisi(yil, ay);
  const gunler = useMemo(() => Array.from({ length: ayinGunSayisi }, (_, i) => i + 1), [ayinGunSayisi]);

  // Seçili şantiyede gösterilecek personeller
  // - Sadece seçili şantiyeye atanmış olanlar
  // - Aktif personeller: her zaman görünür
  // - Pasif personeller:
  //   * Pasif tarihleri, seçili ayın başlangıcından önceyse gizle (sonraki ay)
  //   * Pasif tarihleri, seçili ayda veya sonraysa göster (gri)
  const gosterilecekPersoneller = useMemo(() => {
    if (!santiyeId) return [];
    return personeller
      .filter((p) => personelSantiyeMap.get(p.id)?.has(santiyeId))
      .filter((p) => {
        if (p.durum !== "pasif") return true;
        if (!p.pasif_tarihi) return true; // pasif ama tarih yok -> güvenli tarafta göster
        const ayBaslangici = new Date(yil, ay - 1, 1);
        const pasifDate = new Date(p.pasif_tarihi);
        // Pasif tarihi seçili aydan ÖNCEYSE artık görünmez (ayrıldığı aydan sonraki ay)
        return pasifDate >= ayBaslangici;
      })
      .sort((a, b) => a.ad_soyad.localeCompare(b.ad_soyad, "tr"));
  }, [personeller, personelSantiyeMap, santiyeId, yil, ay]);

  // Sadece personel ataması olan şantiyeler + kısıtlı kullanıcı filtresi
  const personelliSantiyeler = useMemo(() => {
    const idSet = new Set<string>();
    for (const sids of personelSantiyeMap.values()) {
      for (const sid of sids) idSet.add(sid);
    }
    const atamasiOlanlar = santiyeler.filter((s) => idSet.has(s.id));
    return filtreliSantiyeler(atamasiOlanlar, kullanici);
  }, [santiyeler, personelSantiyeMap, kullanici]);

  // Atama sekmesi: boştaki (bu şantiyeye henüz atanmamışlar) ve bu şantiyedeki personeller
  const atamaBostakiler = useMemo(() => {
    if (!santiyeId) return [];
    return personeller
      .filter((p) => (p.durum ?? "aktif") === "aktif")
      .filter((p) => !personelSantiyeMap.get(p.id)?.has(santiyeId))
      .sort((a, b) => a.ad_soyad.localeCompare(b.ad_soyad, "tr"));
  }, [personeller, personelSantiyeMap, santiyeId]);

  const atamaSantiyedeki = useMemo(() => {
    if (!santiyeId) return [];
    return personeller
      .filter((p) => (p.durum ?? "aktif") === "aktif")
      .filter((p) => personelSantiyeMap.get(p.id)?.has(santiyeId))
      .sort((a, b) => a.ad_soyad.localeCompare(b.ad_soyad, "tr"));
  }, [personeller, personelSantiyeMap, santiyeId]);

  // Bir personelin atandığı diğer şantiyelerin adlarını döndür (seçili şantiye hariç)
  function digerAtananSantiyeler(personelId: string): string[] {
    const sids = personelSantiyeMap.get(personelId);
    if (!sids) return [];
    const adlar: string[] = [];
    for (const sid of sids) {
      if (sid === santiyeId) continue;
      const s = santiyeler.find((x) => x.id === sid);
      if (s) adlar.push(s.is_adi);
    }
    return adlar;
  }

  // personel_id -> gun -> puantaj
  const personelGunMap = useMemo(() => {
    const m = new Map<string, Map<number, PersonelPuantaj>>();
    for (const p of puantajlar) {
      const gun = parseInt(p.tarih.slice(8, 10), 10);
      if (!m.has(p.personel_id)) m.set(p.personel_id, new Map());
      m.get(p.personel_id)!.set(gun, p);
    }
    return m;
  }, [puantajlar]);

  // Bir personelin o ay içindeki toplam çalıştığı gün sayısı
  // Gelmedi hariç tüm durumlar çalışmış sayılır (yarım gün dahil 1 tam gün)
  function personelToplamGun(personelId: string): number {
    const gunMap = personelGunMap.get(personelId);
    if (!gunMap) return 0;
    let toplam = 0;
    for (const p of gunMap.values()) {
      if (p.durum !== "gelmedi") toplam += 1;
    }
    return toplam;
  }

  // Bir personelin o ay içindeki toplam mesai saati
  function personelToplamMesai(personelId: string): number {
    const gunMap = personelGunMap.get(personelId);
    if (!gunMap) return 0;
    let toplam = 0;
    for (const p of gunMap.values()) {
      if (p.mesai_saat != null) toplam += p.mesai_saat;
    }
    return toplam;
  }

  // Bir personelin o ay içinde kullandığı izin gün sayısı (sadece "izinli" durumu)
  function personelIzinKullanilan(personelId: string): number {
    const gunMap = personelGunMap.get(personelId);
    if (!gunMap) return 0;
    let toplam = 0;
    for (const p of gunMap.values()) {
      if (p.durum === "izinli") toplam += 1;
    }
    return toplam;
  }

  // İzin sütununda gösterilecek değer: kalan izin = hak - kullanılan
  // Pozitif = kalan gün (yeşil), 0 = hak bitti, Negatif = aşıldı (kırmızı, -1, -2 şeklinde)
  function personelIzinGosterim(personel: { id: string; izin_hakki: number | null }): {
    kalan: number;     // hak - kullanılan (negatif olabilir)
    kullanilan: number;
    hakki: number;
  } {
    const kullanilan = personelIzinKullanilan(personel.id);
    const hakki = personel.izin_hakki ?? 0;
    const kalan = hakki - kullanilan;
    return { kalan, kullanilan, hakki };
  }

  function gunHaftaSonu(gun: number): boolean {
    const d = new Date(yil, ay - 1, gun).getDay();
    return d === 0 || d === 6;
  }
  function gunAdi(gun: number): string {
    return GUN_KISA[new Date(yil, ay - 1, gun).getDay()];
  }

  // Pasif bir personelin belirli bir günü, pasif_tarihi sonrasındaysa (disabled = true)
  // İşten ayrıldığı gün DAHİL o günden itibaren puantaj işlenemez
  function pasifKisitli(p: PersonelWithRelations, gun: number): boolean {
    if (p.durum !== "pasif" || !p.pasif_tarihi) return false;
    const hucreTarih = tarihStr(yil, ay, gun);
    return hucreTarih >= p.pasif_tarihi;
  }

  // Hücreye tıkla -> dialog aç
  function hucreTikla(p: PersonelWithRelations, gun: number) {
    if (!santiyeId) return;

    // Geriye dönük gün sınırı kontrolü
    const tarih = tarihStr(yil, ay, gun);
    if (!tarihIzinliMi(kullanici, tarih)) {
      toast.error(
        `Bu tarihe işlem yapamazsınız. Geriye dönük en fazla ${kullanici?.geriye_donus_gun ?? 0} gün izniniz var.`,
      );
      return;
    }

    // Pasif personel ve pasif_tarihi'den sonraki bir güne tıklanırsa engelle
    if (pasifKisitli(p, gun)) {
      toast.error(
        `"${p.ad_soyad}" personeli ${p.pasif_tarihi} tarihinde pasife alındı. Bu tarihten sonrasına puantaj işlenemez.`
      );
      return;
    }

    const mevcut = personelGunMap.get(p.id)?.get(gun);

    // Başka şantiyede puantajlı mı? (Bu şantiyede yoksa engelle)
    const digerCakisma = digerCakismalar.get(p.id)?.get(gun);
    if (digerCakisma && !mevcut) {
      toast.error(
        `Bu personel ${gun}/${ay}/${yil} tarihinde "${digerCakisma.santiye_adi}" şantiyesinde puantajlı. Aynı personel aynı gün sadece 1 şantiyede olabilir.`
      );
      return;
    }

    setSeciliPersonel(p);
    setSeciliGun(gun);
    setSeciliDurum(mevcut?.durum ?? null);
    setSeciliAciklama(mevcut?.aciklama ?? "");
    setSeciliMesaiSaat(mevcut?.mesai_saat != null ? String(mevcut.mesai_saat) : "");
    setHucreDialogOpen(true);
  }

  async function durumSec(durum: PersonelPuantajDurum) {
    if (!seciliPersonel || seciliGun === null || !santiyeId) return;
    const dBilgi = DURUM_MAP.get(durum)!;

    // Açıklama zorunlu ama boşsa uyarı
    if (dBilgi.aciklamaZorunlu && !seciliAciklama.trim()) {
      setSeciliDurum(durum);
      toast.error(`"${dBilgi.label}" için açıklama girmek zorunludur.`);
      setTimeout(() => aciklamaRef.current?.focus(), 50);
      return;
    }

    // Mesai saati yazıldıysa açıklama zorunlu
    if (seciliMesaiSaat.trim() && !seciliAciklama.trim()) {
      setSeciliDurum(durum);
      toast.error("Mesai yazıldığında açıklama girmek zorunludur.");
      setTimeout(() => aciklamaRef.current?.focus(), 50);
      return;
    }

    const tarih = tarihStr(yil, ay, seciliGun);
    setDialogKaydediliyor(true);
    try {
      // Çakışma kontrolü (senkron)
      const kayitlar = await getPersonelPuantajKayitlari(seciliPersonel.id, tarih);
      const digerKayit = kayitlar.find((k) => k.santiye_id !== santiyeId);
      if (digerKayit) {
        toast.error(`Bu personel ${tarih} tarihinde "${digerKayit.santiye_adi}" şantiyesinde puantajlı. Önce oradan kaldırın.`);
        setDialogKaydediliyor(false);
        return;
      }

      const aciklamaToSave = seciliAciklama.trim() || null;
      // Mesai saati: sadece "calisti" veya "yarim_gun" durumunda ve mesai_ucreti_var ise saklanır
      let mesaiToSave: number | null = null;
      if ((durum === "calisti" || durum === "yarim_gun") && seciliPersonel.mesai_ucreti_var && seciliMesaiSaat.trim() !== "") {
        const parsed = parseFloat(seciliMesaiSaat.replace(",", "."));
        if (isNaN(parsed) || parsed < 0) {
          toast.error("Mesai saati geçersiz.");
          setDialogKaydediliyor(false);
          return;
        }
        mesaiToSave = parsed;
      }

      await upsertPersonelPuantaj(
        seciliPersonel.id,
        santiyeId,
        tarih,
        durum,
        mesaiToSave,
        aciklamaToSave,
        kullanici?.id ?? null
      );

      // Lokal state güncelle
      setPuantajlar((prev) => {
        const filtered = prev.filter((x) => !(x.personel_id === seciliPersonel.id && x.tarih === tarih));
        return [
          ...filtered,
          {
            id: kayitlar[0]?.id ?? crypto.randomUUID(),
            personel_id: seciliPersonel.id,
            santiye_id: santiyeId,
            tarih,
            durum,
            mesai_saat: mesaiToSave,
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
      toast.error(`Kaydedilirken hata: ${msg}`, { duration: 6000 });
    } finally {
      setDialogKaydediliyor(false);
    }
  }

  async function hucreyiKaldir() {
    if (!seciliPersonel || seciliGun === null) return;
    const tarih = tarihStr(yil, ay, seciliGun);
    setDialogKaydediliyor(true);
    try {
      await deletePersonelPuantaj(seciliPersonel.id, tarih);
      setPuantajlar((prev) => prev.filter((x) => !(x.personel_id === seciliPersonel.id && x.tarih === tarih)));
      toast.success("Puantaj kaldırıldı.");
      setHucreDialogOpen(false);
    } catch {
      toast.error("Kaldırılırken hata oluştu.");
    } finally {
      setDialogKaydediliyor(false);
    }
  }

  function oncekiAy() {
    if (ay === 1) { setAy(12); setYil(yil - 1); }
    else setAy(ay - 1);
  }
  function sonrakiAy() {
    if (ay === 12) { setAy(1); setYil(yil + 1); }
    else setAy(ay + 1);
  }

  // Son 24 ay + sonraki 6 ay seçenek listesi
  const ayYilSecenekleri = useMemo(() => {
    const arr: { y: number; m: number }[] = [];
    const baseY = bugun.getFullYear();
    const baseM = bugun.getMonth() + 1;
    for (let i = -24; i <= 6; i++) {
      const keyA = baseM + i;
      const y = baseY + Math.floor((keyA - 1) / 12);
      const m = ((keyA - 1) % 12 + 12) % 12 + 1;
      arr.push({ y, m });
    }
    return arr.reverse();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seciliSantiye = santiyeler.find((s) => s.id === santiyeId);
  const seciliDurumBilgi = seciliDurum ? DURUM_MAP.get(seciliDurum) : null;
  const aciklamaGerekli = seciliDurumBilgi?.aciklamaZorunlu ?? false;

  // ========== PDF Export ==========
  function exportPDF() {
    if (!seciliSantiye) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    const simdi = new Date().toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 150, 150);
    doc.text(`Olusturma: ${simdi}`, pageWidth - 14, 8, { align: "right" });
    doc.setTextColor(0, 0, 0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Personel Puantaj - ${tr(seciliSantiye.is_adi)}`, 14, 12);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${AY_ADLARI[ay - 1]} ${yil}`, 14, 17);

    // Lejant
    let lejantX = 14;
    const lejantY = 22;
    doc.setFontSize(7);
    for (const d of DURUM_LISTESI) {
      doc.setFillColor(d.pdfRGB[0], d.pdfRGB[1], d.pdfRGB[2]);
      doc.roundedRect(lejantX, lejantY - 3, 5, 4, 0.5, 0.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.text(d.pdfShort, lejantX + 2.5, lejantY, { align: "center" });
      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.text(tr(d.label), lejantX + 6.5, lejantY);
      lejantX += 6.5 + doc.getTextWidth(tr(d.label)) + 5;
    }
    doc.setTextColor(0, 0, 0);

    const body = gosterilecekPersoneller.map((p) => {
      const gunMap = personelGunMap.get(p.id);
      const izinInfo = personelIzinGosterim(p);
      return [
        "", // ilk kolon - didDrawCell ile özel
        ...gunler.map((g) => {
          const pg = gunMap?.get(g);
          return pg ? DURUM_MAP.get(pg.durum)?.pdfShort ?? "" : "";
        }),
        personelToplamMesai(p.id) > 0 ? personelToplamMesai(p.id).toFixed(1) : "-",
        izinInfo.hakki === 0 && izinInfo.kullanilan === 0 ? "-" : String(izinInfo.kalan),
        String(personelToplamGun(p.id)),
      ];
    });

    autoTable(doc, {
      startY: 26,
      head: [["Ad Soyad / Meslek", ...gunler.map(String), "Mesai", "Izin", "T.Gun"]],
      body,
      styles: { fontSize: 7, cellPadding: 0.8, halign: "center", valign: "middle" },
      headStyles: { fillColor: [30, 58, 95], fontSize: 6, textColor: 255 },
      columnStyles: {
        0: { halign: "left", cellWidth: 42, minCellHeight: 9 },
        [gunler.length + 1]: { halign: "center", cellWidth: 13, fontStyle: "bold" },
        [gunler.length + 2]: { halign: "center", cellWidth: 11, fontStyle: "bold" },
        [gunler.length + 3]: { halign: "center", cellWidth: 11, fontStyle: "bold" },
      },
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
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const personel = gosterilecekPersoneller[data.row.index];
          if (!personel) return;
          const x = data.cell.x + 1.5;
          const y = data.cell.y;
          const h = data.cell.height;

          doc.setFontSize(8);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(20, 20, 30);
          doc.text(tr(personel.ad_soyad), x, y + h * 0.45);

          const mm = [personel.meslek, personel.gorev].filter(Boolean).join(" / ");
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
    const aciklamalilar: { ad: string; tarih: string; durum: string; aciklama: string }[] = [];
    for (const p of gosterilecekPersoneller) {
      const gunMap = personelGunMap.get(p.id);
      if (!gunMap) continue;
      for (const [g, pp] of gunMap.entries()) {
        if (pp.aciklama) {
          aciklamalilar.push({
            ad: tr(p.ad_soyad),
            tarih: `${g}/${ay}/${yil}`,
            durum: tr(DURUM_MAP.get(pp.durum)?.label ?? ""),
            aciklama: tr(pp.aciklama),
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
        head: [["Ad Soyad", "Tarih", "Durum", "Aciklama"]],
        body: aciklamalilar.map((x) => [x.ad, x.tarih, x.durum, x.aciklama]),
        styles: { fontSize: 7, cellPadding: 1 },
        headStyles: { fillColor: [30, 58, 95], fontSize: 7, textColor: 255 },
        columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: 22 }, 2: { cellWidth: 30 } },
      });
    }

    doc.save(`personel-puantaj-${seciliSantiye.is_adi.replace(/\s+/g, "-")}-${yil}-${String(ay).padStart(2, "0")}.pdf`);
  }

  // ========== Excel Export ==========
  function exportExcel() {
    if (!seciliSantiye) return;
    const headers = [
      "Ad Soyad", "Meslek", "Görev",
      ...gunler.map((g) => `${g} (${gunAdi(g)})`),
      "Toplam Mesai (saat)", "İzin", "Toplam Gün",
    ];
    const data = gosterilecekPersoneller.map((p) => {
      const gunMap = personelGunMap.get(p.id);
      const izinInfo = personelIzinGosterim(p);
      return [
        p.ad_soyad,
        p.meslek ?? "",
        p.gorev ?? "",
        ...gunler.map((g) => {
          const pg = gunMap?.get(g);
          if (!pg) return "";
          const d = DURUM_MAP.get(pg.durum);
          let cell = d ? d.label : "";
          if (pg.mesai_saat != null) cell += ` [+${pg.mesai_saat}s]`;
          if (pg.aciklama) cell += ` (${pg.aciklama})`;
          return cell;
        }),
        personelToplamMesai(p.id),
        izinInfo.kalan,
        personelToplamGun(p.id),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h, i) => ({
      wch: i < 3 ? Math.max(h.length + 2, 14) : i === headers.length - 1 || i === headers.length - 2 ? 14 : 14,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${AY_ADLARI[ay - 1]}-${yil}`);
    XLSX.writeFile(wb, `personel-puantaj-${seciliSantiye.is_adi.replace(/\s+/g, "-")}-${yil}-${String(ay).padStart(2, "0")}.xlsx`);
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Personel Puantaj</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/dashboard/yonetim/personel/yeni">
            <Button size="sm" className="bg-[#F97316] hover:bg-[#ea580c] text-white">
              <UserPlus size={14} className="mr-1" /> Personel Ekle
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={!santiyeId || gosterilecekPersoneller.length === 0}>
            <FileDown size={14} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!santiyeId || gosterilecekPersoneller.length === 0}>
            <FileSpreadsheet size={14} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      <Tabs value={aktifTab} onValueChange={(v) => setAktifTab(v as "puantaj" | "atama")} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="puantaj">Puantaj Takvimi</TabsTrigger>
          <TabsTrigger value="atama">Personel Atama</TabsTrigger>
        </TabsList>

        <TabsContent value="puantaj">
      {/* Üst bar: Şantiye + Dönem */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Şantiye</Label>
          <SantiyeSelect santiyeler={personelliSantiyeler} value={santiyeId} onChange={setSantiyeId} className={selectClass + " w-full"} />
          {personelliSantiyeler.length === 0 && !loading && (
            <p className="text-[10px] text-gray-400">
              Henüz personel ataması yapılmış şantiye yok.
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
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-[35px] bg-gray-200 rounded animate-pulse" />)}
        </div>
      ) : !santiyeId ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <ClipboardList size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Lütfen bir şantiye seçin.</p>
        </div>
      ) : gosterilecekPersoneller.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <ClipboardList size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Bu şantiyeye atanmış personel yok.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table noWrapper className="text-xs border-separate border-spacing-0">
            <thead>
              <tr className="bg-[#64748B]">
                <th
                  style={{ position: "sticky", top: 0, left: 0, zIndex: 40 }}
                  className="text-white text-[11px] px-2 h-10 text-left align-middle font-medium whitespace-nowrap bg-[#64748B] min-w-[120px] max-w-[140px] border-b border-gray-200"
                >Personel</th>
                {gunler.map((g) => (
                  <th
                    key={g}
                    style={{ position: "sticky", top: 0, zIndex: 30 }}
                    className={`text-white text-[10px] text-center px-0 h-10 align-middle font-medium whitespace-nowrap min-w-[35px] w-[35px] border-b border-gray-200 ${gunHaftaSonu(g) ? "bg-[#2c5278]" : "bg-[#64748B]"}`}
                    title={gunAdi(g)}
                  >
                    <div>{g}</div>
                    <div className="text-[8px] opacity-75">{gunAdi(g).slice(0, 1)}</div>
                  </th>
                ))}
                <th style={{ position: "sticky", top: 0, zIndex: 30 }} className="text-white text-[11px] text-center px-2 h-10 align-middle font-medium whitespace-nowrap min-w-[70px] bg-[#0f2540] border-b border-gray-200">Mesai</th>
                <th style={{ position: "sticky", top: 0, zIndex: 30 }} className="text-white text-[11px] text-center px-2 h-10 align-middle font-medium whitespace-nowrap min-w-[60px] bg-[#0f2540] border-b border-gray-200">İzin</th>
                <th style={{ position: "sticky", top: 0, zIndex: 30 }} className="text-white text-[11px] text-center px-2 h-10 align-middle font-medium whitespace-nowrap min-w-[60px] bg-[#0f2540] border-b border-gray-200">Toplam</th>
              </tr>
            </thead>
            <TableBody>
              {gosterilecekPersoneller.map((p) => {
                const gunMap = personelGunMap.get(p.id);
                const toplam = personelToplamGun(p.id);
                const toplamMesai = personelToplamMesai(p.id);
                const izinInfo = personelIzinGosterim(p);
                const pasif = p.durum === "pasif";
                return (
                  <TableRow key={p.id} className={`hover:bg-gray-50 ${pasif ? "bg-gray-50/80" : ""}`}>
                    <TableCell className={`px-2 sticky left-0 z-10 border-r ${pasif ? "bg-gray-50/80" : "bg-white"}`}>
                      <div className={`font-bold text-xs leading-tight ${pasif ? "text-gray-400" : ""}`}>
                        {p.ad_soyad}
                        {pasif && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded bg-gray-200 text-gray-500 align-middle">
                            PASİF{p.pasif_tarihi ? ` · ${new Date(p.pasif_tarihi).toLocaleDateString("tr-TR")}` : ""}
                          </span>
                        )}
                      </div>
                      <div className={`text-[9px] leading-tight truncate max-w-[120px] ${pasif ? "text-gray-400" : "text-gray-500"}`}>
                        {[p.meslek, p.gorev].filter(Boolean).join(" / ") || "—"}
                      </div>
                    </TableCell>
                    {gunler.map((g) => {
                      const pg = gunMap?.get(g);
                      const dBilgi = pg ? DURUM_MAP.get(pg.durum) : null;
                      const haftaSonu = gunHaftaSonu(g);
                      const notVar = !!pg?.aciklama;
                      const pasifGun = pasifKisitli(p, g);
                      const digerCakisma = !pg && !pasifGun ? digerCakismalar.get(p.id)?.get(g) : null;
                      const kilitli = !!digerCakisma;

                      if (pasifGun) {
                        return (
                          <TableCell
                            key={g}
                            className={`p-0 text-center min-w-[35px] w-[35px] border-l border-gray-100 bg-gray-100/70 ${haftaSonu ? "bg-gray-200/70" : ""}`}
                          >
                            <div
                              className="w-full h-[35px] flex items-center justify-center text-gray-300"
                              title="Personel pasif — puantaj işlenemez"
                            >
                              <Lock size={10} />
                            </div>
                          </TableCell>
                        );
                      }

                      if (kilitli) {
                        return (
                          <TableCell key={g} className={`p-0 text-center min-w-[35px] w-[35px] border-l border-gray-100 ${haftaSonu ? "bg-gray-50" : ""}`}>
                            <button
                              type="button"
                              onClick={() => hucreTikla(p, g)}
                              className="w-full h-[35px] flex items-center justify-center bg-gray-100 text-gray-400 cursor-not-allowed hover:bg-gray-150"
                              title={`Bu personel ${digerCakisma!.santiye_adi} şantiyesinde puantajlı. Aynı personel aynı gün sadece 1 şantiyede olabilir.`}
                            >
                              <Lock size={11} />
                            </button>
                          </TableCell>
                        );
                      }

                      return (
                        <TableCell key={g} className={`p-0 text-center min-w-[35px] w-[35px] border-l border-gray-100 ${haftaSonu ? "bg-gray-50" : ""}`}>
                          <button
                            type="button"
                            onClick={() => hucreTikla(p, g)}
                            onMouseEnter={(e) => {
                              if (pg && dBilgi) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTooltip({
                                  x: rect.left + rect.width / 2,
                                  y: rect.bottom + 8,
                                  ad: p.ad_soyad,
                                  isleyenAd: pg.created_by_ad ?? "Bilinmiyor",
                                  durum: pg.durum,
                                  aciklama: pg.aciklama ?? null,
                                  mesaiSaat: pg.mesai_saat,
                                });
                              }
                            }}
                            onMouseLeave={() => setTooltip(null)}
                            className={`relative w-full h-[35px] text-xs font-bold transition-colors flex items-center justify-center ${
                              dBilgi
                                ? `${dBilgi.bgClass} text-white hover:opacity-90`
                                : "hover:bg-gray-200 text-gray-300"
                            }`}
                            title={!dBilgi ? `${g}.${ay} - Tıklayarak puantajla` : undefined}
                          >
                            {dBilgi ? <dBilgi.IconComponent size={18} className="text-white" /> : ""}
                            {notVar && (
                              <span
                                className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-t-yellow-300 border-l-[8px] border-l-transparent shadow-sm pointer-events-none"
                                aria-label="Not var"
                              />
                            )}
                            {pg?.mesai_saat != null && pg.mesai_saat > 0 && (
                              <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-orange-700 bg-white/90 rounded px-0.5 py-px leading-none pointer-events-none">
                                +{pg.mesai_saat}
                              </span>
                            )}
                          </button>
                        </TableCell>
                      );
                    })}
                    <TableCell className={`px-2 text-center font-bold border-l ${pasif ? "text-gray-400 bg-gray-50" : "text-[#1E3A5F] bg-blue-50"}`}>
                      {toplamMesai > 0 ? `${toplamMesai % 1 === 0 ? toplamMesai : toplamMesai.toFixed(1)} s` : "—"}
                    </TableCell>
                    <TableCell
                      className={`px-2 text-center font-bold ${pasif ? "text-gray-400 bg-gray-50" : izinInfo.kalan < 0 ? "text-red-600 bg-red-50" : izinInfo.kalan === 0 ? "text-gray-500 bg-blue-50" : "text-emerald-700 bg-blue-50"}`}
                      title={`Hak: ${izinInfo.hakki} · Kullanılan: ${izinInfo.kullanilan} · Kalan: ${izinInfo.kalan}`}
                    >
                      {izinInfo.hakki === 0 && izinInfo.kullanilan === 0 ? "—" : izinInfo.kalan}
                    </TableCell>
                    <TableCell className={`px-2 text-center font-bold ${pasif ? "text-gray-400 bg-gray-50" : "text-[#1E3A5F] bg-blue-50"}`}>
                      {toplam}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Lejant */}
      {santiyeId && gosterilecekPersoneller.length > 0 && (
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

        {/* ==================== ATAMA SEKMESİ ==================== */}
        <TabsContent value="atama">
          <div className="mb-4">
            <Label className="text-[10px] text-gray-400">Şantiye</Label>
            <SantiyeSelect santiyeler={filtreliSantiyeler(santiyeler, kullanici)} value={santiyeId} onChange={setSantiyeId} className={selectClass + " w-full md:w-1/2"} />
            <p className="text-[10px] text-gray-400 mt-1">
              Soldaki &quot;Boştaki Personeller&quot; tablosundan bir personele tıklayıp seçili şantiyeye ekleyin. Başka şantiyeye atanmış personeller de burada görünür.
            </p>
          </div>

          {!santiyeId ? (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <Link2 size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Personel atamak için bir şantiye seçin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* SOL: Boştaki Personeller */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-gray-100 border-b px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2Off size={16} className="text-gray-500" />
                    <h3 className="font-semibold text-[#1E3A5F] text-sm">Boştaki Personeller</h3>
                  </div>
                  <Badge variant="secondary">{atamaBostakiler.length}</Badge>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {atamaBostakiler.length === 0 ? (
                    <div className="text-center py-10 text-sm text-gray-400">
                      Atanacak personel yok.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {atamaBostakiler.map((p) => {
                        const digerSantiyeler = digerAtananSantiyeler(p.id);
                        const yukleniyor = atamaYuklenenId === p.id;
                        return (
                          <li key={p.id} className="px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{p.ad_soyad}</span>
                                {p.mesai_ucreti_var && (
                                  <Badge className="bg-amber-500 text-[9px] px-1 py-0">Mesai</Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-500 truncate">
                                {[p.meslek, p.gorev].filter(Boolean).join(" / ") || "—"}
                              </div>
                              {digerSantiyeler.length > 0 && (
                                <div className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                                  <Link2 size={10} /> Ayrıca: {digerSantiyeler.join(", ")}
                                </div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                              onClick={() => handleAta(p.id)}
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

              {/* SAĞ: Şantiyedeki Personeller */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-[#64748B]/10 border-b px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 size={16} className="text-[#1E3A5F]" />
                    <h3 className="font-semibold text-[#1E3A5F] text-sm">
                      {santiyeler.find((s) => s.id === santiyeId)?.is_adi ?? "Şantiye"} Personelleri
                    </h3>
                  </div>
                  <Badge className="bg-[#64748B]">{atamaSantiyedeki.length}</Badge>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {atamaSantiyedeki.length === 0 ? (
                    <div className="text-center py-10 text-sm text-gray-400">
                      Bu şantiyede henüz personel yok.
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {atamaSantiyedeki.map((p) => {
                        const digerSantiyeler = digerAtananSantiyeler(p.id);
                        const yukleniyor = atamaYuklenenId === p.id;
                        return (
                          <li key={p.id} className="px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-200 text-red-600 hover:text-red-700 hover:bg-red-50 h-8"
                              onClick={() => handleCikar(p.id)}
                              disabled={yukleniyor}
                            >
                              {yukleniyor ? "..." : <><ArrowLeftIcon size={14} className="mr-1" /> Çıkar</>}
                            </Button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{p.ad_soyad}</span>
                                {p.mesai_ucreti_var && (
                                  <Badge className="bg-amber-500 text-[9px] px-1 py-0">Mesai</Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-500 truncate">
                                {[p.meslek, p.gorev].filter(Boolean).join(" / ") || "—"}
                              </div>
                              {digerSantiyeler.length > 0 && (
                                <div className="text-[10px] text-blue-600 mt-0.5 flex items-center gap-1">
                                  <Link2 size={10} /> Ayrıca: {digerSantiyeler.join(", ")}
                                </div>
                              )}
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
      </Tabs>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-[#64748B] text-white px-3 py-2 rounded shadow-lg text-xs pointer-events-none max-w-xs"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translateX(-50%)" }}
        >
          <div className="font-bold">{tooltip.ad}</div>
          <div className="text-[10px] opacity-80">
            {DURUM_MAP.get(tooltip.durum)?.label}
            {tooltip.mesaiSaat != null && tooltip.mesaiSaat > 0 && ` · +${tooltip.mesaiSaat} saat mesai`}
          </div>
          {tooltip.aciklama && <div className="mt-1 text-[11px]">{tooltip.aciklama}</div>}
          <div className="mt-1 text-[9px] opacity-60">İşleyen: {tooltip.isleyenAd}</div>
        </div>
      )}

      {/* Hücre Dialog */}
      <Dialog open={hucreDialogOpen} onOpenChange={setHucreDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {seciliPersonel?.ad_soyad} — {seciliGun}/{ay}/{yil}
            </DialogTitle>
          </DialogHeader>
          {seciliPersonel && (
            <div className="space-y-3 py-2">
              <div className="text-[11px] text-gray-500 px-1">
                {[seciliPersonel.meslek, seciliPersonel.gorev].filter(Boolean).join(" / ") || "—"}
              </div>

              {/* Durum butonları - 3 sütunlu grid */}
              <div className="grid grid-cols-3 gap-2">
                {DURUM_LISTESI.map((d) => {
                  const aktif = seciliDurum === d.kod;
                  return (
                    <button
                      key={d.kod}
                      type="button"
                      onClick={() => durumSec(d.kod)}
                      disabled={dialogKaydediliyor}
                      className={`relative p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1 ${
                        aktif
                          ? `${d.bgClass} border-white text-white ring-2 ring-offset-1 ring-[#1E3A5F]`
                          : "bg-white border-gray-200 hover:border-gray-400"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded flex items-center justify-center ${aktif ? "bg-white/20" : d.bgClass}`}>
                        <d.IconComponent size={16} className={aktif ? "text-white" : "text-white"} />
                      </div>
                      <span className={`text-[10px] font-semibold ${aktif ? "text-white" : "text-gray-700"}`}>{d.label}</span>
                      {d.aciklamaZorunlu && (
                        <span className={`text-[8px] ${aktif ? "text-white/90" : "text-red-500"}`}>açıklama zorunlu</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Mesai saati - sadece mesai_ucreti_var ise */}
              {seciliPersonel.mesai_ucreti_var && (
                <div className="space-y-1">
                  <Label htmlFor="mesai_saat" className="text-xs">
                    Mesai Saati (sadece Çalıştı durumunda kaydedilir)
                  </Label>
                  <input
                    id="mesai_saat"
                    type="text"
                    inputMode="decimal"
                    placeholder="Örn: 2.5"
                    value={seciliMesaiSaat}
                    onChange={(e) => setSeciliMesaiSaat(e.target.value)}
                    disabled={dialogKaydediliyor}
                    className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
                  />
                </div>
              )}

              {/* Açıklama */}
              <div className="space-y-1">
                <Label htmlFor="aciklama" className="text-xs">
                  Açıklama
                  {aciklamaGerekli && <span className="text-red-500 ml-1">*</span>}
                </Label>
                <textarea
                  ref={aciklamaRef}
                  id="aciklama"
                  value={seciliAciklama}
                  onChange={(e) => setSeciliAciklama(e.target.value)}
                  disabled={dialogKaydediliyor}
                  rows={2}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 resize-none"
                  placeholder={aciklamaGerekli ? "Açıklama zorunlu..." : "Opsiyonel..."}
                />
              </div>

              {/* Alt butonlar */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  {personelGunMap.get(seciliPersonel.id)?.has(seciliGun ?? -1) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={hucreyiKaldir}
                      disabled={dialogKaydediliyor}
                    >
                      <Trash2 size={14} className="mr-1" /> Kaldır
                    </Button>
                  )}
                  {seciliPersonel.durum !== "pasif" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-red-700 border-red-300 hover:bg-red-100 bg-red-50"
                      onClick={async () => {
                        if (!seciliPersonel || seciliGun === null) return;
                        const tarih = tarihStr(yil, ay, seciliGun);
                        if (!confirm(`"${seciliPersonel.ad_soyad}" personelini ${tarih} tarihi itibariyle işten ayrıldı olarak işaretlemek istiyor musunuz?`)) return;
                        setDialogKaydediliyor(true);
                        try {
                          await setPersonelPasif(seciliPersonel.id, tarih);
                          await loadPersoneller();
                          toast.success(`${seciliPersonel.ad_soyad} işten ayrıldı olarak işaretlendi.`);
                          setHucreDialogOpen(false);
                        } catch {
                          toast.error("İşten ayrıldı işlemi sırasında hata oluştu.");
                        } finally {
                          setDialogKaydediliyor(false);
                        }
                      }}
                      disabled={dialogKaydediliyor}
                    >
                      <XIcon size={14} className="mr-1" /> İşten Ayrıldı
                    </Button>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setHucreDialogOpen(false)}
                  disabled={dialogKaydediliyor}
                >
                  İptal
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
