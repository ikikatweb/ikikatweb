// İşçilik Takibi sayfası - Şantiye bazlı prim ve veri takibi, inline düzenleme
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getIscilikTakibi,
  upsertIscilikTakibi,
  ensureAktifSantiyeler,
  deleteIscilikTakibi,
  getSilinenIscilikTakibi,
  restoreIscilikTakibi,
  permanentDeleteIscilikTakibi,
  getTumIscilikAyliklari,
} from "@/lib/supabase/queries/iscilik-takibi";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import type { IscilikTakibiWithSantiye, Tanimlama } from "@/lib/supabase/types";
import { useAuth } from "@/hooks";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClipboardList, Search, FileDown, FileSpreadsheet, Trash2, RotateCcw, Trash } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

type EditingCell = { id: string; santiyeId: string; field: string } | null;

function formatPara(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatTarih(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}
// Sadece ay/yıl (MM.YYYY) — veri girişi ait olduğu ay gösterimi için
function formatAyYil(d: string | null) {
  if (!d) return "—";
  // Zaten "MM.YYYY" formatında ise aynen döndür
  if (/^\d{2}\.\d{4}$/.test(d)) return d;
  // "M.YYYY" ise başına 0 ekle
  const mm = d.match(/^(\d{1,2})\.(\d{4})$/);
  if (mm) return `${mm[1].padStart(2, "0")}.${mm[2]}`;
  // ISO date formatı ("YYYY-MM-DD" veya benzeri)
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  if (isNaN(dt.getTime())) return d; // parse edilemezse orijinali döndür
  return `${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}

// Sütun tanımları
type ColDef = {
  key: string;
  label: string;
  editable?: boolean;
  type?: "text" | "para" | "date";
  computed?: boolean;
  fromSantiye?: boolean;
  getValue: (row: IscilikTakibiWithSantiye) => string;
  getRaw: (row: IscilikTakibiWithSantiye) => string | number | null;
};

const COLUMNS: ColDef[] = [
  // Sicil No sütunu tablodan kaldırıldı — iş adının tam görünmesi için
  // { key: "sicil_no", label: "Sicil No", type: "text",
  //   getValue: (r) => r.sicil_no ?? "—", getRaw: (r) => r.sicil_no },
  { key: "is_adi", label: "İşin Adı", fromSantiye: true,
    getValue: (r) => r.santiyeler?.is_adi ?? "—", getRaw: () => null },
  { key: "sozlesme_bedeli", label: "Sözleşme\nBedeli", fromSantiye: true, type: "para",
    getValue: (r) => formatPara(r.santiyeler?.sozlesme_bedeli ?? null), getRaw: () => null },
  { key: "kesif_artisi", label: "Keşif\nArtışı", type: "para",
    getValue: (r) => formatPara(r.kesif_artisi), getRaw: (r) => r.kesif_artisi },
  { key: "fiyat_farki", label: "Fiyat\nFarkı", editable: true, type: "para",
    getValue: (r) => formatPara(r.fiyat_farki), getRaw: (r) => r.fiyat_farki },
  { key: "yatmasi_gereken_prim", label: "Yatması\nGereken Prim", computed: true,
    getValue: (r) => {
      const bedel = r.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = r.kesif_artisi ?? 0;
      const ff = r.fiyat_farki ?? 0;
      const oran = r.iscilik_orani ?? 0;
      const toplam = (bedel + kesif + ff) * oran / 100;
      return toplam > 0 ? formatPara(toplam) : "—";
    }, getRaw: () => null },
  { key: "yatan_prim", label: "Yatan\nPrim", computed: true,
    getValue: (r) => formatPara(r.yatan_prim), getRaw: () => null },
  { key: "kalan_prim", label: "Kalan\nPrim", computed: true,
    getValue: (r) => {
      const bedel = r.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = r.kesif_artisi ?? 0;
      const ff = r.fiyat_farki ?? 0;
      const oran = r.iscilik_orani ?? 0;
      const yatacak = (bedel + kesif + ff) * oran / 100;
      if (yatacak === 0) return "—";
      return formatPara(yatacak - (r.yatan_prim ?? 0));
    }, getRaw: () => null },
  { key: "yatan_prim_yuzde", label: "Yatan\nPrim %", computed: true,
    getValue: (r) => {
      const bedel = r.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = r.kesif_artisi ?? 0;
      const ff = r.fiyat_farki ?? 0;
      const oran = r.iscilik_orani ?? 0;
      const yatacak = (bedel + kesif + ff) * oran / 100;
      if (yatacak === 0) return "—";
      return `%${(((r.yatan_prim ?? 0) / yatacak) * 100).toFixed(2)}`;
    }, getRaw: () => null },
  { key: "sure_uzatimi", label: "Süre Uzatımlı\nSüresi", fromSantiye: true,
    getValue: (r) => {
      const sureText = r.sure_text ?? "";
      if (!sureText) return r.santiyeler?.sure_uzatimi ? `${r.santiyeler.sure_uzatimi} gün` : "—";
      const toplam = sureText.split("+").reduce((t: number, s: string) => t + (parseInt(s.trim()) || 0), 0);
      return `${toplam} gün`;
    }, getRaw: () => null },
  { key: "is_bitim_tarihi", label: "İşin Bitim\nTarihi", fromSantiye: true,
    getValue: (r) => {
      if (r.baslangic_tarihi && r.sure_text) {
        const toplam = r.sure_text.split("+").reduce((t: number, s: string) => t + (parseInt(s.trim()) || 0), 0);
        if (toplam > 0) {
          const d = new Date(r.baslangic_tarihi);
          d.setDate(d.getDate() + toplam - 1);
          return formatTarih(d.toISOString().split("T")[0]);
        }
      }
      return formatTarih(r.santiyeler?.is_bitim_tarihi ?? null);
    }, getRaw: () => null },
  { key: "taseron_veri_isleme_tarihi", label: "Taşeron Son\nVeri Girişi", computed: true,
    getValue: (r) => r.taseron_veri_isleme_tarihi ? formatAyYil(r.taseron_veri_isleme_tarihi) : "—", getRaw: () => null },
  { key: "son_veri_girisi_tarihi", label: "Yüklenici Son\nVeri Girişi", computed: true,
    getValue: (r) => r.son_veri_girisi_tarihi ? formatAyYil(r.son_veri_girisi_tarihi) : "—", getRaw: () => null },
  { key: "toplam_son_veri_tutari", label: "Toplam Son\nVeri Tutarı", computed: true,
    getValue: (r) => formatPara(r.toplam_son_veri_tutari), getRaw: () => null },
];

// Tabloda, PDF ve Excel'de gizlenecek sütunlar
const GIZLI_SUTUNLAR = new Set(["yatan_prim_yuzde", "sure_uzatimi"]);
const VISIBLE_COLUMNS = COLUMNS.filter((c) => !GIZLI_SUTUNLAR.has(c.key));

export default function IscilikTakibiPage() {
  const [rows, setRows] = useState<IscilikTakibiWithSantiye[]>([]);
  const [loading, setLoading] = useState(true);
  const [firmaRenkMap, setFirmaRenkMap] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const [arama, setArama] = useState("");
  // Mobilde iş adı sütununu sabitleme (sticky) açık/kapalı toggle
  const [isAdiSabit, setIsAdiSabit] = useState(true);
  const [isGrupSiralama, setIsGrupSiralama] = useState<Map<string, number>>(new Map());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sekme, setSekme] = useState<"aktif" | "cop">("aktif");
  const [silinenler, setSilinenler] = useState<IscilikTakibiWithSantiye[]>([]);
  const [permanentDeleteId, setPermanentDeleteId] = useState<string | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { kullanici, isYonetici, hasPermission, loading: authLoading } = useAuth();
  const yEkle = hasPermission("iscilik-takibi", "ekle");
  const yDuzenle = hasPermission("iscilik-takibi", "duzenle");
  const ySil = hasPermission("iscilik-takibi", "sil");

  const loadData = useCallback(async () => {
    // Auth profili yüklenmeden fetch yapma — yoksa kullanici=null iken
    // isYonetici=true varsayımıyla TÜM şantiyelerin verisi yüklenir, sonra
    // profil gelince yeniden filtrelenir → ekranda flash olur.
    if (authLoading) return;
    try {
      await ensureAktifSantiyeler();
      const [data, tData, ayliklarData, firmalarData] = await Promise.all([
        getIscilikTakibi(),
        getTanimlamalar("is_grubu"),
        getTumIscilikAyliklari().catch(() => []),
        getFirmalar().catch(() => []),
      ]);
      // Firma renk map'i
      const renkMap = new Map<string, string>();
      for (const f of (firmalarData as { id: string; renk: string | null }[]) ?? []) {
        if (f.renk) renkMap.set(f.id, f.renk);
      }
      setFirmaRenkMap(renkMap);
      // İş grubu sıralama map'i
      const sMap = new Map<string, number>();
      ((tData as Tanimlama[]) ?? []).forEach((t, i) => sMap.set(t.deger, i));
      setIsGrupSiralama(sMap);

      // "MM.YYYY" veya ISO tarihini karşılaştırılabilir sayıya dönüştür (YYYYMM)
      const ayYilNumerik = (s: string): number => {
        if (!s) return 0;
        const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
        if (mm) return parseInt(mm[2]) * 100 + parseInt(mm[1]);
        const iso = s.match(/^(\d{4})-(\d{2})/);
        if (iso) return parseInt(iso[1]) * 100 + parseInt(iso[2]);
        return 0;
      };

      // Her takibi için aylık bazında en son taşeron/yüklenici aylarını ve toplam son veri tutarını hesapla
      const taseronMap = new Map<string, string>();
      const yukleniciMap = new Map<string, string>();
      // En son aya (en büyük ait_oldugu_ay) ait kayıt referansı
      const enSonAyliklar = new Map<string, { ay: string; alt: number; yuk: number }>();
      for (const a of ayliklarData as { iscilik_takibi_id: string; ait_oldugu_ay: string; alt_yuklenici_tutar: number | null; yuklenici_tutar: number | null }[]) {
        if (a.alt_yuklenici_tutar != null && a.alt_yuklenici_tutar > 0) {
          const mevcut = taseronMap.get(a.iscilik_takibi_id);
          if (!mevcut || ayYilNumerik(a.ait_oldugu_ay) > ayYilNumerik(mevcut)) taseronMap.set(a.iscilik_takibi_id, a.ait_oldugu_ay);
        }
        if (a.yuklenici_tutar != null && a.yuklenici_tutar > 0) {
          const mevcut = yukleniciMap.get(a.iscilik_takibi_id);
          if (!mevcut || ayYilNumerik(a.ait_oldugu_ay) > ayYilNumerik(mevcut)) yukleniciMap.set(a.iscilik_takibi_id, a.ait_oldugu_ay);
        }
        // Toplam son veri tutarı için: en büyük ait_oldugu_ay olan ayın alt+yüklenici toplamı
        const mevcutSon = enSonAyliklar.get(a.iscilik_takibi_id);
        const ayNum = ayYilNumerik(a.ait_oldugu_ay);
        if (!mevcutSon || ayNum > ayYilNumerik(mevcutSon.ay)) {
          enSonAyliklar.set(a.iscilik_takibi_id, {
            ay: a.ait_oldugu_ay,
            alt: a.alt_yuklenici_tutar ?? 0,
            yuk: a.yuklenici_tutar ?? 0,
          });
        }
      }

      // Kısıtlı / Şantiye admini: sadece atandığı şantiyeler görünür
      const izinliSantiyeler = !isYonetici && kullanici?.santiye_ids
        ? new Set(kullanici.santiye_ids)
        : null;

      // İş grubu sırasına göre sırala, aynı gruptakiler oluşturulma sırasına göre
      const sorted = ((data as IscilikTakibiWithSantiye[]) ?? [])
        .filter((r) => izinliSantiyeler ? izinliSantiyeler.has(r.santiye_id) : true)
        .map((r) => {
          const sonAy = enSonAyliklar.get(r.id);
          return {
            ...r,
            taseron_veri_isleme_tarihi: taseronMap.get(r.id) ?? null,
            son_veri_girisi_tarihi: yukleniciMap.get(r.id) ?? null,
            toplam_son_veri_tutari: sonAy ? sonAy.alt + sonAy.yuk : 0,
          };
        })
        .sort((a, b) => {
          const sa = sMap.get(a.santiyeler?.is_grubu ?? "") ?? 999;
          const sb = sMap.get(b.santiyeler?.is_grubu ?? "") ?? 999;
          if (sa !== sb) return sa - sb;
          const da = a.santiyeler?.created_at ?? "";
          const db = b.santiyeler?.created_at ?? "";
          return da.localeCompare(db);
        });
      setRows(sorted);
    } catch {
      toast.error("Veriler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [isYonetici, kullanici, authLoading]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  function handleCellClick(row: IscilikTakibiWithSantiye, col: ColDef) {
    if (!col.editable) return;
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    const raw = col.getRaw(row);
    setEditing({ id: row.id, santiyeId: row.santiye_id, field: col.key });
    if (col.type === "para" && raw != null) {
      setEditValue(formatPara(raw as number));
    } else {
      setEditValue(raw != null ? String(raw) : "");
    }
  }

  async function saveEdit() {
    if (!editing) return;
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    const col = COLUMNS.find((c) => c.key === editing.field);
    if (!col) { setEditing(null); return; }

    let value: string | number | null = editValue || null;
    if (col.type === "para") {
      const cleaned = editValue.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
      value = cleaned ? parseFloat(cleaned) : null;
    }

    try {
      await upsertIscilikTakibi(editing.santiyeId, { [editing.field]: value });
      setRows((prev) => prev.map((r) =>
        r.id === editing.id ? { ...r, [editing.field]: value } : r
      ));
    } catch {
      toast.error("Güncelleme hatası.");
    }
    setEditing(null);
  }

  async function handleDelete() {
    if (!deleteId) return;
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    try {
      await deleteIscilikTakibi(deleteId);
      const silinen = rows.find((r) => r.id === deleteId);
      setRows((p) => p.filter((r) => r.id !== deleteId));
      if (silinen) setSilinenler((p) => [silinen, ...p]);
      toast.success("Çöp kutusuna taşındı.");
    } catch { toast.error("Silme hatası."); }
    finally { setDeleteId(null); }
  }

  async function handleRestore(id: string) {
    try {
      await restoreIscilikTakibi(id);
      const restored = silinenler.find((r) => r.id === id);
      setSilinenler((p) => p.filter((r) => r.id !== id));
      if (restored) setRows((p) => [...p, { ...restored, silindi: false }]);
      toast.success("Geri yüklendi.");
    } catch { toast.error("Geri yükleme hatası."); }
  }

  async function handlePermanentDelete() {
    if (!permanentDeleteId) return;
    try {
      await permanentDeleteIscilikTakibi(permanentDeleteId);
      setSilinenler((p) => p.filter((r) => r.id !== permanentDeleteId));
      toast.success("Kalıcı olarak silindi.");
    } catch { toast.error("Silme hatası."); }
    finally { setPermanentDeleteId(null); }
  }

  async function loadSilinenler() {
    try {
      const data = await getSilinenIscilikTakibi();
      const izinliSantiyeler = !isYonetici && kullanici?.santiye_ids
        ? new Set(kullanici.santiye_ids)
        : null;
      const filtreli = ((data as IscilikTakibiWithSantiye[]) ?? [])
        .filter((r) => izinliSantiyeler ? izinliSantiyeler.has(r.santiye_id) : true);
      setSilinenler(filtreli);
    } catch { /* sessiz */ }
  }

  // Arama + bitmiş iş filtresi (geçici/kesin kabul, tasfiye, devir olan işler gizlenir)
  const filtrelenmis = rows.filter((r) => {
    const s = r.santiyeler;
    // Bitmiş / devredilmiş / tasfiye edilmiş işleri gizle
    const bitmis = !!(s?.gecici_kabul_tarihi || s?.kesin_kabul_tarihi || s?.tasfiye_tarihi || s?.devir_tarihi);
    if (bitmis) return false;
    // Arama filtresi
    if (!arama.trim()) return true;
    const q = arama.toLowerCase();
    const text = [
      r.santiyeler?.is_adi, r.sicil_no,
      r.baslangic_tarihi ? formatTarih(r.baslangic_tarihi) : null,
      r.santiyeler?.is_grubu,
    ].filter(Boolean).join(" ").toLowerCase();
    return text.includes(q);
  });

  // Türkçe karakter dönüşümü (PDF için)
  function tr(s: string): string {
    return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
      .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
      .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Iscilik Takibi", 14, 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${formatTarih(new Date().toISOString().slice(0, 10))}`, 14, 21);

    // PDF'den gizlenecek sütunlar
    const gizle = GIZLI_SUTUNLAR;
    const pdfColumns = COLUMNS.filter((c) => !gizle.has(c.key));

    const headers = pdfColumns.map((c) => tr(c.label.replace(/\n/g, " ")));
    const body = filtrelenmis.map((r) => pdfColumns.map((c) => tr(c.getValue(r))));

    // Kalan prim ve iş bitim tarihi sütun index'leri
    const kalanPrimIdx = pdfColumns.findIndex((c) => c.key === "kalan_prim");
    const bitimTarihiIdx = pdfColumns.findIndex((c) => c.key === "is_bitim_tarihi");

    // Toplam satırı için veri hesapla
    let kesifT = 0, fiyatFarkiT = 0, yatmasiGerekenT = 0, yatanT = 0, kalanT = 0, toplamSonVeriT = 0;
    for (const row of filtrelenmis) {
      const bedel = row.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = row.kesif_artisi ?? 0;
      const ff = row.fiyat_farki ?? 0;
      const oran = row.iscilik_orani ?? 0;
      const yatacak = (bedel + kesif + ff) * oran / 100;
      kesifT += kesif;
      fiyatFarkiT += ff;
      yatmasiGerekenT += yatacak;
      yatanT += (row.yatan_prim ?? 0);
      kalanT += (yatacak - (row.yatan_prim ?? 0));
      toplamSonVeriT += (row.toplam_son_veri_tutari ?? 0);
    }
    // PDF'te toplam satırı için her sütunun değerini bul
    const toplamMap: Record<string, string> = {
      kesif_artisi: formatPara(kesifT),
      fiyat_farki: formatPara(fiyatFarkiT),
      yatmasi_gereken_prim: formatPara(yatmasiGerekenT),
      yatan_prim: formatPara(yatanT),
      kalan_prim: formatPara(kalanT),
      toplam_son_veri_tutari: formatPara(toplamSonVeriT),
    };
    const toplamSatiri = ["", ...pdfColumns.map((c) => {
      if (c.key === "is_adi") return "TOPLAM";
      return toplamMap[c.key] ?? "";
    })];

    // Sütun bazlı hizalama: is_adi sola, para/computed (tarihler hariç) sağa, sicil_no sağa (dolu ise), diğer ortaya
    const columnStyles: Record<number, { halign: "left" | "right" | "center" }> = {};
    columnStyles[0] = { halign: "center" }; // No
    pdfColumns.forEach((c, i) => {
      const idx = i + 1;
      if (c.key === "is_adi") columnStyles[idx] = { halign: "left" };
      else if (c.key === "sicil_no") columnStyles[idx] = { halign: "right" };
      else if (c.key === "son_veri_girisi_tarihi" || c.key === "taseron_veri_isleme_tarihi" || c.key === "is_bitim_tarihi") columnStyles[idx] = { halign: "center" };
      else if (c.type === "para" || c.computed) columnStyles[idx] = { halign: "right" };
      else columnStyles[idx] = { halign: "center" };
    });

    autoTable(doc, {
      startY: 25,
      head: [["No", ...headers]],
      body: body.map((row, i) => [String(i + 1), ...row]),
      foot: [toplamSatiri],
      styles: { fontSize: 5, cellPadding: 1 },
      headStyles: { fillColor: [30, 58, 95], fontSize: 5 },
      footStyles: { fillColor: [226, 232, 240], textColor: [30, 58, 95], fontStyle: "bold", fontSize: 5 },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        // HEAD ve FOOT satırlarında da columnStyles hizalamasını zorla uygula
        if (data.section === "head" || data.section === "foot") {
          const colIdx = data.column.index;
          if (colIdx === 0) {
            data.cell.styles.halign = "center";
          } else {
            const c = pdfColumns[colIdx - 1];
            if (c) {
              if (c.key === "is_adi") data.cell.styles.halign = "left";
              else if (c.key === "sicil_no") data.cell.styles.halign = "right";
              else if (c.key === "son_veri_girisi_tarihi" || c.key === "taseron_veri_isleme_tarihi" || c.key === "is_bitim_tarihi") data.cell.styles.halign = "center";
              else if (c.type === "para" || c.computed) data.cell.styles.halign = "right";
              else data.cell.styles.halign = "center";
            }
          }
          return;
        }
        if (data.section !== "body") return;
        const row = filtrelenmis[data.row.index];
        if (!row) return;
        const colIdx = data.column.index - 1; // -1 çünkü ilk sütun "No"

        // Kalan prim renklendirmesi
        if (colIdx === kalanPrimIdx) {
          const bedel = row.santiyeler?.sozlesme_bedeli ?? 0;
          const kesif = row.kesif_artisi ?? 0;
          const ff = row.fiyat_farki ?? 0;
          const oran = row.iscilik_orani ?? 0;
          const yatacak = (bedel + kesif + ff) * oran / 100;
          const kalan = yatacak - (row.yatan_prim ?? 0);
          if (kalan < 0) data.cell.styles.textColor = [220, 38, 38];
          else if (kalan > 0) { data.cell.styles.textColor = [0, 0, 0]; data.cell.styles.fontStyle = "bold"; }
        }

        // İş bitim tarihi renklendirmesi
        if (colIdx === bitimTarihiIdx) {
          let bitimStr: string | null = null;
          if (row.baslangic_tarihi && row.sure_text) {
            const toplam = row.sure_text.split("+").reduce((t: number, s: string) => t + (parseInt(s.trim()) || 0), 0);
            if (toplam > 0) {
              const d = new Date(row.baslangic_tarihi);
              d.setDate(d.getDate() + toplam - 1);
              bitimStr = d.toISOString().split("T")[0];
            }
          } else {
            bitimStr = row.santiyeler?.is_bitim_tarihi ?? null;
          }
          if (bitimStr) {
            const kalanGun = Math.ceil((new Date(bitimStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            if (kalanGun <= 30) data.cell.styles.textColor = [220, 38, 38];
            else if (kalanGun <= 60) data.cell.styles.textColor = [249, 115, 22];
          }
        }
      },
    });
    doc.save("iscilik-takibi.pdf");
  }

  function exportExcel() {
    const gizle = GIZLI_SUTUNLAR;
    const excelColumns = COLUMNS.filter((c) => !gizle.has(c.key));
    const headers = ["No", ...excelColumns.map((c) => c.label.replace(/\n/g, " "))];
    const data = filtrelenmis.map((r, i) => [i + 1, ...excelColumns.map((c) => c.getValue(r))]);

    // Toplam satırı
    let kesifT = 0, fiyatFarkiT = 0, yatmasiGerekenT = 0, yatanT = 0, kalanT = 0, toplamSonVeriT = 0;
    for (const row of filtrelenmis) {
      const bedel = row.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = row.kesif_artisi ?? 0;
      const ff = row.fiyat_farki ?? 0;
      const oran = row.iscilik_orani ?? 0;
      const yatacak = (bedel + kesif + ff) * oran / 100;
      kesifT += kesif;
      fiyatFarkiT += ff;
      yatmasiGerekenT += yatacak;
      yatanT += (row.yatan_prim ?? 0);
      kalanT += (yatacak - (row.yatan_prim ?? 0));
      toplamSonVeriT += (row.toplam_son_veri_tutari ?? 0);
    }
    const toplamMap: Record<string, string> = {
      kesif_artisi: formatPara(kesifT),
      fiyat_farki: formatPara(fiyatFarkiT),
      yatmasi_gereken_prim: formatPara(yatmasiGerekenT),
      yatan_prim: formatPara(yatanT),
      kalan_prim: formatPara(kalanT),
      toplam_son_veri_tutari: formatPara(toplamSonVeriT),
    };
    const toplamRow = ["", ...excelColumns.map((c) => {
      if (c.key === "is_adi") return "TOPLAM";
      return toplamMap[c.key] ?? "";
    })];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data, toplamRow]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Iscilik Takibi");
    XLSX.writeFile(wb, "iscilik-takibi.xlsx");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ClipboardList size={28} className="text-[#1E3A5F]" />
          <div>
            <h1 className="text-2xl font-bold text-[#1E3A5F]">İşçilik Takibi</h1>
            <p className="text-sm text-gray-500">Şantiye bazlı prim ve veri takibi</p>
        </div>
      </div>
      </div>

      {/* Arama ve Export */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="İş adı, sicil no ile ara..." value={arama} onChange={(e) => setArama(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          {/* Mobilde iş adı sabit/kayar toggle — masaüstünde gizli */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAdiSabit((v) => !v)}
            className="md:hidden"
            title={isAdiSabit ? "İş adı sütununu serbestçe kaydır" : "İş adı sütununu sabitle"}
          >
            {isAdiSabit ? "🔒 İş Adı Sabit" : "🔓 İş Adı Kayar"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={16} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={16} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Sekme butonları */}
      <div className="flex gap-2 mb-4">
        <Button variant={sekme === "aktif" ? "default" : "outline"} size="sm"
          onClick={() => setSekme("aktif")} className={sekme === "aktif" ? "bg-[#64748B]" : ""}>
          İşçilik Takibi
        </Button>
        <Button variant={sekme === "cop" ? "default" : "outline"} size="sm"
          onClick={() => { setSekme("cop"); loadSilinenler(); }}
          className={sekme === "cop" ? "bg-red-500" : ""}>
          <Trash size={14} className="mr-1" /> Çöp Kutusu {silinenler.length > 0 && `(${silinenler.length})`}
        </Button>
      </div>

      {sekme === "cop" ? (
        /* Çöp Kutusu */
        silinenler.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <Trash size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Çöp kutusu boş.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-500">
                  <TableHead className="text-white text-xs px-2">İşin Adı</TableHead>
                  <TableHead className="text-white text-xs px-2">Sicil No</TableHead>
                  <TableHead className="text-white text-xs px-2 text-center">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {silinenler.map((s) => (
                  <TableRow key={s.id} className="text-xs">
                    <TableCell className="px-2 font-medium">{s.santiyeler?.is_adi ?? "—"}</TableCell>
                    <TableCell className="px-2">{s.sicil_no ?? "—"}</TableCell>
                    <TableCell className="px-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleRestore(s.id)} className="text-green-600 border-green-600 hover:bg-green-50">
                          <RotateCcw size={13} className="mr-1" /> Geri Yükle
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setPermanentDeleteId(s.id)} className="text-red-500 border-red-500 hover:bg-red-50">
                          <Trash2 size={13} className="mr-1" /> Kalıcı Sil
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <ClipboardList size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">Henüz aktif şantiye yok.</p>
          <p className="text-gray-400 text-sm mt-1">Şantiyeler sekmesinden iş ekleyince burada otomatik görünecek.</p>
        </div>
      ) : (
        <div
          className={`bg-white rounded-lg border border-gray-200 overflow-x-auto ${rows.length > 16 ? "overflow-y-auto" : ""}`}
          style={rows.length > 16 ? { maxHeight: "calc(100vh - 280px)" } : undefined}
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white font-semibold text-center text-[10px] px-2 min-w-[32px] max-w-[32px]">No</TableHead>
                {VISIBLE_COLUMNS.map((col) => {
                  const hasTwoLines = col.label.includes("\n");
                  // Sayısal/para sütunları sağa yaslı başlık (body ile aynı eksende)
                  const tarihSutunu = col.key === "is_bitim_tarihi" || col.key === "taseron_veri_isleme_tarihi" || col.key === "son_veri_girisi_tarihi";
                  const sayisal = (col.type === "para" || col.computed) && !tarihSutunu;
                  const basliHizalama = col.key === "is_adi" ? "text-left" : sayisal ? "text-right" : "text-center";
                  const isIsAdi = col.key === "is_adi";
                  return (
                    <TableHead key={col.key}
                      style={isIsAdi && isAdiSabit ? { position: "sticky", left: 0, zIndex: 20, backgroundColor: "#64748B" } : undefined}
                      className={`text-white font-semibold ${basliHizalama} text-[10px] px-1.5 ${hasTwoLines ? "whitespace-pre-line leading-tight" : "whitespace-nowrap"} ${isIsAdi ? `min-w-[180px] max-w-[220px]${isAdiSabit ? " shadow-[2px_0_3px_rgba(0,0,0,0.15)]" : ""}` : "min-w-[52px]"}`}>
                      {col.label}
                    </TableHead>
                  );
                })}
                <TableHead className="text-white font-semibold text-center text-[10px] px-1 min-w-[30px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((row, idx) => {
                const gk = row.santiyeler?.gecici_kabul_tarihi;
                const kk = row.santiyeler?.kesin_kabul_tarihi;
                const isPasif = (!!gk && gk !== "0001-01-01" && new Date(gk).getFullYear() > 2000)
                  || (!!kk && kk !== "0001-01-01" && new Date(kk).getFullYear() > 2000);
                const firmaRengi = row.santiyeler?.yuklenici_firma_id ? firmaRenkMap.get(row.santiyeler.yuklenici_firma_id) : null;
                return (
                <TableRow key={row.id}
                  style={firmaRengi ? { borderLeft: `5px solid ${firmaRengi}` } : undefined}
                  className={`text-xs ${isPasif ? "bg-gray-100 opacity-50" : idx % 2 === 1 ? "bg-slate-100 hover:bg-slate-200" : "hover:bg-gray-50"}`}>
                  <TableCell className="text-center px-2 text-gray-500 min-w-[32px] max-w-[32px]">{idx + 1}</TableCell>
                  {VISIBLE_COLUMNS.map((col) => {
                    const isEditing = editing?.id === row.id && editing?.field === col.key;

                    // Kalan prim renklendirmesi
                    let kalanPrimClass = "";
                    if (col.key === "kalan_prim") {
                      const bedel = row.santiyeler?.sozlesme_bedeli ?? 0;
                      const kesif = row.kesif_artisi ?? 0;
                      const ff = row.fiyat_farki ?? 0;
                      const oran = row.iscilik_orani ?? 0;
                      const yatacak = (bedel + kesif + ff) * oran / 100;
                      const kalan = yatacak - (row.yatan_prim ?? 0);
                      if (kalan < 0) kalanPrimClass = " text-red-600 font-bold";
                      else if (kalan > 0) kalanPrimClass = " text-gray-900 font-bold";
                    }

                    // İş bitim tarihi renklendirmesi
                    let bitimTarihiClass = "";
                    if (col.key === "is_bitim_tarihi") {
                      let bitimStr: string | null = null;
                      if (row.baslangic_tarihi && row.sure_text) {
                        const toplam = row.sure_text.split("+").reduce((t: number, s: string) => t + (parseInt(s.trim()) || 0), 0);
                        if (toplam > 0) {
                          const d = new Date(row.baslangic_tarihi);
                          d.setDate(d.getDate() + toplam - 1);
                          bitimStr = d.toISOString().split("T")[0];
                        }
                      } else {
                        bitimStr = row.santiyeler?.is_bitim_tarihi ?? null;
                      }
                      if (bitimStr) {
                        const kalanGun = Math.ceil((new Date(bitimStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        if (kalanGun < 0) bitimTarihiClass = " text-red-600 font-bold";
                        else if (kalanGun <= 30) bitimTarihiClass = " text-red-600 font-bold";
                        else if (kalanGun <= 60) bitimTarihiClass = " text-orange-500 font-bold";
                      }
                    }

                    // Hizalama önceliği: is_adi → sola, para/computed/sicil_no(doluysa) → sağa, diğer → ortala
                    const sicilNoDolu = col.key === "sicil_no" && !!row.sicil_no;
                    const sagaYasliMi = sicilNoDolu
                      || ((col.type === "para" || col.computed)
                          && col.key !== "son_veri_girisi_tarihi"
                          && col.key !== "taseron_veri_isleme_tarihi"
                          && col.key !== "is_bitim_tarihi");
                    const hizalama = col.key === "is_adi"
                      ? "text-left font-medium max-w-[260px]"
                      : sagaYasliMi
                        ? "text-right tabular-nums"
                        : "text-center";
                    // is_adi için whitespace-normal — iş adı sara sara tam görünsün
                    const wsClass = col.key === "is_adi" ? "whitespace-normal leading-tight" : "whitespace-nowrap";
                    // İş adı sütunu STICKY — yatay kaydırırken sabit kalır (toggle ile kapatılabilir)
                    const isIsAdi = col.key === "is_adi";
                    const stickyStyle = isIsAdi && isAdiSabit ? { position: "sticky" as const, left: 0, zIndex: 5 } : undefined;
                    const stickyCls = isIsAdi && isAdiSabit ? "shadow-[2px_0_3px_rgba(0,0,0,0.15)]" : "";
                    // Sticky hücrenin arka planı satırın rengine göre
                    const stickyBg = isIsAdi && isAdiSabit
                      ? (isPasif ? "bg-gray-100" : idx % 2 === 1 ? "bg-slate-100" : "bg-white")
                      : "";
                    const cellClass = `px-2 ${wsClass} ${stickyCls} ${stickyBg} ${col.editable ? "cursor-pointer hover:bg-blue-50" : ""} ${hizalama}${kalanPrimClass}${bitimTarihiClass}`;

                    if (isEditing) {
                      return (
                        <TableCell key={col.key} style={stickyStyle} className={cellClass}>
                          <Input ref={inputRef}
                            type={col.type === "date" ? "date" : "text"}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }}
                            className="h-6 text-xs px-1 min-w-[80px]" />
                        </TableCell>
                      );
                    }

                    // İş adına tıklayınca detay sayfasına git
                    if (col.key === "is_adi") {
                      return (
                        <TableCell key={col.key} style={stickyStyle} className={cellClass + " cursor-pointer text-[#1E3A5F] hover:text-[#F97316]"}
                          title={row.santiyeler?.is_adi}
                          onClick={() => router.push(`/dashboard/iscilik-takibi/${row.id}`)}>
                          <span className="inline-flex items-start gap-1.5">
                            {firmaRengi && <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: firmaRengi }} />}
                            <span>{col.getValue(row)}</span>
                          </span>
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell key={col.key} style={stickyStyle} className={cellClass}
                        onClick={() => col.editable ? handleCellClick(row, col) : undefined}>
                        {col.getValue(row)}
                      </TableCell>
                    );
                  })}
                  {/* Silme butonu */}
                  <TableCell className="text-center px-1">
                    {ySil && (
                      <button onClick={() => setDeleteId(row.id)} className="text-gray-300 hover:text-red-500 p-0.5" title="Sil">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
              {/* Toplam satırı — Sözleşme Bedeli hariç tüm tutarların toplamı */}
              {(() => {
                let kesifT = 0, fiyatFarkiT = 0, yatmasiGerekenT = 0, yatanT = 0, kalanT = 0, toplamSonVeriT = 0;
                for (const row of filtrelenmis) {
                  const bedel = row.santiyeler?.sozlesme_bedeli ?? 0;
                  const kesif = row.kesif_artisi ?? 0;
                  const ff = row.fiyat_farki ?? 0;
                  const oran = row.iscilik_orani ?? 0;
                  const yatacak = (bedel + kesif + ff) * oran / 100;
                  kesifT += kesif;
                  fiyatFarkiT += ff;
                  yatmasiGerekenT += yatacak;
                  yatanT += (row.yatan_prim ?? 0);
                  kalanT += (yatacak - (row.yatan_prim ?? 0));
                  toplamSonVeriT += (row.toplam_son_veri_tutari ?? 0);
                }
                // Her VISIBLE_COLUMN için TOPLAM satırı değeri
                const toplamDegerMap: Record<string, { deger: string; hizalama: "left" | "right" | "center" }> = {
                  is_adi: { deger: "TOPLAM", hizalama: "left" },
                  sozlesme_bedeli: { deger: "—", hizalama: "center" },
                  kesif_artisi: { deger: formatPara(kesifT), hizalama: "right" },
                  fiyat_farki: { deger: formatPara(fiyatFarkiT), hizalama: "right" },
                  yatmasi_gereken_prim: { deger: formatPara(yatmasiGerekenT), hizalama: "right" },
                  yatan_prim: { deger: formatPara(yatanT), hizalama: "right" },
                  kalan_prim: { deger: formatPara(kalanT), hizalama: "right" },
                  is_bitim_tarihi: { deger: "", hizalama: "center" },
                  taseron_veri_isleme_tarihi: { deger: "", hizalama: "center" },
                  son_veri_girisi_tarihi: { deger: "", hizalama: "center" },
                  toplam_son_veri_tutari: { deger: formatPara(toplamSonVeriT), hizalama: "right" },
                };
                return (
                  <TableRow
                    style={{ borderLeft: "5px solid transparent" }}
                    className="text-xs bg-[#1E3A5F]/10 border-t-2 border-[#1E3A5F] hover:bg-[#1E3A5F]/10">
                    <TableCell className="text-center px-2 text-[#1E3A5F] whitespace-nowrap min-w-[32px] max-w-[32px]">—</TableCell>
                    {VISIBLE_COLUMNS.map((col) => {
                      const d = toplamDegerMap[col.key] ?? { deger: "", hizalama: "center" as const };
                      const hCls = d.hizalama === "left" ? "text-left font-bold" : d.hizalama === "right" ? "text-right tabular-nums" : "text-center";
                      const textCls = d.deger === "—" ? "text-gray-400" : "text-[#1E3A5F]";
                      const isIsAdi = col.key === "is_adi";
                      const stickyStyle = isIsAdi && isAdiSabit
                        ? { position: "sticky" as const, left: 0, zIndex: 5, backgroundColor: "#dde3ed" }
                        : undefined;
                      const stickyShadow = isIsAdi && isAdiSabit ? " shadow-[2px_0_3px_rgba(0,0,0,0.15)]" : "";
                      return (
                        <TableCell key={col.key} style={stickyStyle} className={`px-2 whitespace-nowrap ${hCls} ${textCls}${stickyShadow}`}>
                          {d.deger}
                        </TableCell>
                      );
                    })}
                    <TableCell className="px-1" />
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Çöp kutusuna taşıma onayı */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Çöp kutusuna taşımak istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Veriler silinmez, çöp kutusundan geri yükleyebilirsiniz.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">Çöp Kutusuna Taşı</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Kalıcı silme onayı */}
      <AlertDialog open={!!permanentDeleteId} onOpenChange={() => setPermanentDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kalıcı olarak silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Bu işlem geri alınamaz. Tüm aylık veriler de silinecektir.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handlePermanentDelete} className="bg-red-500 hover:bg-red-600">Kalıcı Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
