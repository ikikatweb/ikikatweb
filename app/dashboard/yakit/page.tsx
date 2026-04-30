// Yakıt takip sayfası
// - Araç yakıt dağıtımı, depo alımları, şantiyeler arası virman
// - Tek büyük tablo, tarih/saat sıralı, kümülatif depo stoğu
// - Araç cinsi + sayaç tipi bazlı tüketim limit kontrolü (anlık ortalama)
// - Arama, PDF/Excel export
"use client";

import AracForm from "@/components/shared/arac-form";
import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAraclar, updateArac } from "@/lib/supabase/queries/araclar";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import type { Tanimlama } from "@/lib/supabase/types";
import { getSantiyelerBasic, getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import {
  getAracYakitlarByRange,
  insertAracYakit,
  updateAracYakit,
  deleteAracYakit,
  getYakitAlimlarByRange,
  insertYakitAlim,
  updateYakitAlim,
  deleteYakitAlim,
  getYakitVirmanlarByRange,
  insertYakitVirman,
  updateYakitVirman,
  deleteYakitVirman,
  getAracCinsiYakitLimitler,
} from "@/lib/supabase/queries/yakit";
import { useAuth } from "@/hooks";
import type {
  AracWithRelations,
  AracYakit,
  YakitAlim,
  YakitVirman,
  AracCinsiYakitLimit,
} from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  FileDown, FileSpreadsheet, Plus, Trash2, Truck, Download,
  AlertTriangle, ArrowRight, Search, Fuel, RefreshCcw, Pencil,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { tarihIzinliMi } from "@/lib/utils/tarih-izin";
import { filtreliSantiyeler, otomatikSantiyeId } from "@/lib/utils/santiye-filtre";
import { formatBaslik } from "@/lib/utils/isim";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";

type SantiyeBasic = { id: string; is_adi: string; durum: string; gecici_kabul_tarihi?: string | null; kesin_kabul_tarihi?: string | null; tasfiye_tarihi?: string | null; devir_tarihi?: string | null; depo_kapasitesi?: number | null };

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

// Birleşik hareket tipi
type Hareket =
  | {
      tip: "arac_yakit";
      id: string;
      tarih: string;
      saat: string;
      santiye_id: string;
      arac_id: string;
      km_saat: number;
      miktar_lt: number;
      depo_full: boolean;
      notu: string | null;
      created_by: string | null;
    }
  | {
      tip: "alim";
      id: string;
      tarih: string;
      saat: string;
      santiye_id: string;
      tedarikci_firma: string;
      miktar_lt: number;
      birim_fiyat: number;
      notu: string | null;
      created_by: string | null;
    }
  | {
      tip: "virman";
      id: string;
      tarih: string;
      saat: string;
      gonderen_santiye_id: string;
      alan_santiye_id: string;
      miktar_lt: number;
      notu: string | null;
      created_by: string | null;
    };

// Hesaplanmış tablo satırı
type TabloSatir = {
  hareket: Hareket;
  fark: number | null;
  anlikOrt: number | null;
  genelOrt: number | null;
  depoStok: number | null;
  limitAlt: number | null;
  limitUst: number | null;
  limitIhlali: boolean;
  birim: "km" | "saat" | null;
  virmanYon: "giden" | "gelen" | null; // virman satırlarında yön
  satirKey: string; // unique render key
};

// Türkçe → ASCII (PDF için)
function tr(s: string): string {
  return s
    .replace(/ğ/g, "g").replace(/Ğ/g, "G")
    .replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S")
    .replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C")
    .replace(/ı/g, "i").replace(/İ/g, "I")
    .replace(/—/g, "-");
}

function formatSayi(n: number, digits: number = 2): string {
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatTL(tutar: number): string {
  return formatSayi(tutar) + " TL";
}

function formatLt(n: number): string {
  return formatSayi(n, n % 1 === 0 ? 0 : 2) + " lt";
}

// Akıllı miktar formatı — tamsayıysa ondalık gösterme, küsüratlıysa 2 hane
// "Yuvarlamayalım" — kullanıcının girdiği değer neyse o görünsün
function formatMiktar(n: number | null | undefined): string {
  if (n == null) return "—";
  return formatSayi(n, n % 1 === 0 ? 0 : 2);
}

// Tarih+saat karşılaştırması için tek string
function hareketKey(h: { tarih: string; saat: string }): string {
  return `${h.tarih}T${h.saat}`;
}

export default function YakitPage() {
  return <Suspense fallback={<div className="text-center py-16 text-gray-500">Yükleniyor...</div>}><YakitPageContent /></Suspense>;
}

function YakitPageContent() {
  const yakitSearchParams = useSearchParams();
  const { kullanici, isYonetici, isShantiyeAdmin, sadeceKendiKayitlari, hasPermission } = useAuth();
  const yEkle = hasPermission("yakit", "ekle");
  const yDuzenle = hasPermission("yakit", "duzenle");
  const ySil = hasPermission("yakit", "sil");

  // Veri state'leri
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [yakitKayitlari, setYakitKayitlari] = useState<AracYakit[]>([]);
  const [alimlar, setAlimlar] = useState<YakitAlim[]>([]);
  const [virmanlar, setVirmanlar] = useState<YakitVirman[]>([]);
  const [limitler, setLimitler] = useState<AracCinsiYakitLimit[]>([]);
  const [kullaniciMap, setKullaniciMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [yakitKiralikDialogOpen, setYakitKiralikDialogOpen] = useState(false);

  // Filtre state'leri
  const bugun = new Date();
  const [filtreSantiyeId, setFiltreSantiyeId] = useState<string>(() => yakitSearchParams.get("santiye") ?? "");
  // URL'deki santiye parametresi değişirse filtreyi güncelle (Dashboard'dan navigasyonda)
  const urlSantiyeParam = yakitSearchParams.get("santiye");
  useEffect(() => {
    if (urlSantiyeParam) {
      setFiltreSantiyeId(urlSantiyeParam);
    }
  }, [urlSantiyeParam]);
  const [filtreBaslangic, setFiltreBaslangic] = useState(() => {
    const y = bugun.getFullYear();
    const m = bugun.getMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}-01`;
  });
  const [filtreBitis, setFiltreBitis] = useState(() => {
    const y = bugun.getFullYear();
    const m = bugun.getMonth() + 1;
    const son = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(son).padStart(2, "0")}`;
  });
  const [arama, setArama] = useState("");
  // Sadece limit dışı (anomali) kayıtları göster
  const [sadeceLimitDisi, setSadeceLimitDisi] = useState(false);

  // Dialog: Yakıt Ver
  const [verDialogOpen, setVerDialogOpen] = useState(false);
  const [verEditId, setVerEditId] = useState<string | null>(null);
  const [verDialogSantiyeId, setVerDialogSantiyeId] = useState("");
  const [verDialogAracId, setVerDialogAracId] = useState("");
  const [verDialogTarih, setVerDialogTarih] = useState("");
  const [verDialogSaat, setVerDialogSaat] = useState("");
  const [verDialogKmSaat, setVerDialogKmSaat] = useState("");
  const [verDialogMiktar, setVerDialogMiktar] = useState("");
  const [verDialogNotu, setVerDialogNotu] = useState("");
  const [verDialogDepoFull, setVerDialogDepoFull] = useState(false);
  const [verDialogLoading, setVerDialogLoading] = useState(false);

  // Dialog: Yakıt Al
  const [alDialogOpen, setAlDialogOpen] = useState(false);
  const [alEditId, setAlEditId] = useState<string | null>(null);
  const [alDialogSantiyeId, setAlDialogSantiyeId] = useState("");
  const [alDialogTarih, setAlDialogTarih] = useState("");
  const [alDialogSaat, setAlDialogSaat] = useState("");
  const [alDialogFirma, setAlDialogFirma] = useState("");
  const [alDialogMiktar, setAlDialogMiktar] = useState("");
  const [alDialogBirimFiyat, setAlDialogBirimFiyat] = useState("");
  const [alDialogToplam, setAlDialogToplam] = useState("");
  const [alDialogNotu, setAlDialogNotu] = useState("");
  const [alDialogLoading, setAlDialogLoading] = useState(false);

  // Dialog: Virman
  const [virDialogOpen, setVirDialogOpen] = useState(false);
  const [virEditId, setVirEditId] = useState<string | null>(null);
  const [virDialogGonderen, setVirDialogGonderen] = useState("");
  const [virDialogAlan, setVirDialogAlan] = useState("");
  const [virDialogTarih, setVirDialogTarih] = useState("");
  const [virDialogSaat, setVirDialogSaat] = useState("");
  const [virDialogMiktar, setVirDialogMiktar] = useState("");
  const [virDialogNotu, setVirDialogNotu] = useState("");
  const [virDialogLoading, setVirDialogLoading] = useState(false);

  // Silme onayı
  const [silOnay, setSilOnay] = useState<{ tip: "arac_yakit" | "alim" | "virman"; id: string } | null>(null);

  // Hızlı araç atama (yakıt dialog içinden)
  const [hizliAtamaOpen, setHizliAtamaOpen] = useState(false);
  const [hizliAtamaArama, setHizliAtamaArama] = useState("");

  // Veri yükleme
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [aracData, santiyeData, limitData, cinsTanimData] = await Promise.all([
        getAraclar(),
        getSantiyelerAll(),
        getAracCinsiYakitLimitler().catch(() => [] as AracCinsiYakitLimit[]),
        getTanimlamalar("arac_cinsi").catch(() => [] as Tanimlama[]),
      ]);
      // Cins → sayaç tipi map'i (tanımlamalardan güncel değer)
      const cinsSayacMap = new Map<string, "km" | "saat">();
      for (const t of cinsTanimData) {
        if (t.kisa_ad === "km" || t.kisa_ad === "saat") cinsSayacMap.set(t.deger, t.kisa_ad);
      }
      // Araçların sayac_tipi'ni tanımlamadaki cins→sayac bilgisiyle senkronize et
      const araclarFixed = (aracData as AracWithRelations[]).map((a) => {
        if (a.cinsi && cinsSayacMap.has(a.cinsi)) {
          const guncelSayac = cinsSayacMap.get(a.cinsi)!;
          if (a.sayac_tipi !== guncelSayac) {
            // DB'yi de arka planda güncelle (sessiz)
            updateArac(a.id, { sayac_tipi: guncelSayac }).catch(() => {});
            return { ...a, sayac_tipi: guncelSayac };
          }
        }
        return a;
      });
      setAraclar(araclarFixed);
      setSantiyeler(santiyeData as SantiyeBasic[]);
      setLimitler(limitData);

      // Kısıtlı kullanıcı tek şantiye atandıysa otomatik seç
      const otoId = otomatikSantiyeId(santiyeData as SantiyeBasic[], kullanici);
      if (otoId) setFiltreSantiyeId(otoId);

      // Tüm yakıt hareketlerini çok geniş aralıkla çek (kümülatif stok doğruluğu için)
      const genisBaslangic = "2000-01-01";
      const genisBitis = "2099-12-31";
      const [yakitData, alimData, virmanData] = await Promise.all([
        getAracYakitlarByRange(null, genisBaslangic, genisBitis).catch(() => [] as AracYakit[]),
        getYakitAlimlarByRange(null, genisBaslangic, genisBitis).catch(() => [] as YakitAlim[]),
        getYakitVirmanlarByRange(genisBaslangic, genisBitis).catch(() => [] as YakitVirman[]),
      ]);
      setYakitKayitlari(yakitData);
      setAlimlar(alimData);
      setVirmanlar(virmanData);

      // Kullanıcı adlarını çek (created_by gösterimi için)
      // RLS sorunu yaşanmaması için API endpoint kullan (service role key ile çalışır)
      const map = new Map<string, string>();
      if (kullanici) map.set(kullanici.id, kullanici.ad_soyad);
      try {
        const res = await fetch("/api/kullanicilar/adlar");
        if (res.ok) {
          const tumKullanicilar = (await res.json()) as { id: string; ad_soyad: string }[];
          for (const k of tumKullanicilar) {
            map.set(k.id, k.ad_soyad);
          }
        }
      } catch {
        // API hatası — mevcut map ile devam et
      }
      setKullaniciMap(map);
    } catch (err) {
      console.error("Yakıt verileri yüklenirken hata:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("Yakıt tabloları Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 10000 });
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Araç map (hızlı erişim için)
  const aracMap = useMemo(() => {
    const m = new Map<string, AracWithRelations>();
    for (const a of araclar) m.set(a.id, a);
    return m;
  }, [araclar]);

  const santiyeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of santiyeler) m.set(s.id, s.is_adi);
    return m;
  }, [santiyeler]);

  // Limit map: arac_cinsi + sayac_tipi → limit
  const limitMap = useMemo(() => {
    const m = new Map<string, AracCinsiYakitLimit>();
    for (const l of limitler) m.set(`${l.arac_cinsi}|${l.sayac_tipi}`, l);
    return m;
  }, [limitler]);

  // Aracın genel kümülatif ortalaması hesaplama
  // (ilk kayıt hariç tüketilen lt) / (son km - ilk km)
  // Filtreler uygulanır: santiye + tarih aralığı (kullanıcı belirli bir kapsam istiyor)
  const aracGenelOrt = useMemo(() => {
    const m = new Map<string, number>();
    // aracId → sıralı kayıtlar (şantiye + tarih filtresi uygulanmış)
    const byArac = new Map<string, AracYakit[]>();
    for (const y of yakitKayitlari) {
      if (filtreSantiyeId && y.santiye_id !== filtreSantiyeId) continue;
      if (filtreBaslangic && y.tarih < filtreBaslangic) continue;
      if (filtreBitis && y.tarih > filtreBitis) continue;
      if (!byArac.has(y.arac_id)) byArac.set(y.arac_id, []);
      byArac.get(y.arac_id)!.push(y);
    }
    for (const [aracId, kayitlar] of byArac.entries()) {
      const sirali = [...kayitlar].sort((a, b) =>
        hareketKey(a).localeCompare(hareketKey(b)),
      );
      if (sirali.length < 2) continue;
      const ilk = sirali[0];
      const son = sirali[sirali.length - 1];
      const fark = son.km_saat - ilk.km_saat;
      if (fark <= 0) continue;
      const tuketilenLt = sirali.slice(1).reduce((s, k) => s + k.miktar_lt, 0);
      // Sayaç tipi km ise lt/100km, saat ise lt/saat
      const arac = aracMap.get(aracId);
      const carpan = arac?.sayac_tipi === "saat" ? 1 : 100;
      m.set(aracId, (tuketilenLt / fark) * carpan);
    }
    return m;
  }, [yakitKayitlari, aracMap, filtreSantiyeId, filtreBaslangic, filtreBitis]);

  // Aracın önceki kaydını bul (tarih+saat'ten önce)
  function oncekiAracKayit(aracId: string, tarih: string, saat: string, mevcutId?: string): AracYakit | null {
    const key = `${tarih}T${saat}`;
    let en: AracYakit | null = null;
    for (const y of yakitKayitlari) {
      if (y.arac_id !== aracId) continue;
      if (mevcutId && y.id === mevcutId) continue;
      if (hareketKey(y) >= key) continue;
      if (!en || hareketKey(y) > hareketKey(en)) en = y;
    }
    return en;
  }

  // Tüm hareketleri birleştir ve kümülatif depo stoğunu hesapla
  const tumHareketler = useMemo<Hareket[]>(() => {
    const hs: Hareket[] = [];
    for (const y of yakitKayitlari) {
      hs.push({
        tip: "arac_yakit",
        id: y.id,
        tarih: y.tarih,
        saat: y.saat,
        santiye_id: y.santiye_id,
        arac_id: y.arac_id,
        km_saat: y.km_saat,
        miktar_lt: y.miktar_lt,
        depo_full: y.depo_full ?? false,
        notu: y.notu,
        created_by: y.created_by,
      });
    }
    for (const a of alimlar) {
      hs.push({
        tip: "alim",
        id: a.id,
        tarih: a.tarih,
        saat: a.saat,
        santiye_id: a.santiye_id,
        tedarikci_firma: a.tedarikci_firma,
        miktar_lt: a.miktar_lt,
        birim_fiyat: a.birim_fiyat,
        notu: a.notu,
        created_by: a.created_by,
      });
    }
    for (const v of virmanlar) {
      hs.push({
        tip: "virman",
        id: v.id,
        tarih: v.tarih,
        saat: v.saat,
        gonderen_santiye_id: v.gonderen_santiye_id,
        alan_santiye_id: v.alan_santiye_id,
        miktar_lt: v.miktar_lt,
        notu: v.notu,
        created_by: v.created_by,
      });
    }
    return hs;
  }, [yakitKayitlari, alimlar, virmanlar]);

  // Her şantiye için her hareket sonrası stok (kümülatif ASC tarama)
  // Key: `${santiyeId}|${hareketId}` → stok
  const stokMap = useMemo(() => {
    const result = new Map<string, number>();
    const siraliAsc = [...tumHareketler].sort((a, b) =>
      hareketKey(a).localeCompare(hareketKey(b)),
    );
    // Şantiye bazlı kümülatif
    const cum = new Map<string, number>();
    for (const h of siraliAsc) {
      if (h.tip === "arac_yakit") {
        cum.set(h.santiye_id, (cum.get(h.santiye_id) ?? 0) - h.miktar_lt);
        result.set(`${h.santiye_id}|${h.id}`, cum.get(h.santiye_id)!);
      } else if (h.tip === "alim") {
        cum.set(h.santiye_id, (cum.get(h.santiye_id) ?? 0) + h.miktar_lt);
        result.set(`${h.santiye_id}|${h.id}`, cum.get(h.santiye_id)!);
      } else if (h.tip === "virman") {
        cum.set(h.gonderen_santiye_id, (cum.get(h.gonderen_santiye_id) ?? 0) - h.miktar_lt);
        cum.set(h.alan_santiye_id, (cum.get(h.alan_santiye_id) ?? 0) + h.miktar_lt);
        result.set(`${h.gonderen_santiye_id}|${h.id}`, cum.get(h.gonderen_santiye_id)!);
        result.set(`${h.alan_santiye_id}|${h.id}`, cum.get(h.alan_santiye_id)!);
      }
    }
    return result;
  }, [tumHareketler]);

  // Seçili şantiyenin SEÇİLİ TARİH ARALIĞINA kadar olan stoğu
  // (filtre tarih aralığının BİTİŞ tarihine kadar olan tüm hareketler kümülatif toplanır)
  // Bu sayede tarih aralığı geçmişe çekildiğinde "o dönemin sonundaki stok" görülür.
  const mevcutDepoStok = useMemo(() => {
    if (!filtreSantiyeId) return null;
    const siraliAsc = [...tumHareketler].sort((a, b) =>
      hareketKey(a).localeCompare(hareketKey(b)),
    );
    let stok = 0;
    for (const h of siraliAsc) {
      // Sadece bitiş tarihine kadar olan hareketler hesaba katılsın
      if (filtreBitis && h.tarih > filtreBitis) continue;
      if (h.tip === "arac_yakit" && h.santiye_id === filtreSantiyeId) stok -= h.miktar_lt;
      else if (h.tip === "alim" && h.santiye_id === filtreSantiyeId) stok += h.miktar_lt;
      else if (h.tip === "virman" && h.gonderen_santiye_id === filtreSantiyeId) stok -= h.miktar_lt;
      else if (h.tip === "virman" && h.alan_santiye_id === filtreSantiyeId) stok += h.miktar_lt;
    }
    return stok;
  }, [tumHareketler, filtreSantiyeId, filtreBitis]);

  // Filtrelenmiş + sıralanmış tablo satırları
  const tabloSatirlari = useMemo<TabloSatir[]>(() => {
    // Arama: "kamyon" → kamyon ve kamyonet ikisini de bulur (substring)
    //        "kamyon " (sondaki boşluk) → SADECE "kamyon" tam kelimesini bulur
    const aramaRaw = arama.toLowerCase();
    const tamKelime = aramaRaw.trim().length > 0 && aramaRaw !== aramaRaw.trimEnd();
    const aramaQ = aramaRaw.trim();
    let aramaRegex: RegExp | null = null;
    if (tamKelime && aramaQ) {
      const escaped = aramaQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Türkçe karakterleri de "harf" sayıyoruz; öncesi ve sonrası harf/rakam DEĞİL olmalı
      aramaRegex = new RegExp(`(^|[^a-z0-9çğıöşü])${escaped}([^a-z0-9çğıöşü]|$)`, "i");
    }

    // Şantiye admini için izinli şantiye seti
    const izinliSantiyeler = isShantiyeAdmin && kullanici?.santiye_ids
      ? new Set(kullanici.santiye_ids)
      : null;

    // Filter
    const filtrelenmis = tumHareketler.filter((h) => {
      // Şantiye admini: sadece atandığı şantiyelerin hareketleri
      if (izinliSantiyeler) {
        if (h.tip === "arac_yakit" || h.tip === "alim") {
          if (!izinliSantiyeler.has(h.santiye_id)) return false;
        } else if (h.tip === "virman") {
          if (!izinliSantiyeler.has(h.gonderen_santiye_id) && !izinliSantiyeler.has(h.alan_santiye_id)) return false;
        }
      }
      // Kısıtlı kullanıcı: sadece kendi kayıtlarını ve izinli tarih aralığını görsün
      if (sadeceKendiKayitlari && kullanici) {
        if (h.created_by !== kullanici.id) return false;
        if (!tarihIzinliMi(kullanici, h.tarih)) return false;
      }

      // Tarih aralığı (yönetici + şantiye admini için)
      // Boş tarih (geçersiz date input gibi) durumunda filtreyi atla
      if ((isYonetici || isShantiyeAdmin)) {
        if (filtreBaslangic && h.tarih < filtreBaslangic) return false;
        if (filtreBitis && h.tarih > filtreBitis) return false;
      }

      // Şantiye filtresi
      if (filtreSantiyeId) {
        if (h.tip === "arac_yakit" || h.tip === "alim") {
          if (h.santiye_id !== filtreSantiyeId) return false;
        } else if (h.tip === "virman") {
          if (h.gonderen_santiye_id !== filtreSantiyeId && h.alan_santiye_id !== filtreSantiyeId) return false;
        }
      }

      // Arama
      if (aramaQ) {
        let text = "";
        const tarihStr = h.tarih ? h.tarih.split("-").reverse().join(".") : "";
        if (h.tip === "arac_yakit") {
          const arac = aracMap.get(h.arac_id);
          text = [
            arac?.plaka, arac?.marka, arac?.model, arac?.cinsi,
            santiyeMap.get(h.santiye_id),
            h.notu, tarihStr,
            h.miktar_lt != null ? String(h.miktar_lt) : null,
            h.created_by ? kullaniciMap.get(h.created_by) : null,
          ].filter(Boolean).join(" ").toLowerCase();
        } else if (h.tip === "alim") {
          text = [
            h.tedarikci_firma,
            santiyeMap.get(h.santiye_id),
            h.notu, tarihStr,
            h.miktar_lt != null ? String(h.miktar_lt) : null,
            h.birim_fiyat != null ? String(h.birim_fiyat) : null,
            h.created_by ? kullaniciMap.get(h.created_by) : null,
          ].filter(Boolean).join(" ").toLowerCase();
        } else {
          text = [
            santiyeMap.get(h.gonderen_santiye_id),
            santiyeMap.get(h.alan_santiye_id),
            h.notu, tarihStr,
            h.miktar_lt != null ? String(h.miktar_lt) : null,
            h.created_by ? kullaniciMap.get(h.created_by) : null,
          ].filter(Boolean).join(" ").toLowerCase();
        }
        if (aramaRegex) {
          // Tam kelime eşleşmesi (boşluk ile sonlandırılmış arama)
          if (!aramaRegex.test(text)) return false;
        } else {
          // Substring eşleşmesi (varsayılan)
          if (!text.includes(aramaQ)) return false;
        }
      }

      return true;
    });

    // DESC sırala (en yeni üstte)
    filtrelenmis.sort((a, b) => hareketKey(b).localeCompare(hareketKey(a)));

    // Her satır için hesaplamalar — virman iki satıra ayrılır (giden + gelen)
    const sonuc: TabloSatir[] = [];
    for (const h of filtrelenmis) {
      if (h.tip === "virman") {
        // Giden satırı (gönderen şantiye)
        const gidenSantiyeId = h.gonderen_santiye_id;
        // Gelen satırı (alan şantiye)
        const gelenSantiyeId = h.alan_santiye_id;

        // Şantiye filtresi varsa sadece ilgili yönü göster, yoksa ikisini de
        const gidenGoster = !filtreSantiyeId || filtreSantiyeId === gidenSantiyeId;
        const gelenGoster = !filtreSantiyeId || filtreSantiyeId === gelenSantiyeId;

        if (gidenGoster) {
          sonuc.push({
            hareket: h, fark: null, anlikOrt: null, genelOrt: null,
            depoStok: stokMap.get(`${gidenSantiyeId}|${h.id}`) ?? null,
            limitAlt: null, limitUst: null, limitIhlali: false, birim: null,
            virmanYon: "giden", satirKey: `virman-giden-${h.id}`,
          });
        }
        if (gelenGoster) {
          sonuc.push({
            hareket: h, fark: null, anlikOrt: null, genelOrt: null,
            depoStok: stokMap.get(`${gelenSantiyeId}|${h.id}`) ?? null,
            limitAlt: null, limitUst: null, limitIhlali: false, birim: null,
            virmanYon: "gelen", satirKey: `virman-gelen-${h.id}`,
          });
        }
        continue;
      }

      // Araç yakıt ve alım — tek satır
      const satir: TabloSatir = {
        hareket: h,
        fark: null,
        anlikOrt: null,
        genelOrt: null,
        depoStok: null,
        limitAlt: null,
        limitUst: null,
        limitIhlali: false,
        birim: null,
        virmanYon: null,
        satirKey: `${h.tip}-${h.id}`,
      };

      // Depo stoğu
      if (filtreSantiyeId) {
        satir.depoStok = stokMap.get(`${filtreSantiyeId}|${h.id}`) ?? null;
      } else if (h.tip === "arac_yakit" || h.tip === "alim") {
        satir.depoStok = stokMap.get(`${h.santiye_id}|${h.id}`) ?? null;
      }

      // Araç yakıt hesaplamaları
      if (h.tip === "arac_yakit") {
        const arac = aracMap.get(h.arac_id);
        satir.birim = arac?.sayac_tipi ?? null;
        const onceki = oncekiAracKayit(h.arac_id, h.tarih, h.saat, h.id);
        if (onceki) {
          const fark = h.km_saat - onceki.km_saat;
          satir.fark = fark;
          if (fark > 0) {
            // Sayaç tipi km ise lt/100km, saat ise lt/saat
            const carpan = arac?.sayac_tipi === "saat" ? 1 : 100;
            satir.anlikOrt = (h.miktar_lt / fark) * carpan;
          }
        }
        satir.genelOrt = aracGenelOrt.get(h.arac_id) ?? null;

        // Limit kontrolü — oran bazlı: genel ortalama / anlık ortalama
        // Alt ≤ (genelOrt / anlikOrt) ≤ Üst → limit içinde
        // Dışındaysa → limit dışı (örn. anlık, genel ortalamadan çok farklıysa anomali)
        if (arac?.cinsi && arac.sayac_tipi) {
          const limit = limitMap.get(`${arac.cinsi}|${arac.sayac_tipi}`);
          if (limit) {
            satir.limitAlt = limit.alt_sinir;
            satir.limitUst = limit.ust_sinir;
            if (satir.anlikOrt !== null && satir.anlikOrt > 0 && satir.genelOrt !== null && satir.genelOrt > 0) {
              const oran = satir.genelOrt / satir.anlikOrt;
              if (oran < limit.alt_sinir || oran > limit.ust_sinir) {
                satir.limitIhlali = true;
              }
            }
          }
        }
      }

      sonuc.push(satir);
    }
    // "Sadece limit dışı" filtresi: araç yakıt + limit ihlali olan satırları bırak
    if (sadeceLimitDisi) {
      return sonuc.filter((s) => s.hareket.tip === "arac_yakit" && s.limitIhlali);
    }
    return sonuc;
  }, [
    tumHareketler, filtreSantiyeId, filtreBaslangic, filtreBitis, arama,
    aracMap, santiyeMap, stokMap, limitMap, aracGenelOrt, kullaniciMap,
    isYonetici, isShantiyeAdmin, sadeceKendiKayitlari, kullanici, sadeceLimitDisi,
  ]);

  // Dönem özet kartları
  const donemOzet = useMemo(() => {
    let toplamAlim = 0;
    let toplamDagitim = 0;
    let virmanGelen = 0;
    let virmanGiden = 0;
    for (const s of tabloSatirlari) {
      const h = s.hareket;
      if (h.tip === "alim") toplamAlim += h.miktar_lt;
      else if (h.tip === "arac_yakit") toplamDagitim += h.miktar_lt;
      else if (h.tip === "virman") {
        if (s.virmanYon === "gelen") virmanGelen += h.miktar_lt;
        else if (s.virmanYon === "giden") virmanGiden += h.miktar_lt;
      }
    }
    return { toplamAlim, toplamDagitim, virmanGelen, virmanGiden, virmanNet: virmanGelen - virmanGiden };
  }, [tabloSatirlari]);

  // ============ DIALOG AÇMA FONKSİYONLARI ============

  function verDialogAc() {
    setVerEditId(null);
    setVerDialogSantiyeId(filtreSantiyeId || "");
    setVerDialogAracId("");
    const bugunStr = new Date().toISOString().slice(0, 10);
    setVerDialogTarih(bugunStr);
    const simdi = new Date();
    setVerDialogSaat(`${String(simdi.getHours()).padStart(2, "0")}:${String(simdi.getMinutes()).padStart(2, "0")}`);
    setVerDialogKmSaat("");
    setVerDialogMiktar("");
    setVerDialogNotu("");
    setVerDialogDepoFull(true);
    setVerDialogOpen(true);
  }

  function verDialogDuzenleAc(y: AracYakit) {
    setVerEditId(y.id);
    setVerDialogSantiyeId(y.santiye_id);
    setVerDialogAracId(y.arac_id);
    setVerDialogTarih(y.tarih);
    setVerDialogSaat(y.saat.slice(0, 5));
    setVerDialogKmSaat(String(y.km_saat));
    setVerDialogMiktar(String(y.miktar_lt));
    setVerDialogNotu(y.notu ?? "");
    setVerDialogDepoFull(y.depo_full ?? false);
    setVerDialogOpen(true);
  }

  function alDialogAc() {
    setAlEditId(null);
    setAlDialogSantiyeId(filtreSantiyeId || "");
    const bugunStr = new Date().toISOString().slice(0, 10);
    setAlDialogTarih(bugunStr);
    const simdi = new Date();
    setAlDialogSaat(`${String(simdi.getHours()).padStart(2, "0")}:${String(simdi.getMinutes()).padStart(2, "0")}`);
    setAlDialogFirma("");
    setAlDialogMiktar("");
    setAlDialogBirimFiyat("");
    setAlDialogToplam("");
    setAlDialogNotu("");
    setAlDialogOpen(true);
  }

  function alDialogDuzenleAc(a: YakitAlim) {
    setAlEditId(a.id);
    setAlDialogSantiyeId(a.santiye_id);
    setAlDialogTarih(a.tarih);
    setAlDialogSaat(a.saat.slice(0, 5));
    setAlDialogFirma(a.tedarikci_firma);
    setAlDialogMiktar(formatParaInput(String(a.miktar_lt).replace(".", ",")));
    setAlDialogBirimFiyat(formatParaInput(a.birim_fiyat.toFixed(6).replace(".", ","), 6));
    setAlDialogToplam(formatParaInput((a.miktar_lt * a.birim_fiyat).toFixed(2).replace(".", ",")));
    setAlDialogNotu(a.notu ?? "");
    setAlDialogOpen(true);
  }

  function virDialogAc() {
    setVirEditId(null);
    setVirDialogGonderen(filtreSantiyeId || "");
    setVirDialogAlan("");
    const bugunStr = new Date().toISOString().slice(0, 10);
    setVirDialogTarih(bugunStr);
    const simdi = new Date();
    setVirDialogSaat(`${String(simdi.getHours()).padStart(2, "0")}:${String(simdi.getMinutes()).padStart(2, "0")}`);
    setVirDialogMiktar("");
    setVirDialogNotu("");
    setVirDialogOpen(true);
  }

  function virDialogDuzenleAc(v: YakitVirman) {
    setVirEditId(v.id);
    setVirDialogGonderen(v.gonderen_santiye_id);
    setVirDialogAlan(v.alan_santiye_id);
    setVirDialogTarih(v.tarih);
    setVirDialogSaat(v.saat.slice(0, 5));
    setVirDialogMiktar(String(v.miktar_lt));
    setVirDialogNotu(v.notu ?? "");
    setVirDialogOpen(true);
  }

  // ============ KAYDETME FONKSİYONLARI ============

  async function verKaydet() {
    if (verEditId ? !yDuzenle : !yEkle) { toast.error(verEditId ? "Düzenleme yetkiniz yok." : "Ekleme yetkiniz yok."); return; }
    if (!verDialogSantiyeId) { toast.error("Şantiye seçin."); return; }
    if (!verDialogAracId) { toast.error("Araç seçin."); return; }
    if (!verDialogTarih) { toast.error("Tarih girin."); return; }
    if (!tarihIzinliMi(kullanici, verDialogTarih)) {
      toast.error(`Bu tarihe işlem yapamazsınız. Geriye dönük en fazla ${kullanici?.geriye_donus_gun ?? 0} gün izniniz var.`);
      return;
    }

    const kmStr = verDialogKmSaat.replace(",", ".").trim();
    if (!kmStr) { toast.error("KM/Saat değeri girin."); return; }
    const km = parseFloat(kmStr);
    if (isNaN(km) || km < 0) { toast.error("Geçerli bir KM/Saat değeri girin."); return; }

    const miktar = parseParaInput(verDialogMiktar);
    if (miktar <= 0) { toast.error("Geçerli bir miktar girin."); return; }

    // KM/Saat validasyonu: son kayıttan küçük olamaz (edit modunda mevcut kayıt hariç)
    // Yönetici için kısıtlama yok — eskiye dönük veri girebilir.
    // Bozuk sayaç senaryosu: ya baştan 0 olur (önceki=0, yeni=0 kabul) ya da bozulduğu
    // değerde kalır (önceki=50000, yeni=50000 kabul). Asla DÜŞMEZ — bu yüzden eşitlik OK,
    // küçülme bloklu.
    if (!isYonetici) {
      const sonKayitlar = yakitKayitlari
        .filter((y) => y.arac_id === verDialogAracId && y.id !== verEditId)
        .sort((a, b) => hareketKey(b).localeCompare(hareketKey(a)));
      const son = sonKayitlar.length > 0 ? sonKayitlar[0] : null;
      if (son && km < son.km_saat) {
        const arac = aracMap.get(verDialogAracId);
        const birim = arac?.sayac_tipi === "saat" ? "saat" : "km";
        toast.error(
          `Girilen ${birim} değeri (${formatSayi(km, 0)}) son kayıttaki değerden (${formatSayi(son.km_saat, 0)}) küçük olamaz.`,
          { duration: 8000 },
        );
        return;
      }
    }

    setVerDialogLoading(true);
    try {
      if (verEditId) {
        await updateAracYakit(verEditId, {
          arac_id: verDialogAracId,
          santiye_id: verDialogSantiyeId,
          tarih: verDialogTarih,
          km_saat: km,
          miktar_lt: miktar,
          depo_full: verDialogDepoFull,
          notu: verDialogNotu.trim() || null,
        });
      } else {
        const simdi = new Date();
        const saatStr = `${String(simdi.getHours()).padStart(2, "0")}:${String(simdi.getMinutes()).padStart(2, "0")}:${String(simdi.getSeconds()).padStart(2, "0")}`;
        await insertAracYakit({
          arac_id: verDialogAracId,
          santiye_id: verDialogSantiyeId,
          tarih: verDialogTarih,
          saat: saatStr,
          km_saat: km,
          miktar_lt: miktar,
          depo_full: verDialogDepoFull,
          notu: verDialogNotu.trim() || null,
          created_by: kullanici?.id ?? null,
        });
      }
      // Araçın güncel göstergesini güncelle (km > 0 ise)
      // RLS bypass için server-side API route kullanıyoruz — kısıtlı kullanıcı
      // araclar tablosunu doğrudan update edemese de bu route service role ile yazar.
      if (km > 0) {
        try {
          await fetch("/api/arac-gosterge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ arac_id: verDialogAracId, km }),
          });
        } catch (e) {
          console.warn("Araç göstergesi güncellenemedi:", e);
        }
      }
      await loadAll();
      toast.success(verEditId ? "Yakıt kaydı güncellendi." : "Yakıt kaydı eklendi.");
      setVerDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("arac_yakit tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 8000 });
      } else {
        toast.error(`Kaydetme hatası: ${msg}`, { duration: 6000 });
      }
    } finally {
      setVerDialogLoading(false);
    }
  }

  async function alKaydet() {
    if (alEditId ? !yDuzenle : !yEkle) { toast.error(alEditId ? "Düzenleme yetkiniz yok." : "Ekleme yetkiniz yok."); return; }
    if (!alDialogSantiyeId) { toast.error("Şantiye seçin."); return; }
    if (!alDialogTarih) { toast.error("Tarih girin."); return; }
    if (!tarihIzinliMi(kullanici, alDialogTarih)) {
      toast.error(`Bu tarihe işlem yapamazsınız. Geriye dönük en fazla ${kullanici?.geriye_donus_gun ?? 0} gün izniniz var.`);
      return;
    }
    if (!alDialogSaat) { toast.error("Saat girin."); return; }
    if (!alDialogFirma.trim()) { toast.error("Tedarikçi firma girin."); return; }

    const miktar = parseParaInput(alDialogMiktar);
    if (miktar <= 0) { toast.error("Geçerli bir miktar girin."); return; }

    const birimFiyat = parseParaInput(alDialogBirimFiyat);
    if (birimFiyat < 0) { toast.error("Geçerli bir birim fiyat girin."); return; }

    setAlDialogLoading(true);
    try {
      if (alEditId) {
        await updateYakitAlim(alEditId, {
          santiye_id: alDialogSantiyeId,
          tarih: alDialogTarih,
          tedarikci_firma: formatBaslik(alDialogFirma.trim()),
          miktar_lt: miktar,
          birim_fiyat: birimFiyat,
          notu: alDialogNotu.trim() || null,
        });
      } else {
        const simdi = new Date();
        const saatStr = `${String(simdi.getHours()).padStart(2, "0")}:${String(simdi.getMinutes()).padStart(2, "0")}:${String(simdi.getSeconds()).padStart(2, "0")}`;
        await insertYakitAlim({
          santiye_id: alDialogSantiyeId,
          tarih: alDialogTarih,
          saat: saatStr,
          tedarikci_firma: formatBaslik(alDialogFirma.trim()),
          miktar_lt: miktar,
          birim_fiyat: birimFiyat,
          notu: alDialogNotu.trim() || null,
          created_by: kullanici?.id ?? null,
        });
      }
      await loadAll();
      toast.success(alEditId ? "Yakıt alımı güncellendi." : "Yakıt alımı kaydedildi.");
      setAlDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("yakit_alim tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 8000 });
      } else {
        toast.error(`Kaydetme hatası: ${msg}`, { duration: 6000 });
      }
    } finally {
      setAlDialogLoading(false);
    }
  }

  async function virKaydet() {
    if (virEditId ? !yDuzenle : !yEkle) { toast.error(virEditId ? "Düzenleme yetkiniz yok." : "Ekleme yetkiniz yok."); return; }
    if (!virDialogGonderen) { toast.error("Gönderen şantiye seçin."); return; }
    if (!virDialogAlan) { toast.error("Alan şantiye seçin."); return; }
    if (virDialogGonderen === virDialogAlan) { toast.error("Gönderen ve alan şantiye aynı olamaz."); return; }
    if (!virDialogTarih) { toast.error("Tarih girin."); return; }
    if (!tarihIzinliMi(kullanici, virDialogTarih)) {
      toast.error(`Bu tarihe işlem yapamazsınız. Geriye dönük en fazla ${kullanici?.geriye_donus_gun ?? 0} gün izniniz var.`);
      return;
    }
    if (!virDialogSaat) { toast.error("Saat girin."); return; }

    const miktar = parseParaInput(virDialogMiktar);
    if (isNaN(miktar) || miktar <= 0) { toast.error("Geçerli bir miktar girin."); return; }

    setVirDialogLoading(true);
    try {
      if (virEditId) {
        await updateYakitVirman(virEditId, {
          gonderen_santiye_id: virDialogGonderen,
          alan_santiye_id: virDialogAlan,
          tarih: virDialogTarih,
          miktar_lt: miktar,
          notu: virDialogNotu.trim() || null,
        });
      } else {
        const simdi = new Date();
        const saatStr = `${String(simdi.getHours()).padStart(2, "0")}:${String(simdi.getMinutes()).padStart(2, "0")}:${String(simdi.getSeconds()).padStart(2, "0")}`;
        await insertYakitVirman({
          gonderen_santiye_id: virDialogGonderen,
          alan_santiye_id: virDialogAlan,
          tarih: virDialogTarih,
          saat: saatStr,
          miktar_lt: miktar,
          notu: virDialogNotu.trim() || null,
          created_by: kullanici?.id ?? null,
        });
      }
      await loadAll();
      toast.success(virEditId ? "Virman güncellendi." : "Virman kaydedildi.");
      setVirDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("yakit_virman tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 8000 });
      } else {
        toast.error(`Kaydetme hatası: ${msg}`, { duration: 6000 });
      }
    } finally {
      setVirDialogLoading(false);
    }
  }

  async function silOnayla() {
    if (!silOnay) return;
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    try {
      if (silOnay.tip === "arac_yakit") await deleteAracYakit(silOnay.id);
      else if (silOnay.tip === "alim") await deleteYakitAlim(silOnay.id);
      else await deleteYakitVirman(silOnay.id);
      await loadAll();
      toast.success("Kayıt silindi.");
      setSilOnay(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Silme hatası: ${msg}`);
    }
  }

  // Yakıt Ver dialogunda: seçili aracın son kaydı (bilgi için, edit modunda düzenlenen kayıt hariç)
  const verDialogSonKayit = useMemo(() => {
    if (!verDialogAracId) return null;
    const kayitlar = yakitKayitlari
      .filter((y) => y.arac_id === verDialogAracId && y.id !== verEditId)
      .sort((a, b) => hareketKey(b).localeCompare(hareketKey(a)));
    return kayitlar[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verDialogAracId, verEditId, yakitKayitlari]);

  // Seçili şantiyedeki aktif araçlar
  const verDialogAraclari = useMemo(() => {
    if (!verDialogSantiyeId) return [] as AracWithRelations[];
    return araclar
      .filter((a) => (a.durum ?? "aktif") === "aktif" && a.santiye_id === verDialogSantiyeId)
      .sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));
  }, [araclar, verDialogSantiyeId]);

  // ============ EXPORT ============

  function exportPDF() {
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
    const santiyeAdi = filtreSantiyeId ? (santiyeMap.get(filtreSantiyeId) ?? "") : "Tum Santiyeler";
    doc.text(`Yakit Raporu - ${tr(santiyeAdi)}`, 14, 12);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`${filtreBaslangic} - ${filtreBitis}`, 14, 17);

    const head = [[
      "Tarih/Saat", "Santiye", "Arac/Kaynak", "Gosterge", "Fark",
      "Miktar", "Anlik Ort.", "Genel Ort.", "Stok", "Kullanıcı Adı",
    ]];
    const body = tabloSatirlari.map((s) => {
      const h = s.hareket;
      const santiyeText = h.tip === "virman"
        ? `${tr(santiyeMap.get(h.gonderen_santiye_id) ?? "-")} -> ${tr(santiyeMap.get(h.alan_santiye_id) ?? "-")}`
        : tr(santiyeMap.get(h.santiye_id) ?? "-");
      let aracText = "-";
      if (h.tip === "arac_yakit") {
        const arac = aracMap.get(h.arac_id);
        aracText = arac ? `${arac.plaka} ${tr([arac.marka, arac.model].filter(Boolean).join(" "))}` : "-";
      } else if (h.tip === "alim") {
        aracText = tr(h.tedarikci_firma);
      } else {
        aracText = "Virman";
      }
      const kmSaatText = h.tip === "arac_yakit" ? formatSayi(h.km_saat, 0) : "-";
      const farkText = s.fark !== null ? formatSayi(s.fark, 0) : "-";
      let miktarText: string;
      if (h.tip === "arac_yakit") miktarText = "-" + formatSayi(h.miktar_lt, 2);
      else if (h.tip === "alim") miktarText = "+" + formatSayi(h.miktar_lt, 2);
      else miktarText = (s.virmanYon === "giden" ? "-" : "+") + formatSayi(h.miktar_lt, 2);
      const anlikText = s.anlikOrt !== null ? formatSayi(s.anlikOrt, 2) + (s.limitIhlali ? " !" : "") : "-";
      const genelText = s.genelOrt !== null ? formatSayi(s.genelOrt, 2) : "-";
      const stokText = s.depoStok !== null ? formatSayi(s.depoStok, 0) : "-";
      const girenText = h.created_by ? tr(kullaniciMap.get(h.created_by) ?? "-") : "-";
      return [
        `${h.tarih ? h.tarih.split("-").reverse().join(".") : "—"} ${h.saat.slice(0, 5)}`,
        santiyeText,
        aracText,
        kmSaatText,
        farkText,
        miktarText,
        anlikText,
        genelText,
        stokText,
        girenText,
      ];
    });

    autoTable(doc, {
      startY: 22,
      head,
      body,
      styles: { fontSize: 7, cellPadding: 1, overflow: "ellipsize", valign: "middle" },
      headStyles: { fillColor: [30, 58, 95], fontSize: 7, textColor: 255, halign: "center" },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 36, overflow: "ellipsize" },
        2: { cellWidth: 44, overflow: "ellipsize" },
        3: { cellWidth: 18, halign: "right" },
        4: { cellWidth: 16, halign: "right" },
        5: { cellWidth: 20, halign: "right" },
        6: { cellWidth: 22, halign: "right" },
        7: { cellWidth: 22, halign: "right" },
        8: { cellWidth: 24, halign: "right" },
        9: { cellWidth: 32, overflow: "ellipsize" },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section !== "body") return;
        const s = tabloSatirlari[data.row.index];
        if (!s) return;
        const h = s.hareket;
        // Miktar renklendirmesi (sütun 5)
        if (data.column.index === 5) {
          data.cell.styles.fontStyle = "bold";
          if (h.tip === "arac_yakit") data.cell.styles.textColor = [220, 38, 38]; // kırmızı
          else if (h.tip === "alim") data.cell.styles.textColor = [29, 78, 216]; // mavi
          else data.cell.styles.textColor = [0, 0, 0]; // siyah (virman giden/gelen)
        }
        // Limit ihlali (sütun 6)
        if (data.column.index === 6 && s.limitIhlali) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    // Özet
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    let y = finalY;
    doc.text(`Toplam Alim: ${formatSayi(donemOzet.toplamAlim, 2)} lt`, 14, y); y += 5;
    doc.text(`Toplam Dagitim: ${formatSayi(donemOzet.toplamDagitim, 2)} lt`, 14, y); y += 5;
    if (filtreSantiyeId) {
      doc.text(`Virman Net: ${formatSayi(donemOzet.virmanNet, 2)} lt`, 14, y); y += 5;
      if (mevcutDepoStok !== null) {
        doc.text(`Mevcut Stok: ${formatSayi(mevcutDepoStok, 2)} lt`, 14, y);
      }
    }

    doc.save(`yakit-raporu-${santiyeAdi.replace(/\s+/g, "-")}-${filtreBaslangic}-${filtreBitis}.pdf`);
  }

  function exportExcel() {
    const headers = [
      "Tarih", "Saat", "Şantiye", "Araç / Kaynak", "Gösterge", "Fark",
      "Miktar (lt)", "Anlık Ort.", "Genel Ort.",
      "Depo Stok", "Kullanıcı Adı", "Not",
    ];
    const data = tabloSatirlari.map((s) => {
      const h = s.hareket;
      const santiyeText = h.tip === "virman"
        ? `${santiyeMap.get(h.gonderen_santiye_id) ?? "-"} → ${santiyeMap.get(h.alan_santiye_id) ?? "-"}`
        : (santiyeMap.get(h.santiye_id) ?? "-");
      let aracText = "";
      if (h.tip === "arac_yakit") {
        const arac = aracMap.get(h.arac_id);
        aracText = arac ? `${arac.plaka} ${[arac.marka, arac.model].filter(Boolean).join(" ")}` : "";
      } else if (h.tip === "alim") {
        aracText = h.tedarikci_firma;
      } else {
        aracText = "Virman";
      }
      return [
        h.tarih ? h.tarih.split("-").reverse().join(".") : "—",
        h.saat.slice(0, 5),
        santiyeText,
        aracText,
        h.tip === "arac_yakit" ? h.km_saat : "",
        s.fark ?? "",
        h.miktar_lt,
        s.anlikOrt !== null ? Number(s.anlikOrt.toFixed(3)) : "",
        s.genelOrt !== null ? Number(s.genelOrt.toFixed(3)) : "",
        s.depoStok !== null ? Number(s.depoStok.toFixed(2)) : "",
        h.created_by ? (kullaniciMap.get(h.created_by) ?? "") : "",
        h.notu ?? "",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Yakit");
    const santiyeAdi = filtreSantiyeId ? (santiyeMap.get(filtreSantiyeId) ?? "") : "tum";
    XLSX.writeFile(wb, `yakit-raporu-${santiyeAdi.replace(/\s+/g, "-")}-${filtreBaslangic}-${filtreBitis}.xlsx`);
  }

  // ============ RENDER ============

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Fuel size={24} /> Yakıt
        </h1>
        {(isYonetici || isShantiyeAdmin) && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Kiralık Araç Ekle: yakıt VEYA yönetim/araçlar "ekle" yetkisinden biri yeterli */}
            {(yEkle || hasPermission("yonetim-araclar", "ekle") || hasPermission("puantaj-arac", "ekle")) && (
              <Button variant="outline" size="sm" onClick={() => setYakitKiralikDialogOpen(true)}>
                <Truck size={14} className="mr-1" /> Kiralık Araç Ekle
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportPDF} disabled={tabloSatirlari.length === 0}>
              <FileDown size={14} className="mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={tabloSatirlari.length === 0}>
              <FileSpreadsheet size={14} className="mr-1" /> Excel
            </Button>
          </div>
        )}
      </div>

      {/* Filtre barı */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 space-y-3">
        {(isYonetici || isShantiyeAdmin) && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Şantiye</Label>
              {(() => {
                // Sadece işlemi olan (alım, dağıtım veya virman) şantiyeleri göster
                const islemliIds = new Set<string>();
                for (const a of alimlar) islemliIds.add(a.santiye_id);
                for (const d of yakitKayitlari) islemliIds.add(d.santiye_id);
                for (const v of virmanlar) { islemliIds.add(v.gonderen_santiye_id); islemliIds.add(v.alan_santiye_id); }
                const islemliSantiyeler = filtreliSantiyeler(santiyeler, kullanici).filter((s) => islemliIds.has(s.id));
                return <SantiyeSelect santiyeler={islemliSantiyeler} value={filtreSantiyeId} onChange={setFiltreSantiyeId} showAll className={selectClass + " w-full"} />;
              })()}
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Başlangıç</Label>
              <input
                type="date"
                value={filtreBaslangic}
                onChange={(e) => setFiltreBaslangic(e.target.value)}
                className={selectClass + " w-full"}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Bitiş</Label>
              <input
                type="date"
                value={filtreBitis}
                onChange={(e) => setFiltreBitis(e.target.value)}
                className={selectClass + " w-full"}
              />
            </div>
            <div className="flex gap-1 items-end">
              {[{ l: "Bu Ay", a: 1 }, { l: "3 Ay", a: 3 }, { l: "6 Ay", a: 6 }, { l: "1 Yıl", a: 12 }].map((b) => (
                <button key={b.l} type="button" onClick={() => {
                  const bitis = new Date();
                  const baslangic = new Date();
                  if (b.a === 1) {
                    // "Bu Ay" → bu ayın 1'i ile bugün
                    baslangic.setDate(1);
                  } else {
                    // "3 Ay" / "6 Ay" / "1 Yıl" → a ay önceki tarihten bugüne
                    baslangic.setMonth(baslangic.getMonth() - b.a);
                  }
                  setFiltreBaslangic(baslangic.toISOString().slice(0, 10));
                  setFiltreBitis(bitis.toISOString().slice(0, 10));
                }}
                  className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
                  {b.l}
                </button>
              ))}
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label className="text-[10px] text-gray-500">Arama</Label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={arama}
                  onChange={(e) => setArama(e.target.value)}
                  placeholder="Ara... (sonuna boşluk bırak: tam kelime)"
                  className={selectClass + " w-full pl-8"}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">&nbsp;</Label>
              <button
                type="button"
                onClick={() => setSadeceLimitDisi((v) => !v)}
                className={`h-9 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors w-full justify-center ${
                  sadeceLimitDisi
                    ? "bg-amber-500 border-amber-600 text-white hover:bg-amber-600"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300"
                }`}
                title={sadeceLimitDisi ? "Tüm hareketleri göster" : "Sadece limit dışı (anomali) kayıtları göster"}
              >
                <AlertTriangle size={14} />
                {sadeceLimitDisi ? "Limit Dışı (Aktif)" : "Sadece Limit Dışı"}
              </button>
            </div>
          </div>
        )}

        {yEkle && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full sm:w-auto">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white h-11 text-sm" onClick={verDialogAc}>
              <Plus size={16} className="mr-1.5" /> Yakıt Ver
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white h-11 text-sm" onClick={alDialogAc}>
              <Download size={16} className="mr-1.5" /> Yakıt Al (Depo)
            </Button>
            <Button className="bg-purple-600 hover:bg-purple-700 text-white h-11 text-sm" onClick={virDialogAc}>
              <RefreshCcw size={16} className="mr-1.5" /> Şantiye Virmanı
            </Button>
          </div>
        )}
      </div>

      {/* Özet kartları — sadece yönetici */}
      {(isYonetici || isShantiyeAdmin) && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-[10px] text-gray-500 uppercase font-semibold">Mevcut Depo Stoğu</div>
          <div className={`text-xl font-bold ${mevcutDepoStok !== null && mevcutDepoStok < 0 ? "text-red-600" : "text-[#1E3A5F]"}`}>
            {mevcutDepoStok !== null ? formatLt(mevcutDepoStok) : "—"}
          </div>
          <div className="text-[10px] text-gray-400">{filtreSantiyeId ? "Seçili şantiye" : "Şantiye seçin"}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-[10px] text-gray-500 uppercase font-semibold">Dönem Alımı</div>
          <div className="text-xl font-bold text-blue-700">{formatLt(donemOzet.toplamAlim)}</div>
          <div className="text-[10px] text-gray-400">Depoya gelen</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-[10px] text-gray-500 uppercase font-semibold">Dönem Dağıtımı</div>
          <div className="text-xl font-bold text-emerald-700">{formatLt(donemOzet.toplamDagitim)}</div>
          <div className="text-[10px] text-gray-400">Araçlara verilen</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-[10px] text-gray-500 uppercase font-semibold">Virman</div>
          <div className="flex items-baseline gap-2">
            <div>
              <span className="text-sm font-bold text-emerald-700">+{formatMiktar(donemOzet.virmanGelen)}</span>
              <span className="text-[9px] text-gray-400 ml-0.5">gelen</span>
            </div>
            <div>
              <span className="text-sm font-bold text-red-600">−{formatMiktar(donemOzet.virmanGiden)}</span>
              <span className="text-[9px] text-gray-400 ml-0.5">giden</span>
            </div>
          </div>
          <div className={`text-lg font-bold ${donemOzet.virmanNet < 0 ? "text-red-600" : "text-purple-700"}`}>
            Net: {formatLt(donemOzet.virmanNet)}
          </div>
        </div>
      </div>}

      {/* Kısıtlı kullanıcı bilgi notu (şantiye admini görmesin) */}
      {sadeceKendiKayitlari && kullanici && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4 text-xs text-amber-800">
          Sadece kendi girdiğiniz kayıtları görebilirsiniz{kullanici.geriye_donus_gun != null ? ` (son ${kullanici.geriye_donus_gun} gün)` : ""}.
        </div>
      )}

      {/* Ana tablo */}
      {loading ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200 text-gray-500">
          Yükleniyor...
        </div>
      ) : tabloSatirlari.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Fuel size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Bu kriterlere uygun yakıt kaydı bulunamadı.</p>
          <p className="text-[11px] text-gray-400 mt-1">Filtreleri değiştirin veya yeni kayıt ekleyin.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2 whitespace-nowrap">Tarih/Saat</TableHead>
                <TableHead className="text-white text-[11px] px-2 min-w-[180px]">Araç / Kaynak</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[80px]">Gösterge</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[70px]">Fark</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[90px]">Miktar</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[90px]">Anlık Ort.</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[90px]">Genel Ort.</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[70px] bg-[#0f2540]">Stok</TableHead>
                <TableHead className="text-white text-[11px] px-2 min-w-[120px]">Kullanıcı Adı</TableHead>
                <TableHead className="text-white text-[11px] px-2 min-w-[120px]">Not</TableHead>
                {(yDuzenle || ySil) && <TableHead className="text-white text-[11px] px-2 text-center w-[70px]">İşlem</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabloSatirlari.map((s) => {
                const h = s.hareket;
                const birimEki = s.birim === "saat" ? " L/s" : s.birim === "km" ? " L/100km" : "";

                let aracKaynakText: React.ReactNode = "—";
                if (h.tip === "arac_yakit") {
                  const arac = aracMap.get(h.arac_id);
                  if (arac) {
                    aracKaynakText = (
                      <div>
                        <div className="font-bold">{arac.plaka}</div>
                        <div className="text-[10px] text-gray-500 truncate max-w-[180px]">
                          {[arac.marka, arac.model, arac.cinsi].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    );
                  }
                } else if (h.tip === "alim") {
                  aracKaynakText = (
                    <div>
                      <div className="font-semibold text-gray-700">{h.tedarikci_firma}</div>
                      <div className="text-[10px] text-gray-500">Tedarikçi</div>
                    </div>
                  );
                } else if (h.tip === "virman") {
                  if (s.virmanYon === "giden") {
                    aracKaynakText = (
                      <div>
                        <div className="font-semibold text-red-700">→ {santiyeMap.get(h.alan_santiye_id) ?? "—"}</div>
                        <div className="text-[10px] text-gray-500">Giden virman · {santiyeMap.get(h.gonderen_santiye_id) ?? ""}</div>
                      </div>
                    );
                  } else {
                    aracKaynakText = (
                      <div>
                        <div className="font-semibold text-emerald-700">← {santiyeMap.get(h.gonderen_santiye_id) ?? "—"}</div>
                        <div className="text-[10px] text-gray-500">Gelen virman · {santiyeMap.get(h.alan_santiye_id) ?? ""}</div>
                      </div>
                    );
                  }
                }

                const rowRenk =
                  h.tip === "arac_yakit" ? "border-l-4 border-l-emerald-400" :
                  h.tip === "alim" ? "border-l-4 border-l-blue-400" :
                  s.virmanYon === "giden" ? "border-l-4 border-l-red-400" :
                  "border-l-4 border-l-purple-400";
                return (
                  <TableRow key={s.satirKey} className={`hover:bg-gray-50 ${rowRenk}`}>
                    <TableCell className="px-2 whitespace-nowrap">
                      <div className="text-[11px] font-semibold">{h.tarih ? h.tarih.split("-").reverse().join(".") : "—"}</div>
                      <div className="text-[10px] text-gray-500">{h.saat.slice(0, 5)}</div>
                    </TableCell>
                    <TableCell className="px-2 max-w-[140px]">
                      <div className="truncate" style={{ maxWidth: "20ch" }} title={
                        h.tip === "arac_yakit"
                          ? `${aracMap.get(h.arac_id)?.plaka ?? ""} ${[aracMap.get(h.arac_id)?.marka, aracMap.get(h.arac_id)?.model, aracMap.get(h.arac_id)?.cinsi].filter(Boolean).join(" · ")}`
                          : h.tip === "alim" ? h.tedarikci_firma
                          : h.tip === "virman" ? (s.virmanYon === "giden" ? `→ ${santiyeMap.get(h.alan_santiye_id) ?? ""}` : `← ${santiyeMap.get(h.gonderen_santiye_id) ?? ""}`)
                          : ""
                      }>
                        {aracKaynakText}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 text-right">
                      {h.tip === "arac_yakit" ? (
                        <span className="font-semibold">
                          {formatSayi(h.km_saat, 0)}
                          <span className="text-[9px] text-gray-400 ml-0.5">{aracMap.get(h.arac_id)?.sayac_tipi === "saat" ? "s" : "km"}</span>
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-right text-gray-600">
                      {s.fark !== null ? `+${formatSayi(s.fark, 0)}` : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-right font-semibold">
                      {h.tip === "arac_yakit" ? (
                        <span className="text-emerald-700">−{formatMiktar(h.miktar_lt)}{h.depo_full && <span className="ml-1 text-[9px] bg-emerald-100 text-emerald-700 px-1 rounded font-bold">F</span>}</span>
                      ) : h.tip === "alim" ? (
                        <span className="text-blue-700">+{formatMiktar(h.miktar_lt)}</span>
                      ) : (
                        <span className={s.virmanYon === "giden" ? "text-red-600" : "text-emerald-700"}>
                          {s.virmanYon === "giden" ? "−" : "+"}{formatMiktar(h.miktar_lt)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 text-right">
                      {s.anlikOrt !== null ? (() => {
                        // Limit ihlali yönü:
                        //  - oran = genel / anlık
                        //  - oran > limitUst → ANLIK çok DÜŞÜK (az tüketim) → "Alt limit aşıldı" → YEŞİL
                        //  - oran < limitAlt → ANLIK çok YÜKSEK (çok tüketim) → "Üst limit aşıldı" → KIRMIZI
                        let limitYon: "ust" | "alt" | null = null;
                        let oran: number | null = null;
                        if (s.limitIhlali && s.genelOrt !== null && s.anlikOrt > 0 && s.limitUst !== null && s.limitAlt !== null) {
                          oran = s.genelOrt / s.anlikOrt;
                          if (oran > s.limitUst) limitYon = "alt";       // anlık düşük → alt aşıldı
                          else if (oran < s.limitAlt) limitYon = "ust";  // anlık yüksek → üst aşıldı
                        }
                        const renkClass = limitYon === "ust"
                          ? "text-red-600 font-bold"
                          : limitYon === "alt"
                          ? "text-emerald-600 font-bold"
                          : "text-gray-700";
                        const altRenk = limitYon === "ust" ? "text-red-500" : "text-emerald-600";
                        return (
                          <div className="flex flex-col items-end">
                            <span className={renkClass}>
                              {formatSayi(s.anlikOrt, 2)}{birimEki}
                            </span>
                            {limitYon && oran !== null && (
                              <span
                                className={`text-[9px] flex items-center gap-0.5 ${altRenk}`}
                                title={`Oran: ${oran.toFixed(2)} (Limit: ${s.limitAlt} - ${s.limitUst})`}
                              >
                                <AlertTriangle size={8} />
                                {limitYon === "ust" ? "Üst limit aşıldı" : "Alt limit aşıldı"} · Oran: {oran.toFixed(2)}
                              </span>
                            )}
                          </div>
                        );
                      })() : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-right text-gray-700">
                      {s.genelOrt !== null ? formatSayi(s.genelOrt, 2) + birimEki : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-right bg-blue-50 font-bold text-[#1E3A5F]">
                      {s.depoStok !== null ? (
                        <span className={s.depoStok < 0 ? "text-red-600" : ""}>
                          {formatMiktar(s.depoStok)}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-[10px] text-gray-600">
                      {h.created_by ? (kullaniciMap.get(h.created_by) ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-[10px] text-gray-500 max-w-[120px] truncate" title={h.notu ?? ""}>
                      {h.notu || "—"}
                    </TableCell>
                    {(yDuzenle || ySil) && (
                      <TableCell className="px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {yDuzenle && (
                            <button
                              type="button"
                              onClick={() => {
                                if (h.tip === "arac_yakit") {
                                  const y = yakitKayitlari.find((x) => x.id === h.id);
                                  if (y) verDialogDuzenleAc(y);
                                } else if (h.tip === "alim") {
                                  const a = alimlar.find((x) => x.id === h.id);
                                  if (a) alDialogDuzenleAc(a);
                                } else {
                                  const v = virmanlar.find((x) => x.id === h.id);
                                  if (v) virDialogDuzenleAc(v);
                                }
                              }}
                              className="p-1 text-gray-400 hover:text-blue-600 rounded"
                              title="Düzenle"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {ySil && (
                            <button
                              type="button"
                              onClick={() => setSilOnay({ tip: h.tip, id: h.id })}
                              className="p-1 text-gray-400 hover:text-red-600 rounded"
                              title="Sil"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ============ DIALOGS ============ */}

      {/* Yakıt Ver Dialog */}
      <Dialog open={verDialogOpen} onOpenChange={setVerDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck size={18} className="text-emerald-600" />
              {verEditId ? "Yakıt Kaydını Düzenle" : "Araca Yakıt Ver"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 overflow-hidden">
            <div className="space-y-1">
              <Label className="text-xs">Şantiye</Label>
              <div className="overflow-hidden">
                <SantiyeSelect
                  santiyeler={(() => {
                    // Deposu olan VEYA araç ataması bulunan şantiyeleri göster
                    const aracVarSantiyeIds = new Set<string>();
                    for (const a of araclar) {
                      if ((a.durum ?? "aktif") !== "pasif" && a.santiye_id) aracVarSantiyeIds.add(a.santiye_id);
                    }
                    return filtreliSantiyeler(santiyeler, kullanici).filter(
                      (s) => (s.depo_kapasitesi ?? 0) > 0 || aracVarSantiyeIds.has(s.id),
                    );
                  })()}
                  value={verDialogSantiyeId}
                  onChange={(v) => { setVerDialogSantiyeId(v); setVerDialogAracId(""); setHizliAtamaOpen(false); }}
                  className={selectClass + " w-full"} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Araç</Label>
              <div className="flex gap-1">
                <select
                  value={verDialogAracId}
                  onChange={(e) => setVerDialogAracId(e.target.value)}
                  className={selectClass + " flex-1"}
                  disabled={verDialogLoading || !verDialogSantiyeId}
                >
                  <option value="">Araç seçiniz</option>
                  {verDialogAraclari.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.plaka} - {[a.marka, a.model].filter(Boolean).join(" ")} ({a.sayac_tipi ?? "km"})
                    </option>
                  ))}
                </select>
                {verDialogSantiyeId && (
                  <button
                    type="button"
                    onClick={() => setHizliAtamaOpen(true)}
                    className="shrink-0 h-9 w-9 rounded-lg border border-input bg-white flex items-center justify-center text-gray-500 hover:text-[#F97316] hover:border-[#F97316]"
                    title="Bu şantiyeye araç ata"
                    disabled={verDialogLoading}
                  >+</button>
                )}
              </div>
              {/* Hızlı Araç Atama — inline panel */}
              {hizliAtamaOpen && verDialogSantiyeId && (
                <div className="border rounded-lg bg-gray-50 p-2 space-y-2 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-600">Şantiyeye Araç Ata</span>
                    <button type="button" onClick={() => { setHizliAtamaOpen(false); setHizliAtamaArama(""); }}
                      className="text-gray-400 hover:text-gray-600 text-xs">Kapat</button>
                  </div>
                  <Input
                    value={hizliAtamaArama}
                    onChange={(e) => setHizliAtamaArama(e.target.value)}
                    placeholder="Plaka veya marka ara..."
                    className="h-8 text-xs"
                    autoFocus
                  />
                  <div className="max-h-[150px] overflow-y-auto space-y-0.5">
                    {araclar
                      .filter((a) => (a.durum ?? "aktif") === "aktif" && a.santiye_id !== verDialogSantiyeId)
                      .filter((a) => {
                        if (!hizliAtamaArama.trim()) return true;
                        const q = hizliAtamaArama.trim().toLowerCase();
                        return [a.plaka, a.marka, a.model, a.cinsi].filter(Boolean).join(" ").toLowerCase().includes(q);
                      })
                      .sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"))
                      .slice(0, 20)
                      .map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={async () => {
                            try {
                              await updateArac(a.id, { santiye_id: verDialogSantiyeId });
                              setAraclar((prev) => prev.map((x) => x.id === a.id ? { ...x, santiye_id: verDialogSantiyeId } : x));
                              setVerDialogAracId(a.id);
                              setHizliAtamaOpen(false);
                              setHizliAtamaArama("");
                              toast.success(`${a.plaka} bu şantiyeye atandı.`);
                            } catch (err) {
                              toast.error(`Atama hatası: ${err instanceof Error ? err.message : String(err)}`);
                            }
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left rounded hover:bg-blue-50"
                        >
                          <span className="font-bold text-[#1E3A5F]">{a.plaka}</span>
                          <span className="text-gray-500 text-[10px] truncate">{[a.marka, a.model].filter(Boolean).join(" ")}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
            {verDialogSonKayit && (
              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                <div className="font-semibold text-amber-800">Son Kayıt</div>
                <div className="text-amber-700">
                  {verDialogSonKayit.tarih} {verDialogSonKayit.saat.slice(0, 5)} ·{" "}
                  <strong>{formatSayi(verDialogSonKayit.km_saat, 0)}</strong>{" "}
                  {aracMap.get(verDialogSonKayit.arac_id)?.sayac_tipi ?? "km"} ·{" "}
                  {formatLt(verDialogSonKayit.miktar_lt)}
                </div>
                <div className="text-[10px] text-amber-600 mt-0.5">
                  {isYonetici
                    ? "Yönetici olarak eskiye dönük (daha küçük) değer girebilirsiniz."
                    : `Yeni ${aracMap.get(verDialogSonKayit?.arac_id ?? "")?.sayac_tipi === "saat" ? "saat" : "km"} değeri bu değerden küçük olamaz.`}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Tarih</Label>
              <input
                type="date"
                value={verDialogTarih}
                onChange={(e) => setVerDialogTarih(e.target.value)}
                className={selectClass + " w-full"}
                disabled={verDialogLoading}
              />
              {!verEditId && (
                <div className="text-[10px] text-gray-400">Saat otomatik olarak şu an ({verDialogSaat}) alınacak.</div>
              )}
              {verEditId && (
                <div className="text-[10px] text-gray-400">Kayıt saati: {verDialogSaat} (değişmez)</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{aracMap.get(verDialogAracId)?.sayac_tipi === "saat" ? "Saat" : "KM"}</Label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={verDialogKmSaat}
                  onChange={(e) => setVerDialogKmSaat(e.target.value)}
                  placeholder={verDialogSonKayit ? String(verDialogSonKayit.km_saat) : "Örn: 125000"}
                  className={selectClass + " w-full"}
                  disabled={verDialogLoading}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Miktar (lt)</Label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={verDialogMiktar}
                  onChange={(e) => setVerDialogMiktar(formatParaInput(e.target.value))}
                  placeholder="Örn: 100"
                  className={selectClass + " w-full"}
                  disabled={verDialogLoading}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 py-1">
              <button
                type="button"
                onClick={() => setVerDialogDepoFull(!verDialogDepoFull)}
                disabled={verDialogLoading}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all w-full ${
                  verDialogDepoFull
                    ? "bg-emerald-500 text-white border-emerald-500 shadow-md"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                }`}
              >
                <Fuel size={18} />
                {verDialogDepoFull ? "Depo Full" : "Depo Full Değil"}
              </button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Not (opsiyonel)</Label>
              <input
                type="text"
                value={verDialogNotu}
                onChange={(e) => setVerDialogNotu(e.target.value)}
                placeholder="Ek bilgi..."
                className={selectClass + " w-full"}
                disabled={verDialogLoading}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setVerDialogOpen(false)} disabled={verDialogLoading}>İptal</Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={verKaydet}
                disabled={verDialogLoading}
              >
                {verDialogLoading ? "Kaydediliyor..." : verEditId ? "Güncelle" : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Yakıt Al Dialog */}
      <Dialog open={alDialogOpen} onOpenChange={setAlDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download size={18} className="text-blue-600" />
              {alEditId ? "Yakıt Alımını Düzenle" : "Depoya Yakıt Al"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Şantiye (Depo)</Label>
              <SantiyeSelect santiyeler={filtreliSantiyeler(santiyeler, kullanici).filter((s) => (s.depo_kapasitesi ?? 0) > 0)} value={alDialogSantiyeId} onChange={setAlDialogSantiyeId} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tarih</Label>
              <input
                type="date"
                value={alDialogTarih}
                onChange={(e) => setAlDialogTarih(e.target.value)}
                className={selectClass + " w-full"}
                disabled={alDialogLoading}
              />
              {!alEditId && (
                <div className="text-[10px] text-gray-400">Saat otomatik olarak şu an ({alDialogSaat}) alınacak.</div>
              )}
              {alEditId && (
                <div className="text-[10px] text-gray-400">Kayıt saati: {alDialogSaat} (değişmez)</div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tedarikçi Firma</Label>
              <input
                type="text"
                value={alDialogFirma}
                onChange={(e) => setAlDialogFirma(e.target.value)}
                placeholder="Örn: Petrol A.Ş."
                className={selectClass + " w-full"}
                disabled={alDialogLoading}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Miktar (lt)</Label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={alDialogMiktar}
                  onChange={(e) => {
                    const yeniMiktar = formatParaInput(e.target.value);
                    setAlDialogMiktar(yeniMiktar);
                    // Eğer birim fiyat doluysa toplam güncellenir, toplam doluysa birim fiyat güncellenir
                    const m = parseParaInput(yeniMiktar);
                    const bf = parseParaInput(alDialogBirimFiyat);
                    if (m > 0 && bf > 0) {
                      setAlDialogToplam(formatParaInput((m * bf).toFixed(2).replace(".", ",")));
                    }
                  }}
                  placeholder="Örn: 5000"
                  className={selectClass + " w-full"}
                  disabled={alDialogLoading}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Birim Fiyat (TL)</Label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={alDialogBirimFiyat}
                  onChange={(e) => {
                    const yeniBF = formatParaInput(e.target.value, 6);
                    setAlDialogBirimFiyat(yeniBF);
                    const m = parseParaInput(alDialogMiktar);
                    const bf = parseParaInput(yeniBF);
                    if (m > 0 && bf > 0) {
                      setAlDialogToplam(formatParaInput((m * bf).toFixed(2).replace(".", ",")));
                    }
                  }}
                  placeholder="Örn: 45,506789"
                  className={selectClass + " w-full"}
                  disabled={alDialogLoading}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Toplam Tutar (TL)</Label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={alDialogToplam}
                  onChange={(e) => {
                    const yeniToplam = formatParaInput(e.target.value);
                    setAlDialogToplam(yeniToplam);
                    // Miktar doluysa birim fiyat otomatik hesaplanır
                    const m = parseParaInput(alDialogMiktar);
                    const t = parseParaInput(yeniToplam);
                    if (m > 0 && t > 0) {
                      setAlDialogBirimFiyat(formatParaInput((t / m).toFixed(6).replace(".", ","), 6));
                    }
                  }}
                  placeholder="Otomatik"
                  className={selectClass + " w-full"}
                  disabled={alDialogLoading}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Not (opsiyonel)</Label>
              <input
                type="text"
                value={alDialogNotu}
                onChange={(e) => setAlDialogNotu(e.target.value)}
                placeholder="Fatura no, ek bilgi..."
                className={selectClass + " w-full"}
                disabled={alDialogLoading}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setAlDialogOpen(false)} disabled={alDialogLoading}>İptal</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={alKaydet}
                disabled={alDialogLoading}
              >
                {alDialogLoading ? "Kaydediliyor..." : alEditId ? "Güncelle" : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Virman Dialog */}
      <Dialog open={virDialogOpen} onOpenChange={setVirDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCcw size={18} className="text-purple-600" />
              {virEditId ? "Virmanı Düzenle" : "Şantiyeler Arası Virman"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Gönderen Şantiye</Label>
              <SantiyeSelect santiyeler={santiyeler.filter((s) => (s.depo_kapasitesi ?? 0) > 0)} value={virDialogGonderen} onChange={setVirDialogGonderen} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Alan Şantiye</Label>
              <SantiyeSelect santiyeler={santiyeler.filter((s) => s.id !== virDialogGonderen && (s.depo_kapasitesi ?? 0) > 0)} value={virDialogAlan} onChange={setVirDialogAlan} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tarih</Label>
              <input
                type="date"
                value={virDialogTarih}
                onChange={(e) => setVirDialogTarih(e.target.value)}
                className={selectClass + " w-full"}
                disabled={virDialogLoading}
              />
              {!virEditId && (
                <div className="text-[10px] text-gray-400">Saat otomatik olarak şu an ({virDialogSaat}) alınacak.</div>
              )}
              {virEditId && (
                <div className="text-[10px] text-gray-400">Kayıt saati: {virDialogSaat} (değişmez)</div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Miktar (lt)</Label>
              <input
                type="text"
                inputMode="decimal"
                value={virDialogMiktar}
                onChange={(e) => setVirDialogMiktar(formatParaInput(e.target.value))}
                placeholder="Örn: 500"
                className={selectClass + " w-full"}
                disabled={virDialogLoading}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Not (opsiyonel)</Label>
              <input
                type="text"
                value={virDialogNotu}
                onChange={(e) => setVirDialogNotu(e.target.value)}
                className={selectClass + " w-full"}
                disabled={virDialogLoading}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setVirDialogOpen(false)} disabled={virDialogLoading}>İptal</Button>
              <Button
                className="bg-purple-600 hover:bg-purple-700 text-white"
                onClick={virKaydet}
                disabled={virDialogLoading}
              >
                {virDialogLoading ? "Kaydediliyor..." : virEditId ? "Güncelle" : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Silme Onay Dialog */}
      <Dialog open={!!silOnay} onOpenChange={(o) => !o && setSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Kaydı Sil</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-gray-600">
            Bu kayıt kalıcı olarak silinecek. Emin misiniz?
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setSilOnay(null)}>İptal</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={silOnayla}>
              <Trash2 size={14} className="mr-1" /> Sil
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Kiralık Araç Ekleme Dialog */}
      <Dialog open={yakitKiralikDialogOpen} onOpenChange={setYakitKiralikDialogOpen}>
        <DialogContent className="!max-w-4xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={18} className="text-[#F97316]" /> Yeni Kiralık Araç Ekle
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <AracForm
              tip="kiralik"
              onSuccess={() => { setYakitKiralikDialogOpen(false); loadAll(); }}
              onCancel={() => setYakitKiralikDialogOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
      {/* Hızlı araç atama artık yakıt dialog'u içinde inline olarak gösterilir */}
    </div>
  );
}
