// Araç listesi sayfası - Sıra no, firma, HGS, aktif/pasif, ruhsat indirme
"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getAraclar, toggleAracDurum, deleteArac } from "@/lib/supabase/queries/araclar";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import { getSantiyelerBasic } from "@/lib/supabase/queries/santiyeler";
import { createClient } from "@/lib/supabase/client";
import { exportAraclarPDF, exportAraclarExcel } from "@/lib/export";
import type { AracWithRelations, Tanimlama } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import AracForm from "@/components/shared/arac-form";
import {
  Pencil, Truck, Plus, Search, FileDown, FileSpreadsheet, FileCheck, Trash2,
  ChevronDown, Check,
} from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { useAuth } from "@/hooks";
import { trAramaNormalize } from "@/lib/utils/isim";

type Filtre = "tumu" | "aktif" | "pasif" | "trafikten_cekildi";

type YakitMini = {
  id: string;
  arac_id: string;
  santiye_id: string;
  tarih: string;
  saat: string;
  km_saat: number | null;
  miktar_lt: number | null;
  dis_yakit_oncesi?: boolean | null;
};

// Araç başına genel yakıt tüketim ortalaması (L/100km veya L/saat).
// Yakıt sayfasındaki aracGenelOrt ile aynı mantık (şantiye filtresiz, araç geneli):
// ardışık dolumlar arası Σlitre / Σmesafe; km/saat girilmemiş ve dış-yakıt aralıkları hariç.
// Dış-yakıt: manuel (true/false) öncelikli; null ise OTOMATİK (mesafe 1 depo menzilini aşıyorsa).
function hesaplaGenelOrtMap(
  yakitlar: YakitMini[],
  araclar: AracWithRelations[],
): Map<string, number> {
  const aracById = new Map(araclar.map((a) => [a.id, a]));
  const byArac = new Map<string, YakitMini[]>();
  for (const y of yakitlar) {
    if (!byArac.has(y.arac_id)) byArac.set(y.arac_id, []);
    byArac.get(y.arac_id)!.push(y);
  }
  const m = new Map<string, number>();
  for (const [aracId, kayitlar] of byArac) {
    const arac = aracById.get(aracId);
    const carpan = arac?.sayac_tipi === "saat" ? 1 : 100;
    const menzil = arac?.depo_menzil ?? 0;
    const sirali = kayitlar
      .filter((k) => (k.km_saat ?? 0) > 0) // km/saat girilmemiş kayıtlar dışlanır
      .sort((a, b) => (a.tarih + a.saat).localeCompare(b.tarih + b.saat));
    if (sirali.length < 2) continue;
    let toplamLt = 0;
    let toplamMesafe = 0;
    for (let i = 1; i < sirali.length; i++) {
      const mesafe = (sirali[i].km_saat ?? 0) - (sirali[i - 1].km_saat ?? 0);
      if (mesafe <= 0) continue;
      const dy = sirali[i].dis_yakit_oncesi;
      const disYakit = dy === true ? true : dy === false ? false : (menzil > 0 && mesafe > menzil);
      if (disYakit) continue;
      toplamLt += sirali[i].miktar_lt ?? 0;
      toplamMesafe += mesafe;
    }
    if (toplamMesafe > 0) m.set(aracId, (toplamLt / toplamMesafe) * carpan);
  }
  return m;
}

export default function AraclarPage() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  const yEkle = hasPermission("yonetim-araclar", "ekle");
  const yDuzenle = hasPermission("yonetim-araclar", "duzenle");
  const ySil = hasPermission("yonetim-araclar", "sil");
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [cinsSiralama, setCinsSiralama] = useState<Map<string, number>>(new Map());
  const [cinsListesi, setCinsListesi] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [arama, setArama] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tumu");
  const [mulkiyetFiltre, setMulkiyetFiltre] = useState<"tumu" | "ozmal" | "kiralik">("ozmal");
  const [cinsFiltre, setCinsFiltre] = useState("tumu");
  // Firma filtresi ÇOKLU seçim: boş dizi = tüm firmalar; doluysa sadece seçili firmalar gösterilir
  const [firmaSecili, setFirmaSecili] = useState<string[]>([]);
  const [firmaDropdownAcik, setFirmaDropdownAcik] = useState(false);
  // Varsayılan sıralama: 1) Firma sira_no asc, 2) Cinsi asc (tanımlama sırası), 3) Yılı desc (en yeni en üstte)
  const [sortList, setSortList] = useState<{ key: string; dir: "asc" | "desc" }[]>([
    { key: "firma", dir: "asc" },
    { key: "cinsi", dir: "asc" },
    { key: "yili", dir: "desc" },
  ]);
  const [sonYakitSantiye, setSonYakitSantiye] = useState<Map<string, string>>(new Map());
  // Aracın son güncellenen km/saat değerinin tarihi (en son yakıt kaydı tarihi)
  const [sonGostergeTarihi, setSonGostergeTarihi] = useState<Map<string, string>>(new Map());
  // Ham yakıt verisi (genel ortalama hesabı için) — menzil düzenlenince ortalama
  // canlı yeniden hesaplansın diye state'te tutulur.
  const [yakitVerileri, setYakitVerileri] = useState<YakitMini[]>([]);
  // Araç bedeli inline düzenleme — açık olan satır id'si tutulur
  const [editBedelId, setEditBedelId] = useState<string | null>(null);
  const [editBedelValue, setEditBedelValue] = useState<string>("");
  // 1 depo menzili inline düzenleme
  const [editMenzilId, setEditMenzilId] = useState<string | null>(null);
  const [editMenzilValue, setEditMenzilValue] = useState<string>("");
  // Araç düzenleme — kalem ikonuna tıklayınca dialog (pencere) olarak açılır
  const [duzenleArac, setDuzenleArac] = useState<AracWithRelations | null>(null);

  // Genel ortalama — yakıt verisi veya araç (menzil) değişince yeniden hesaplanır.
  const genelOrtMap = useMemo(
    () => hesaplaGenelOrtMap(yakitVerileri, araclar),
    [yakitVerileri, araclar],
  );

  // Para formatla (1.500.000 TL şeklinde, ondalıksız) — null/0 ise "—"
  function formatBedel(deger: number | null | undefined): string {
    if (deger == null || deger === 0) return "—";
    return `${deger.toLocaleString("tr-TR")} ₺`;
  }

  // Input içindeki sayıyı binlik ayraçlı göster: "500000" → "500.000"
  function formatBedelInput(raw: string): string {
    const sadeceSayi = raw.replace(/[^\d]/g, "");
    if (!sadeceSayi) return "";
    return parseInt(sadeceSayi, 10).toLocaleString("tr-TR");
  }

  // Tarih formatı: ISO timestamp → DD.MM.YYYY
  function formatTarihKisa(iso: string | null | undefined): string {
    if (!iso) return "";
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return "";
    return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
  }

  // Araç bedeli kaydet
  async function bedelKaydet(aracId: string, raw: string) {
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    const temizlenmis = raw.replace(/[^\d]/g, "");
    const sayisal = temizlenmis === "" ? null : parseInt(temizlenmis, 10);
    if (sayisal !== null && (isNaN(sayisal) || sayisal < 0)) {
      toast.error("Geçersiz bedel.");
      return;
    }
    // Mevcut değerle aynıysa kayıt yapma — gereksiz updated_at güncellemesini önle
    const mevcut = araclar.find((a) => a.id === aracId)?.arac_degeri ?? null;
    if (sayisal === mevcut) {
      setEditBedelId(null);
      setEditBedelValue("");
      return;
    }
    const simdiIso = new Date().toISOString();
    try {
      const { updateArac } = await import("@/lib/supabase/queries/araclar");
      await updateArac(aracId, { arac_degeri: sayisal, arac_degeri_updated_at: simdiIso });
      setAraclar((p) => p.map((a) => (
        a.id === aracId ? { ...a, arac_degeri: sayisal, arac_degeri_updated_at: simdiIso } : a
      )));
      setEditBedelId(null);
      setEditBedelValue("");
      toast.success("Araç bedeli güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 1 depo menzili inline kaydet (km veya saat — tam sayı)
  async function menzilKaydet(aracId: string, raw: string) {
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    const temizlenmis = raw.replace(/[^\d]/g, "");
    const sayisal = temizlenmis === "" ? null : parseInt(temizlenmis, 10);
    if (sayisal !== null && (isNaN(sayisal) || sayisal < 0)) {
      toast.error("Geçersiz değer.");
      return;
    }
    const mevcut = araclar.find((a) => a.id === aracId)?.depo_menzil ?? null;
    if (sayisal === mevcut) {
      setEditMenzilId(null);
      setEditMenzilValue("");
      return;
    }
    try {
      const { updateArac } = await import("@/lib/supabase/queries/araclar");
      await updateArac(aracId, { depo_menzil: sayisal });
      setAraclar((p) => p.map((a) => (a.id === aracId ? { ...a, depo_menzil: sayisal } : a)));
      setEditMenzilId(null);
      setEditMenzilValue("");
      // Menzille çelişen eski "dışarıdan yakıt" işaretlerini otomatiğe çevir: menzilin
      // ALTINDA kaldığı halde kalıcı true yazılı kayıtlar null'a alınır (menzil belirleyici).
      let temizlenenSayi = 0;
      if (sayisal && sayisal > 0) {
        const { menzilUyumsuzDisYakitTemizle } = await import("@/lib/supabase/queries/yakit");
        const temizlenen = await menzilUyumsuzDisYakitTemizle(aracId, sayisal);
        if (temizlenen.length > 0) {
          temizlenenSayi = temizlenen.length;
          const idSet = new Set(temizlenen);
          // Genel ortalama canlı yeniden hesaplansın diye yerel yakıt verisini güncelle.
          setYakitVerileri((p) => p.map((y) => (idSet.has(y.id) ? { ...y, dis_yakit_oncesi: null } : y)));
        }
      }
      toast.success(
        temizlenenSayi > 0
          ? `1 depo menzili güncellendi. Menzilin altındaki ${temizlenenSayi} eski "D" işareti otomatiğe alındı.`
          : "1 depo menzili güncellendi.",
      );
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleSort(key: string) {
    setSortList((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx >= 0) {
        // Zaten var — yönü değiştir
        const next = [...prev];
        next[idx] = { key, dir: prev[idx].dir === "asc" ? "desc" : "asc" };
        return next;
      }
      // Yeni sıralama ekle (max 3)
      const yeni = [...prev, { key, dir: "asc" as const }];
      return yeni.slice(-3);
    });
  }
  function sortIcon(key: string) {
    const s = sortList.find((s) => s.key === key);
    if (!s) return "";
    const sira = sortList.indexOf(s) + 1;
    return s.dir === "asc" ? ` ↑${sira > 1 ? sira : ""}` : ` ↓${sira > 1 ? sira : ""}`;
  }

  async function loadAraclar() {
    try {
      const [data, cinsData, santiyeData] = await Promise.all([
        getAraclar(),
        getTanimlamalar("arac_cinsi"),
        getSantiyelerBasic(),
      ]);
      setAraclar((data as AracWithRelations[]) ?? []);
      const tItems = (cinsData as Tanimlama[]) ?? [];
      const sMap = new Map<string, number>();
      tItems.forEach((t, i) => sMap.set(t.deger, i));
      setCinsSiralama(sMap);
      setCinsListesi(tItems.map((t) => t.deger));

      // Her araç için son yakıt verilen şantiyeyi bul
      const santiyeMap = new Map<string, string>();
      for (const s of (santiyeData ?? []) as { id: string; is_adi: string }[]) santiyeMap.set(s.id, s.is_adi);
      try {
        const supabase = createClient();
        const baseSelect = "id, arac_id, santiye_id, tarih, saat, km_saat, miktar_lt";
        // SAYFALAMA: Supabase tek sorguda en fazla 1000 satır döndürür. Yakıt kayıtları
        // 1000'i geçince eski kayıtlar eksik kalır → genel ortalama yanlış olur.
        // Bu yüzden 1000'erli parçalarla TÜM kayıtları çekiyoruz (yakıt sayfasıyla aynı).
        async function tumYakitCek(selectStr: string): Promise<{ data: unknown[] | null; error: unknown }> {
          const PARCA = 1000;
          let offset = 0;
          const tum: unknown[] = [];
          for (;;) {
            const { data, error } = await supabase
              .from("arac_yakit")
              .select(selectStr)
              .order("tarih", { ascending: false })
              .order("saat", { ascending: false })
              .range(offset, offset + PARCA - 1);
            if (error) return { data: null, error };
            const parca = data ?? [];
            tum.push(...parca);
            if (parca.length < PARCA) break;
            offset += PARCA;
            if (offset > 200000) break; // güvenlik
          }
          return { data: tum, error: null };
        }
        let res = await tumYakitCek(baseSelect + ", dis_yakit_oncesi");
        // dis_yakit_oncesi kolonu henüz eklenmemişse (migration yok) o alansız tekrar dene
        if (res.error) res = await tumYakitCek(baseSelect);
        const yakitlar: YakitMini[] | null = res.data
          ? (res.data as unknown as YakitMini[])
          : null;
        if (yakitlar) {
          const sonYakit = new Map<string, string>();
          const sonTarih = new Map<string, string>();
          for (const y of yakitlar) {
            if (!sonYakit.has(y.arac_id)) {
              sonYakit.set(y.arac_id, santiyeMap.get(y.santiye_id) ?? "");
              sonTarih.set(y.arac_id, y.tarih);
            }
          }
          setSonYakitSantiye(sonYakit);
          setSonGostergeTarihi(sonTarih);
          // Ham yakıt verisini sakla — genel ortalama useMemo ile (menzil değişince canlı) hesaplanır.
          setYakitVerileri(yakitlar as YakitMini[]);
        }
      } catch { /* sessiz */ }
    } catch {
      toast.error("Araçlar yüklenirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAraclar(); }, []);

  async function handleDurumDegistir(id: string, yeniDurum: "aktif" | "pasif" | "trafikten_cekildi") {
    try {
      await toggleAracDurum(id, yeniDurum);
      setAraclar((prev) => prev.map((a) =>
        a.id === id ? { ...a, durum: yeniDurum } : a
      ));
      const mesajlar = { aktif: "Araç aktif yapıldı.", pasif: "Araç pasife alındı.", trafikten_cekildi: "Araç trafikten çekildi olarak işaretlendi." };
      toast.success(mesajlar[yeniDurum]);
    } catch {
      toast.error("Durum güncellenirken hata oluştu.");
    }
  }

  // Kısıtlı/şantiye admin: sadece atandığı şantiyelerdeki araçlar görünür.
  // santiyesiz_veri_gor=true → şantiye atanmamış (NULL) araçlar da görünür.
  const izinliSantiyelerSet = !isYonetici && kullanici?.santiye_ids
    ? new Set(kullanici.santiye_ids)
    : null;
  const santiyesizDahil = !!kullanici?.santiyesiz_veri_gor;

  // Arama + durum filtresi
  const filtrelenmis = araclar
    .filter((a) => {
      // Atanmamış şantiyelerin araçlarını gizle
      if (izinliSantiyelerSet) {
        if (!a.santiye_id) {
          if (!santiyesizDahil) return false;
        } else if (!izinliSantiyelerSet.has(a.santiye_id)) {
          return false;
        }
      }
      if (filtre !== "tumu" && a.durum !== filtre) return false;
      if (mulkiyetFiltre !== "tumu" && a.tip !== mulkiyetFiltre) return false;
      if (cinsFiltre !== "tumu" && a.cinsi !== cinsFiltre) return false;
      if (firmaSecili.length > 0) {
        const firmaAdi = a.tip === "ozmal" ? (a.firmalar?.firma_adi ?? "") : (a.kiralama_firmasi ?? "");
        if (!firmaSecili.includes(firmaAdi)) return false;
      }
      if (!arama.trim()) return true;
      const q = trAramaNormalize(arama);
      return (
        trAramaNormalize(a.plaka).includes(q) ||
        trAramaNormalize(a.marka).includes(q) ||
        trAramaNormalize(a.model).includes(q) ||
        trAramaNormalize(a.cinsi).includes(q) ||
        trAramaNormalize(a.firmalar?.firma_adi).includes(q) ||
        trAramaNormalize(a.kiralama_firmasi).includes(q) ||
        trAramaNormalize(sonYakitSantiye.get(a.id)).includes(q)
      );
    })
    .sort((a, b) => {
      for (const s of sortList) {
        let cmp = 0;
        switch (s.key) {
          case "plaka": cmp = a.plaka.localeCompare(b.plaka, "tr"); break;
          case "firma": {
            // Önce sira_no ile karşılaştır (Yönetim → Firmalar sırasıyla aynı).
            // Kiralık araç (firmalar=null) veya sira_no yoksa en sona at.
            const saA = a.firmalar?.sira_no ?? Number.MAX_SAFE_INTEGER;
            const sbA = b.firmalar?.sira_no ?? Number.MAX_SAFE_INTEGER;
            if (saA !== sbA) { cmp = saA - sbA; break; }
            // sira_no eşitse alfabetik fallback
            const fa = (a.tip === "ozmal" ? a.firmalar?.firma_adi : a.kiralama_firmasi) ?? "zzz";
            const fb = (b.tip === "ozmal" ? b.firmalar?.firma_adi : b.kiralama_firmasi) ?? "zzz";
            cmp = fa.localeCompare(fb, "tr"); break;
          }
          case "marka": cmp = (a.marka ?? "").localeCompare(b.marka ?? "", "tr"); break;
          case "cinsi": {
            const sa = cinsSiralama.get(a.cinsi ?? "") ?? 999;
            const sb = cinsSiralama.get(b.cinsi ?? "") ?? 999;
            cmp = sa - sb; break;
          }
          case "yili": cmp = (a.yili ?? 0) - (b.yili ?? 0); break;
          case "arac_degeri": cmp = (a.arac_degeri ?? 0) - (b.arac_degeri ?? 0); break;
          case "santiye": cmp = (sonYakitSantiye.get(a.id) ?? "zzz").localeCompare(sonYakitSantiye.get(b.id) ?? "zzz", "tr"); break;
          case "durum": cmp = (a.durum ?? "").localeCompare(b.durum ?? ""); break;
          case "mulkiyet": cmp = (a.tip ?? "").localeCompare(b.tip ?? ""); break;
        }
        if (cmp !== 0) return cmp * (s.dir === "asc" ? 1 : -1);
      }
      return 0;
    });

  return (
    <div>
      {/* Başlık ve butonlar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Araçlar</h1>
        <div className="flex items-center gap-2">
          {yEkle && (
            <>
              <Link href="/dashboard/yonetim/araclar/yeni">
                <Button className="bg-[#64748B] hover:bg-[#2a4f7a] text-white">
                  <Plus size={16} className="mr-1" /> Yeni Araç Ekle
                </Button>
              </Link>
              <Link href="/dashboard/yonetim/araclar/kiralik">
                <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white">
                  <Plus size={16} className="mr-1" /> Kiralık Araç Ekle
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Filtre butonları */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          { key: "tumu", label: "Tümü" },
          { key: "aktif", label: "Aktif" },
          { key: "pasif", label: "Pasif" },
          { key: "trafikten_cekildi", label: "Trafikten Çekildi" },
        ] as { key: Filtre; label: string }[]).map((f) => (
          <Button key={f.key} variant={filtre === f.key ? "default" : "outline"} size="sm"
            onClick={() => setFiltre(f.key)} className={filtre === f.key ? "bg-[#64748B]" : ""}>
            {f.label}
          </Button>
        ))}
      </div>

      {/* Arama ve filtreler */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Plaka, marka, model, firma ile ara..." value={arama}
            onChange={(e) => setArama(e.target.value)} className="pl-9" />
        </div>
        <select value={mulkiyetFiltre} onChange={(e) => setMulkiyetFiltre(e.target.value as "tumu" | "ozmal" | "kiralik")}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm min-w-[120px]">
          <option value="tumu">Tüm Mülkiyet</option>
          <option value="ozmal">Özmal</option>
          <option value="kiralik">Kiralık</option>
        </select>
        <select value={cinsFiltre} onChange={(e) => setCinsFiltre(e.target.value)}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm min-w-[130px]">
          <option value="tumu">Tüm Cinsler</option>
          {cinsListesi.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {/* Çoklu firma filtresi — aynı anda 2-3 firma seçilebilir (boş = tümü) */}
        {(() => {
          const firmaSet = new Set<string>();
          for (const a of araclar) {
            const adi = a.tip === "ozmal" ? a.firmalar?.firma_adi : a.kiralama_firmasi;
            if (adi) firmaSet.add(adi);
          }
          const firmaAdlari = Array.from(firmaSet).sort((a, b) => a.localeCompare(b, "tr"));
          const etiket = firmaSecili.length === 0
            ? "Tüm Firmalar"
            : firmaSecili.length === 1
              ? firmaSecili[0]
              : `${firmaSecili.length} firma seçili`;
          return (
            <div className="relative">
              <button type="button" onClick={() => setFirmaDropdownAcik((o) => !o)}
                className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm min-w-[160px] max-w-[220px] flex items-center justify-between gap-2">
                <span className="truncate">{etiket}</span>
                <ChevronDown size={14} className="shrink-0 text-gray-400" />
              </button>
              {firmaDropdownAcik && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFirmaDropdownAcik(false)} />
                  <div className="absolute z-50 mt-1 w-64 max-h-72 overflow-y-auto rounded-lg border bg-white shadow-lg p-1">
                    <button type="button" onClick={() => setFirmaSecili([])}
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-gray-50 flex items-center gap-2">
                      <span className={`w-4 h-4 border rounded flex items-center justify-center shrink-0 ${firmaSecili.length === 0 ? "bg-[#1E3A5F] border-[#1E3A5F]" : "border-gray-300"}`}>
                        {firmaSecili.length === 0 && <Check size={12} className="text-white" />}
                      </span>
                      <span className="font-medium">Tüm Firmalar</span>
                    </button>
                    <div className="my-1 border-t" />
                    {firmaAdlari.map((f) => {
                      const secili = firmaSecili.includes(f);
                      return (
                        <button key={f} type="button"
                          onClick={() => setFirmaSecili((prev) => secili ? prev.filter((x) => x !== f) : [...prev, f])}
                          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-gray-50 flex items-center gap-2">
                          <span className={`w-4 h-4 border rounded flex items-center justify-center shrink-0 ${secili ? "bg-[#1E3A5F] border-[#1E3A5F]" : "border-gray-300"}`}>
                            {secili && <Check size={12} className="text-white" />}
                          </span>
                          <span className="truncate">{f}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {sortList.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSortList([])} className="text-red-500 text-xs">
            Sıralamayı Temizle
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportAraclarPDF(filtrelenmis)}
            disabled={filtrelenmis.length === 0}>
            <FileDown size={16} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportAraclarExcel(filtrelenmis)}
            disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={16} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
        ))}</div>
      ) : araclar.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Truck size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">Henüz araç eklenmemiş.</p>
        </div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Search size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">&quot;{arama}&quot; ile eşleşen araç bulunamadı.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          <Table noWrapper>
            <TableHeader className="sticky top-0 z-10 bg-white shadow-sm">
              <TableRow>
                <TableHead className="w-[50px]">No</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("mulkiyet")}>Mülkiyet{sortIcon("mulkiyet")}</TableHead>
                <TableHead
                  style={{ position: "sticky", left: 0, zIndex: 11, backgroundColor: "white" }}
                  className="cursor-pointer select-none hover:text-blue-600 shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                  onClick={() => handleSort("plaka")}
                >Plaka{sortIcon("plaka")}</TableHead>
                <TableHead className="max-w-[140px] cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("marka")}>Marka / Model{sortIcon("marka")}</TableHead>
                <TableHead className="hidden md:table-cell cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("cinsi")}>Cinsi{sortIcon("cinsi")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("yili")}>Yılı{sortIcon("yili")}</TableHead>
                <TableHead className="hidden md:table-cell text-right cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("arac_degeri")}>Araç Bedeli{sortIcon("arac_degeri")}</TableHead>
                <TableHead className="hidden md:table-cell cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("santiye")}>Şantiye{sortIcon("santiye")}</TableHead>
                <TableHead>Gösterge</TableHead>
                <TableHead className="hidden md:table-cell text-right whitespace-nowrap" title="1 depo (tam dolum) ile gidilebilecek km / çalışabilecek saat">1 Depo</TableHead>
                <TableHead className="hidden md:table-cell text-right whitespace-nowrap" title="Genel yakıt tüketim ortalaması (km'siz ve dış-yakıt aralıkları hariç)">Genel Ort.</TableHead>
                <TableHead className="hidden md:table-cell text-center">HGS</TableHead>
                <TableHead className="hidden md:table-cell text-center">Ruhsat</TableHead>
                <TableHead className="text-center">Durum</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((arac, index) => (
                <TableRow key={arac.id} className={arac.durum === "pasif" ? "bg-gray-100 opacity-50" : "hover:bg-gray-50"}>
                  <TableCell className="tabular-nums text-gray-500">{index + 1}</TableCell>
                  <TableCell>
                    <Badge className={arac.tip === "ozmal" ? "bg-[#64748B]" : "bg-[#F97316]"}>
                      {arac.tip === "ozmal" ? "Özmal" : "Kiralık"}
                    </Badge>
                  </TableCell>
                  <TableCell
                    style={{ position: "sticky", left: 0, zIndex: 5, backgroundColor: arac.durum === "pasif" ? "#f3f4f6" : "white" }}
                    className="font-bold shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                  >
                    {/* Firma rengi şeridi (sol kenar) — kiralık araçlarda renk yok, default gri.
                        Firma adı tooltip'te görünür (sütun kaldırıldı, hover ile erişim). */}
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-1 self-stretch rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: (arac.tip === "ozmal" ? arac.firmalar?.renk : null) ?? "#e5e7eb",
                          minHeight: "1.25rem",
                        }}
                        title={arac.tip === "ozmal" ? (arac.firmalar?.firma_adi ?? "Firma yok") : (arac.kiralama_firmasi ?? "Kiralık")}
                      />
                      <span>{arac.plaka}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate" title={[arac.marka, arac.model].filter(Boolean).join(" ")}>
                    {[arac.marka, arac.model].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{arac.cinsi ?? "—"}</TableCell>
                  <TableCell>{arac.yili ?? "—"}</TableCell>
                  {/* Araç Bedeli — inline editable. Tıklanınca input açılır. */}
                  <TableCell
                    className={`hidden md:table-cell text-right tabular-nums whitespace-nowrap ${yDuzenle ? "cursor-pointer hover:bg-blue-50" : ""}`}
                    onClick={() => {
                      if (!yDuzenle || editBedelId === arac.id) return;
                      setEditBedelId(arac.id);
                      // Edit moduna girerken mevcut değeri binlik ayraçlı göster
                      setEditBedelValue(
                        arac.arac_degeri != null ? arac.arac_degeri.toLocaleString("tr-TR") : "",
                      );
                    }}
                    title={yDuzenle ? "Tıklayarak düzenle" : undefined}
                  >
                    {editBedelId === arac.id ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        value={editBedelValue}
                        onChange={(e) => setEditBedelValue(formatBedelInput(e.target.value))}
                        onBlur={() => bedelKaydet(arac.id, editBedelValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") bedelKaydet(arac.id, editBedelValue);
                          if (e.key === "Escape") { setEditBedelId(null); setEditBedelValue(""); }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-32 h-7 text-right text-xs px-2 rounded border border-blue-300 outline-none focus:border-blue-500"
                        placeholder="0"
                        style={{ fontSize: "16px" }}
                      />
                    ) : (
                      <div className="flex flex-col items-end leading-tight">
                        <span className={arac.arac_degeri ? "text-[#1E3A5F] font-semibold" : "text-gray-300"}>
                          {formatBedel(arac.arac_degeri)}
                        </span>
                        {arac.arac_degeri_updated_at && (
                          <span className="text-[9px] text-gray-400 mt-0.5">
                            {formatTarihKisa(arac.arac_degeri_updated_at)}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-[120px] truncate" title={sonYakitSantiye.get(arac.id) ?? ""}>{sonYakitSantiye.get(arac.id) || "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    {arac.guncel_gosterge != null ? (
                      <div className="flex flex-col">
                        <span className="whitespace-nowrap">{arac.guncel_gosterge.toLocaleString("tr-TR")} {arac.sayac_tipi === "saat" ? "sa" : "km"}</span>
                        {sonGostergeTarihi.get(arac.id) && (
                          <span className="text-[9px] text-gray-400 mt-0.5">
                            {sonGostergeTarihi.get(arac.id)!.split("-").reverse().join(".")}
                          </span>
                        )}
                      </div>
                    ) : "—"}
                  </TableCell>
                  {/* 1 Depo menzili — inline editable. Tıklayınca rakam girilir/güncellenir. */}
                  <TableCell
                    className={`hidden md:table-cell text-right tabular-nums whitespace-nowrap ${yDuzenle ? "cursor-pointer hover:bg-blue-50" : ""}`}
                    onClick={() => {
                      if (!yDuzenle || editMenzilId === arac.id) return;
                      setEditMenzilId(arac.id);
                      setEditMenzilValue(arac.depo_menzil != null ? String(arac.depo_menzil) : "");
                    }}
                    title={yDuzenle ? "Tıklayarak 1 depo menzilini gir/güncelle" : undefined}
                  >
                    {editMenzilId === arac.id ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        value={editMenzilValue}
                        onChange={(e) => setEditMenzilValue(e.target.value.replace(/[^\d]/g, ""))}
                        onBlur={() => menzilKaydet(arac.id, editMenzilValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") menzilKaydet(arac.id, editMenzilValue);
                          if (e.key === "Escape") { setEditMenzilId(null); setEditMenzilValue(""); }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-20 h-7 text-right text-xs px-2 rounded border border-blue-300 outline-none focus:border-blue-500"
                        placeholder={arac.sayac_tipi === "saat" ? "saat" : "km"}
                        style={{ fontSize: "16px" }}
                      />
                    ) : (
                      <span className={arac.depo_menzil != null && arac.depo_menzil > 0 ? "text-[#1E3A5F] font-semibold" : "text-gray-300"}>
                        {arac.depo_menzil != null && arac.depo_menzil > 0
                          ? `${arac.depo_menzil.toLocaleString("tr-TR")} ${arac.sayac_tipi === "saat" ? "sa" : "km"}`
                          : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right tabular-nums whitespace-nowrap">
                    {(() => {
                      const o = genelOrtMap.get(arac.id);
                      if (o == null) return <span className="text-gray-300">—</span>;
                      const birim = arac.sayac_tipi === "saat" ? " L/s" : " L/100km";
                      return (
                        <span className="text-[#1E3A5F] font-semibold">
                          {o.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{birim}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-center">
                    <Badge variant={arac.hgs_saglayici ? "default" : "secondary"}
                      className={arac.hgs_saglayici ? "bg-green-600" : ""}>
                      {arac.hgs_saglayici ? "Var" : "Yok"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-center">
                    {arac.ruhsat_url ? (
                      <a href={arac.ruhsat_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 border border-green-200 rounded text-xs text-green-700 hover:bg-green-100 transition-colors">
                        <FileCheck size={12} /> İndir
                      </a>
                    ) : (
                      <span className="text-gray-400 text-xs">Yok</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <select value={arac.durum ?? "aktif"}
                      onChange={(e) => handleDurumDegistir(arac.id, e.target.value as "aktif" | "pasif" | "trafikten_cekildi")}
                      className="text-xs border rounded px-1.5 py-0.5 bg-white">
                      <option value="aktif">Aktif</option>
                      <option value="pasif">Pasif</option>
                      <option value="trafikten_cekildi">Trafikten Çekildi</option>
                    </select>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {yDuzenle && (
                      <Button variant="ghost" size="sm" title="Düzenle"
                        onClick={() => setDuzenleArac(arac)}>
                        <Pencil size={16} />
                      </Button>
                      )}
                      {ySil && (
                      <Button variant="ghost" size="sm" title="Sil"
                        className="text-red-500 hover:text-red-700"
                        onClick={async () => {
                          if (!confirm(`"${arac.plaka}" aracını silmek istediğinize emin misiniz?`)) return;
                          try {
                            await deleteArac(arac.id);
                            setAraclar((prev) => prev.filter((a) => a.id !== arac.id));
                            toast.success(`${arac.plaka} silindi.`);
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            if (msg.includes("violates foreign key") || msg.includes("referenced")) {
                              toast.error("Bu araca ait puantaj, yakıt veya kira verisi var. Önce ilişkili verileri silin.", { duration: toastSuresi() });
                            } else {
                              toast.error(`Silme hatası: ${msg}`, { duration: toastSuresi() });
                            }
                          }
                        }}>
                        <Trash2 size={16} />
                      </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Araç düzenleme penceresi — kalem ikonuna tıklayınca açılır (ayrı sayfa yerine dialog) */}
      <Dialog open={!!duzenleArac} onOpenChange={(o) => { if (!o) setDuzenleArac(null); }}>
        <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Araç Düzenle{duzenleArac ? ` — ${duzenleArac.plaka}` : ""}</DialogTitle>
          </DialogHeader>
          {duzenleArac && (
            <AracForm
              arac={duzenleArac}
              tip={duzenleArac.tip}
              onSuccess={() => { setDuzenleArac(null); loadAraclar(); }}
              onCancel={() => setDuzenleArac(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
