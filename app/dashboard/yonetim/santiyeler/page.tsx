// Şantiye listesi - Inline düzenleme (sadece gerçekleşen tutar), Yi-ÜFE hesaplamaları
"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getSantiyeler,
  toggleSantiyeDurum,
  updateSantiye,
  getTumOrtaklar,
  getTumSantiyeIsGruplari,
} from "@/lib/supabase/queries/santiyeler";
import type { SantiyeOrtagi, SantiyeIsGrubu } from "@/lib/supabase/types";
import { getYiUfeVerileri } from "@/lib/supabase/queries/yi-ufe";
import { getTanimlamalar, getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import type { Tanimlama } from "@/lib/supabase/types";
import type { SantiyeWithRelations, YiUfe, SantiyeUpdate } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, HardHat, Pencil, ArrowUp, ArrowDown, Download, Search, FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

type Filtre = "tumu" | "aktif" | "tamamlandi" | "tasfiye" | "devir";
type SortDir = "asc" | "desc";
type SortConfig = { key: string; dir: SortDir };
type EditingCell = { id: string; field: string } | null;

function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}
function formatTarih(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}
function formatPara(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function getYiUfeAyindaki(yiUfeData: YiUfe[], tarih: string | null): number | null {
  if (!tarih || yiUfeData.length === 0) return null;
  const d = new Date(tarih);
  return yiUfeData.find((v) => v.yil === d.getFullYear() && v.ay === d.getMonth() + 1)?.endeks ?? null;
}
// İhale/ilan tarihinden BİR ÖNCEKİ ayın Yi-ÜFE'si (sözleşme Yi-ÜFE'si)
function getYiUfeOncekiAy(yiUfeData: YiUfe[], tarih: string | null): number | null {
  if (!tarih || yiUfeData.length === 0) return null;
  const d = new Date(tarih);
  let yil = d.getFullYear();
  let ay = d.getMonth(); // getMonth() 0-based → Ocak=0, bu da 1-based'da bir önceki ay
  if (ay < 1) { ay = 12; yil -= 1; } // Ocak ise → önceki yılın Aralık'ı
  return yiUfeData.find((v) => v.yil === yil && v.ay === ay)?.endeks ?? null;
}
// Temel endeks: ilan tarihinden BİR SONRAKI ayın Yi-ÜFE'si
function getYiUfeSonrakiAy(yiUfeData: YiUfe[], tarih: string | null): number | null {
  if (!tarih || yiUfeData.length === 0) return null;
  const d = new Date(tarih);
  let yil = d.getFullYear();
  let ay = d.getMonth() + 2; // getMonth() 0-based + 2 = sonraki ay (1-based)
  if (ay > 12) { ay = 1; yil += 1; }
  return yiUfeData.find((v) => v.yil === yil && v.ay === ay)?.endeks ?? null;
}
function getGuncelYiUfe(yiUfeData: YiUfe[]): number | null {
  if (yiUfeData.length === 0) return null;
  return yiUfeData.reduce((max, v) => v.yil > max.yil || (v.yil === max.yil && v.ay > max.ay) ? v : max).endeks;
}

// Durum belirleme: geçici kabul tarihi varsa → kesin kabul bekliyor, tasfiye tarihi varsa → tasfiye
function getDurum(s: SantiyeWithRelations): string {
  if (s.devir_tarihi) return "Devir";
  if (s.tasfiye_tarihi) return "Tasfiye";
  if (s.kesin_kabul_tarihi) return "Tamamlandı";
  if (s.gecici_kabul_tarihi) return "Kesin Kabul Bekleniyor";
  return "Devam Ediyor";
}
function isDimmed(s: SantiyeWithRelations): boolean {
  return !!s.gecici_kabul_tarihi || !!s.tasfiye_tarihi || !!s.devir_tarihi;
}

// Sütun başlıkları
const HEADER_LABELS: { key: string; label: string; twoLine?: boolean }[] = [
  { key: "sira_no", label: "Sıra No" },
  { key: "is_grubu", label: "İş Tanımları" },
  { key: "ekap_belge_no", label: "Ekap Belge No" },
  { key: "is_adi", label: "İşin Adı" },
  { key: "ihale_kayit_no", label: "İhale Kayıt No" },
  { key: "sozlesme_tarihi", label: "Sözleşme Tarihi" },
  { key: "ff_dahil_kalan", label: "F.F. Dahil\nKalan Tutar", twoLine: true },
  { key: "gerceklesen", label: "Sözl. Fiy.\nGerçekleşen", twoLine: true },
  { key: "gecici_kabul", label: "Geçici Kabul" },
  { key: "kesin_kabul", label: "Kesin Kabul" },
  { key: "is_deneyim", label: "İş Deneyim" },
  { key: "durum", label: "Durum" },
  { key: "guncel_deneyim", label: "Güncel İş\nDeneyim Tutarı", twoLine: true },
  { key: "ff_yuzde", label: "Fiyat Farkı" },
];

type RowCalc = {
  sozYiUfe: number | null;
  ffBazYiUfe: number | null;
  enSonYiUfe: number | null;
  ffYuzde: number | null;
  ffDahilKalan: number | null;
  yiufeOrani: number | null; // güncelYiÜFE / sözleşmeYiÜFE
  guncelDeneyim: number | null;
};

export default function SantiyelerPage() {
  const [santiyeler, setSantiyeler] = useState<SantiyeWithRelations[]>([]);
  const [ortaklarData, setOrtaklarData] = useState<(SantiyeOrtagi & { firmalar?: { firma_adi: string } })[]>([]);
  const [isGrupDagilimData, setIsGrupDagilimData] = useState<SantiyeIsGrubu[]>([]);
  const [ffKatsayi, setFfKatsayi] = useState<number>(1); // Fiyat farkı katsayı oranı (tanımlamalardan)
  const [yiUfeData, setYiUfeData] = useState<YiUfe[]>([]);
  const [isGrupSiralama, setIsGrupSiralama] = useState<Map<string, number>>(new Map());
  const [isGruplari, setIsGruplari] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState<Filtre>("tumu");
  const [isGrupFiltre, setIsGrupFiltre] = useState<string>("tumu");
  const [firmaFiltre, setFirmaFiltre] = useState<string>("tumu");
  const [arama, setArama] = useState("");
  const [sorts, setSorts] = useState<SortConfig[]>([]);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const [tasfiyeDialog, setTasfiyeDialog] = useState<string | null>(null);
  const [tasfiyeTarihi, setTasfiyeTarihi] = useState(new Date().toISOString().split("T")[0]);
  // Yi-ÜFE katsayı override: "" = en son otomatik, "yil-ay" = seçilen ay
  const [katsayiSeciliAy, setKatsayiSeciliAy] = useState<string>("");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [sData, yData, tData, oData, igData, ffKatData] = await Promise.all([
        getSantiyeler(), getYiUfeVerileri(), getTanimlamalar("is_tanimlari"),
        getTumOrtaklar().catch(() => []),
        getTumSantiyeIsGruplari().catch(() => []),
        getDegerler("fiyat_farki_katsayi_orani").catch(() => []),
      ]);
      setSantiyeler((sData as SantiyeWithRelations[]) ?? []);
      setOrtaklarData(oData);
      setIsGrupDagilimData(igData);
      // Fiyat farkı katsayısını al (ilk değer, sayıya çevir)
      const katDeger = (ffKatData as string[]).find((v) => v !== "(boş)" && v.trim());
      if (katDeger) {
        const parsed = parseFloat(katDeger.replace(",", "."));
        if (!isNaN(parsed) && parsed > 0) setFfKatsayi(parsed);
      }
      setYiUfeData(yData ?? []);
      // İş grubu sıralama map'i ve liste
      const tItems = (tData as Tanimlama[]) ?? [];
      const sMap = new Map<string, number>();
      tItems.forEach((t, i) => sMap.set(t.deger, i));
      setIsGrupSiralama(sMap);
      setIsGruplari(tItems.map((t) => t.deger));
    } catch { toast.error("Veriler yüklenirken hata oluştu."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const otomatikYiUfe = getGuncelYiUfe(yiUfeData);
  // En son Yi-ÜFE ayını bul
  const enSonYiUfeAy = yiUfeData.length > 0
    ? yiUfeData.reduce((max, v) => v.yil > max.yil || (v.yil === max.yil && v.ay > max.ay) ? v : max)
    : null;
  // Yi-ÜFE ay seçenekleri (tarihe göre sıralı, en yeni üstte)
  // + en son açıklanan aydan bir sonraki ayı da ekle (son veriye ulaşmak için)
  const yiUfeAySecenekleri = useMemo(() => {
    const sirali = [...yiUfeData].sort((a, b) =>
      b.yil !== a.yil ? b.yil - a.yil : b.ay - a.ay,
    );
    // En son aydan bir sonraki ayı başa ekle
    if (enSonYiUfeAy) {
      let sonrakiYil = enSonYiUfeAy.yil;
      let sonrakiAy = enSonYiUfeAy.ay + 1;
      if (sonrakiAy > 12) { sonrakiAy = 1; sonrakiYil += 1; }
      // Zaten listede yoksa ekle (sanal ay — endeksi yok ama seçilince önceki ay = en son veri)
      if (!sirali.some((v) => v.yil === sonrakiYil && v.ay === sonrakiAy)) {
        sirali.unshift({ id: "sonraki-ay", yil: sonrakiYil, ay: sonrakiAy, endeks: 0, created_at: "" });
      }
    }
    return sirali;
  }, [yiUfeData, enSonYiUfeAy]);
  // Seçili ay: varsayılan = en son verinin bir sonraki ayı (böylece en son veri otomatik gelir)
  const varsayilanAyKey = enSonYiUfeAy
    ? (() => { let y = enSonYiUfeAy.yil; let a = enSonYiUfeAy.ay + 1; if (a > 12) { a = 1; y += 1; } return `${y}-${a}`; })()
    : "";
  const seciliAyKey = katsayiSeciliAy || varsayilanAyKey;
  // Bir önceki ayı hesapla
  const seciliParts = seciliAyKey.split("-").map(Number);
  let oncekiYil = seciliParts[0] ?? 0;
  let oncekiAy = (seciliParts[1] ?? 1) - 1;
  if (oncekiAy < 1) { oncekiAy = 12; oncekiYil -= 1; }
  const oncekiAyVeri = yiUfeData.find((v) => v.yil === oncekiYil && v.ay === oncekiAy);
  const guncelYiUfe = oncekiAyVeri?.endeks ?? otomatikYiUfe;

  // ortakOrani: null ise şantiyenin kendi ortaklik_orani kullanılır
  function calc(s: SantiyeWithRelations, ortakOrani?: number | null): RowCalc {
    // Güncel Deneyim için: ihale tarihinden BİR ÖNCEKİ ayın endeksi
    const sozYiUfe = getYiUfeOncekiAy(yiUfeData, s.ihale_tarihi);
    // Fiyat Farkı için: ihale tarihinin BULUNDUĞU ayın endeksi
    const ffBazYiUfe = getYiUfeAyindaki(yiUfeData, s.ihale_tarihi);

    // En son Yi-ÜFE: aktifse en son açıklanan, geçici kabul varsa o tarihteki, tasfiye varsa o tarihteki
    let enSonYiUfe: number | null = null;
    if (s.tasfiye_tarihi) {
      enSonYiUfe = getYiUfeAyindaki(yiUfeData, s.tasfiye_tarihi) ?? guncelYiUfe;
    } else if (!s.gecici_kabul_tarihi) {
      enSonYiUfe = guncelYiUfe;
    }

    // Fiyat Farkı = ((enSonYiUfe / ihale ayı Yi-ÜFE) - 1) × fiyatFarkıKatsayı
    const ffYuzde = enSonYiUfe && ffBazYiUfe ? ((enSonYiUfe / ffBazYiUfe) - 1) * ffKatsayi * 100 : null;

    // FF Dahil Kalan sadece devam eden işlerde gösterilir
    // Geçici kabul, kesin kabul, devir veya tasfiye tarihi varsa null
    const devamEdiyor = !s.gecici_kabul_tarihi && !s.kesin_kabul_tarihi && !s.devir_tarihi && !s.tasfiye_tarihi;
    const kalan = devamEdiyor && s.sozlesme_bedeli != null && s.sozlesme_fiyatlariyla_gerceklesen != null
      ? s.sozlesme_bedeli - s.sozlesme_fiyatlariyla_gerceklesen : null;
    const ffDahilKalan = kalan != null && ffYuzde != null ? kalan * (ffYuzde / 100) + kalan : null;

    // Yi-ÜFE oranı (güncel / sözleşme)
    const yiufeOrani = guncelYiUfe && sozYiUfe ? guncelYiUfe / sozYiUfe : null;

    // Güncel İş Deneyim — ortakOrani parametresi öncelikli, yoksa şantiyenin kendi oranı
    const oran = ortakOrani ?? s.ortaklik_orani;
    const guncelDeneyim = yiufeOrani && s.sozlesme_fiyatlariyla_gerceklesen && oran
      ? yiufeOrani * s.sozlesme_fiyatlariyla_gerceklesen * oran / 100 : null;

    return { sozYiUfe, ffBazYiUfe, enSonYiUfe, ffYuzde, ffDahilKalan, yiufeOrani, guncelDeneyim };
  }

  // Sıralama
  function handleSort(key: string) {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx === prev.length - 1 && idx >= 0) {
        const n = [...prev]; n[idx] = { key, dir: prev[idx].dir === "asc" ? "desc" : "asc" }; return n;
      }
      if (idx >= 0) return [...prev.filter((s) => s.key !== key), { key, dir: "asc" }];
      return [...(prev.length >= 2 ? [prev[prev.length - 1]] : prev), { key, dir: "asc" }];
    });
  }

  function sortData(data: SantiyeWithRelations[]) {
    if (sorts.length === 0) return data;
    return [...data].sort((a, b) => {
      for (const sort of sorts) {
        const va = getSortVal(a, sort.key);
        const vb = getSortVal(b, sort.key);
        let cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "tr");
        if (cmp !== 0) return sort.dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }

  function getSortVal(s: SantiyeWithRelations, key: string): string | number {
    const c = calc(s);
    const map: Record<string, string | number> = {
      sira_no: s.sira_no, is_grubu: s.is_grubu ?? "", ekap_belge_no: s.ekap_belge_no ?? "",
      is_adi: s.is_adi, ihale_kayit_no: s.ihale_kayit_no ?? "", sozlesme_tarihi: s.sozlesme_tarihi ?? "",
      ff_dahil_kalan: c.ffDahilKalan ?? 0, gerceklesen: s.sozlesme_fiyatlariyla_gerceklesen ?? 0,
      gecici_kabul: s.gecici_kabul_tarihi ?? "", kesin_kabul: s.kesin_kabul_tarihi ?? "",
      is_deneyim: s.is_deneyim_url ? 1 : 0, durum: s.durum,
      guncel_deneyim: c.guncelDeneyim ?? 0, ff_yuzde: c.ffYuzde ?? 0,
    };
    return map[key] ?? "";
  }

  // Inline düzenleme (sadece gerçekleşen tutar)
  function handleGerceklesenClick(id: string, raw: number | null) {
    setEditing({ id, field: "sozlesme_fiyatlariyla_gerceklesen" });
    setEditValue(raw != null ? formatPara(raw) : "");
  }

  async function saveEdit() {
    if (!editing) return;
    // editKey formatı: "santiyeId-oran" veya "santiyeId-ana"
    const santiyeId = editing.id.replace(/-[^-]+$/, "");
    const cleaned = editValue.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const value = cleaned ? parseFloat(cleaned) : null;
    try {
      await updateSantiye(santiyeId, { sozlesme_fiyatlariyla_gerceklesen: value } as SantiyeUpdate);
      // Aynı şantiye tüm firma gruplarında gösterilir — hepsinde güncellenir
      setSantiyeler((prev) => prev.map((s) => s.id === santiyeId ? { ...s, sozlesme_fiyatlariyla_gerceklesen: value } : s));
    } catch { toast.error("Güncelleme hatası."); }
    setEditing(null);
  }

  function santiyeExportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();

    // Sol üst: başlık
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Santiyeler", 14, 12);

    // Sağ üst: Yi-ÜFE bilgisi — ekrandaki seçili ay + bir önceki ayın değeri
    const ayAdlariFull = ["Ocak","Subat","Mart","Nisan","Mayis","Haziran","Temmuz","Agustos","Eylul","Ekim","Kasim","Aralik"];
    const seciliAyNum = seciliParts[1] ?? 1;
    const seciliYilNum = seciliParts[0] ?? 0;
    const seciliAyAdi = `${ayAdlariFull[(seciliAyNum - 1)] ?? ""} ${seciliYilNum}`;
    const yiUfeStr = guncelYiUfe != null ? guncelYiUfe.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(`Yi-UFE Orani: ${seciliAyAdi} ${yiUfeStr}`, pageW - 14, 11, { align: "right" });
    doc.setFont("helvetica", "normal");

    const head = [[
      "No", tr("Is Tanimlari"), tr("Ihale Kayit No"), "Durum",
      "Ekap Belge No", tr("Isin Adi"),
      tr("Sozlesme Tarihi"),
      "F.F. Dahil\nKalan Tutar", tr("Sozl. Fiy.\nGerceklesen"),
      tr("Gecici Kabul"), "Kesin Kabul", tr("Is Deneyim"),
      tr("Guncel Is\nDeneyim Tutari"), tr("Fiyat Farki"),
    ]];

    let startY = 20;

    for (const grup of firmaGruplari) {
      // Firma başlığı — ortada, koyu arka plan
      doc.setFillColor(21, 45, 74);
      doc.rect(14, startY, pageW - 28, 6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
      doc.text(tr(grup.firmaAdi), pageW / 2, startY + 4, { align: "center" });
      doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");

      const body: string[][] = [];
      for (let si = 0; si < grup.satirlar.length; si++) {
        const satir = grup.satirlar[si];
        const s = satir.santiye;
        const c = calc(s, satir.ortakOrani);
        body.push([
          String(si + 1),
          tr(s.is_grubu ?? "—"),
          s.ihale_kayit_no ?? "—",
          tr(getDurum(s)),
          s.ekap_belge_no ?? "—",
          tr(s.is_adi),
          formatTarih(s.sozlesme_tarihi),
          c.ffDahilKalan != null ? formatPara(c.ffDahilKalan) : "—",
          s.sozlesme_fiyatlariyla_gerceklesen != null ? formatPara(s.sozlesme_fiyatlariyla_gerceklesen) : "—",
          formatTarih(s.gecici_kabul_tarihi),
          formatTarih(s.kesin_kabul_tarihi),
          s.tasfiye_tarihi ? "—" : s.is_deneyim_url ? "Var" : "Yok",
          c.guncelDeneyim != null ? formatPara(c.guncelDeneyim) : "—",
          c.ffYuzde != null ? `%${c.ffYuzde.toFixed(2)}` : "—",
        ]);
      }

      autoTable(doc, {
        startY: startY + 7, head, body,
        styles: { fontSize: 5.5, cellPadding: 1, halign: "right" },
        headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 5.5, halign: "center" },
        columnStyles: {
          0: { cellWidth: 7, halign: "center" },
          1: { halign: "left" },
          2: { halign: "left" },
          3: { halign: "left" },
          4: { halign: "center" },
          5: { cellWidth: 32, halign: "left" },
          6: { halign: "center" },
          9: { halign: "center" },
          10: { halign: "center" },
          11: { halign: "center" },
        },
      });

      startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

      // Sayfa taşarsa yeni sayfa
      if (startY > doc.internal.pageSize.getHeight() - 15) {
        doc.addPage();
        startY = 15;
      }
    }
    doc.save("santiyeler.pdf");
  }

  function santiyeExportExcel() {
    const headers = ["Firma", "İş Adı", "İş Tanımları", "Sözleşme Tarihi", "Gerçekleşen", "FF Dahil Kalan", "Yi-ÜFE Oranı", "Güncel Deneyim", "Durum"];
    const data: (string | number)[][] = [];
    for (const grup of firmaGruplari) {
      for (const satir of grup.satirlar) {
        const s = satir.santiye;
        const c = calc(s, satir.ortakOrani);
        data.push([
          grup.firmaAdi, s.is_adi, s.is_grubu ?? "",
          formatTarih(s.sozlesme_tarihi),
          s.sozlesme_fiyatlariyla_gerceklesen ?? "",
          c.ffDahilKalan ?? "",
          c.yiufeOrani != null ? Number(c.yiufeOrani.toFixed(6)) : "",
          c.guncelDeneyim ?? "",
          getDurum(s),
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Santiyeler");
    XLSX.writeFile(wb, "santiyeler.xlsx");
  }

  // Durum: sadece düzenle butonu, dropdown kaldırıldı
  // Geçici kabul tarihi girilince otomatik durum değişir
  // Tasfiye sadece düzenle sayfasından veya tasfiye dialog ile

  async function handleTasfiyeOnayla() {
    if (!tasfiyeDialog) return;
    try {
      await toggleSantiyeDurum(tasfiyeDialog, "tasfiye");
      await updateSantiye(tasfiyeDialog, { tasfiye_tarihi: tasfiyeTarihi });
      setSantiyeler((prev) => prev.map((s) => s.id === tasfiyeDialog ? { ...s, durum: "tasfiye" as const, tasfiye_tarihi: tasfiyeTarihi } : s));
      toast.success("İş tasfiye olarak güncellendi.");
    } catch { toast.error("Hata oluştu."); }
    setTasfiyeDialog(null);
  }

  // Firma listesi (benzersiz)
  const firmaListesi = useMemo(() => {
    const set = new Set<string>();
    for (const s of santiyeler) if (s.firmalar?.firma_adi) set.add(s.firmalar.firma_adi);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [santiyeler]);

  // Filtre + Arama + İş Tanımları
  const filtrelenmis = sortData(santiyeler.filter((s) => {
    // Durum filtresi
    if (filtre === "aktif" && (s.gecici_kabul_tarihi || s.tasfiye_tarihi || s.devir_tarihi)) return false;
    if (filtre === "tamamlandi" && (!s.gecici_kabul_tarihi || s.tasfiye_tarihi || s.devir_tarihi)) return false;
    if (filtre === "tasfiye" && !s.tasfiye_tarihi) return false;
    if (filtre === "devir" && !s.devir_tarihi) return false;
    // İş grubu filtresi
    if (isGrupFiltre !== "tumu" && s.is_grubu !== isGrupFiltre) return false;
    // Firma filtresi
    if (firmaFiltre !== "tumu" && (s.firmalar?.firma_adi ?? "") !== firmaFiltre) return false;
    // Arama
    if (arama.trim()) {
      const q = arama.toLowerCase();
      const text = [
        s.is_adi, s.is_grubu, s.ihale_kayit_no, s.ekap_belge_no,
        s.firmalar?.firma_adi,
        formatTarih(s.sozlesme_tarihi),
        formatTarih(s.gecici_kabul_tarihi),
        formatTarih(s.kesin_kabul_tarihi),
        s.sozlesme_bedeli != null ? s.sozlesme_bedeli.toLocaleString("tr-TR") : null,
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(q);
    }
    return true;
  }));

  // Ortaklar map: santiye_id → ortaklar listesi
  const ortaklarMap = useMemo(() => {
    const m = new Map<string, (SantiyeOrtagi & { firmalar?: { firma_adi: string } })[]>();
    for (const o of ortaklarData) {
      if (!m.has(o.santiye_id)) m.set(o.santiye_id, []);
      m.get(o.santiye_id)!.push(o);
    }
    return m;
  }, [ortaklarData]);

  // İş grubu dağılım map: santiye_id → SantiyeIsGrubu[]
  const isGrupDagilimMap = useMemo(() => {
    const m = new Map<string, SantiyeIsGrubu[]>();
    for (const ig of isGrupDagilimData) {
      if (!m.has(ig.santiye_id)) m.set(ig.santiye_id, []);
      m.get(ig.santiye_id)!.push(ig);
    }
    return m;
  }, [isGrupDagilimData]);

  // Firmaya göre grupla — ortak girişim olan işler her ortak firma için ayrı satır
  type TabloSatir = { santiye: SantiyeWithRelations; ortakOrani: number | null; ortakFirmaAdi: string | null };
  const firmaGruplari: { firmaAdi: string; satirlar: TabloSatir[] }[] = [];
  const firmaGrupMap = new Map<string, TabloSatir[]>();

  for (const s of filtrelenmis) {
    const anaFirma = s.firmalar?.firma_adi ?? "Firma Belirtilmemiş";
    const ortaklar = ortaklarMap.get(s.id) ?? [];

    // Ana firma satırı (kendi ortaklık oranı ile)
    const anaKey = anaFirma;
    if (!firmaGrupMap.has(anaKey)) firmaGrupMap.set(anaKey, []);
    firmaGrupMap.get(anaKey)!.push({ santiye: s, ortakOrani: s.ortaklik_orani, ortakFirmaAdi: null });

    // Ortak girişim varsa: her ortak firma için de ayrı satır
    if (s.is_ortak_girisim && ortaklar.length > 0) {
      for (const o of ortaklar) {
        const ortakFirma = o.firmalar?.firma_adi ?? "Ortak Firma";
        if (!firmaGrupMap.has(ortakFirma)) firmaGrupMap.set(ortakFirma, []);
        firmaGrupMap.get(ortakFirma)!.push({ santiye: s, ortakOrani: o.oran, ortakFirmaAdi: ortakFirma });
      }
    }
  }
  // Firma sıralaması: firmalar tablosundaki sira_no'ya göre
  for (const [firmaAdi, satirlar] of Array.from(firmaGrupMap.entries()).sort(([, a], [, b]) => {
    const siraA = a[0]?.santiye?.firmalar?.sira_no ?? 999;
    const siraB = b[0]?.santiye?.firmalar?.sira_no ?? 999;
    if (siraA !== siraB) return siraA - siraB;
    return a[0]?.santiye?.firmalar?.firma_adi?.localeCompare(b[0]?.santiye?.firmalar?.firma_adi ?? "", "tr") ?? 0;
  })) {
    satirlar.sort((a, b) => {
      const sa = isGrupSiralama.get(a.santiye.is_grubu ?? "") ?? 999;
      const sb = isGrupSiralama.get(b.santiye.is_grubu ?? "") ?? 999;
      return sa - sb;
    });
    firmaGruplari.push({ firmaAdi, satirlar });
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Şantiyeler</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* İhale İlan Daveti Tarihi — ay seçilir, bir önceki ayın Yi-ÜFE'si kullanılır */}
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
            <div className="text-[10px] text-gray-500 leading-tight">
              <div className="font-semibold text-[#1E3A5F]">İhale İlan Daveti Tarihi</div>
            </div>
            <select
              value={seciliAyKey}
              onChange={(e) => setKatsayiSeciliAy(e.target.value)}
              className="h-8 rounded border border-input bg-white px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
            >
              {yiUfeAySecenekleri.map((v) => {
                const ayAdi = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"][v.ay - 1];
                return (
                  <option key={`${v.yil}-${v.ay}`} value={`${v.yil}-${v.ay}`}>
                    {ayAdi} {v.yil}
                  </option>
                );
              })}
            </select>
            <div className="text-right">
              <div className="text-sm font-bold text-[#1E3A5F]">
                {guncelYiUfe !== null ? guncelYiUfe.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : "—"}
              </div>
              <div className="text-[9px] text-gray-400">
                {oncekiAyVeri ? `${["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"][oncekiAy - 1]} ${oncekiYil}` : "—"} Yi-ÜFE
              </div>
            </div>
            {katsayiSeciliAy && katsayiSeciliAy !== varsayilanAyKey && (
              <button
                type="button"
                onClick={() => setKatsayiSeciliAy("")}
                className="text-[10px] text-red-500 hover:text-red-700 font-semibold"
                title="En son aya dön"
              >
                Sıfırla
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={santiyeExportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={14} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={santiyeExportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={14} className="mr-1" /> Excel
          </Button>
          <Link href="/dashboard/yonetim/santiyeler/yeni">
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white">
              <Plus size={16} className="mr-1" /> Yeni İş Ekle
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          { key: "tumu", label: "Tümü" }, { key: "aktif", label: "Aktif" },
          { key: "tamamlandi", label: "Tamamlandı" }, { key: "tasfiye", label: "Tasfiye" }, { key: "devir", label: "Devir" },
        ] as { key: Filtre; label: string }[]).map((f) => (
          <Button key={f.key} variant={filtre === f.key ? "default" : "outline"} size="sm"
            onClick={() => setFiltre(f.key)} className={filtre === f.key ? "bg-[#64748B]" : ""}>
            {f.label}
          </Button>
        ))}
        {sorts.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSorts([])} className="text-red-500 text-xs">Sıralamayı Temizle</Button>
        )}
      </div>

      {/* Arama + İş Tanımları Filtresi */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="İş adı, ihale kayıt no, firma ile ara..." value={arama} onChange={(e) => setArama(e.target.value)} className="pl-9" />
        </div>
        <select value={isGrupFiltre} onChange={(e) => setIsGrupFiltre(e.target.value)}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 min-w-[160px]">
          <option value="tumu">Tüm İş Grupları</option>
          {isGruplari.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={firmaFiltre} onChange={(e) => setFirmaFiltre(e.target.value)}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 min-w-[160px]">
          <option value="tumu">Tüm Firmalar</option>
          {firmaListesi.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : santiyeler.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <HardHat size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">Henüz iş eklenmemiş.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {firmaGruplari.map((grup) => (
            <div key={grup.firmaAdi} className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              {/* Firma başlığı */}
              <div className="bg-[#152d4a] px-4 py-2">
                <h2 className="text-sm font-bold text-white text-center">{grup.firmaAdi}</h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#64748B]">
                    {HEADER_LABELS.map((h) => {
                      const si = sorts.findIndex((s) => s.key === h.key);
                      const sc = si >= 0 ? sorts[si] : null;
                      return (
                        <TableHead key={h.key} onClick={() => handleSort(h.key)}
                          className={`text-white font-semibold text-center text-[10px] px-2 cursor-pointer hover:bg-[#2a4f7a] select-none ${h.key === "sira_no" ? "min-w-[40px]" : h.key === "is_adi" ? "min-w-[140px] max-w-[180px]" : h.twoLine ? "min-w-[80px]" : "min-w-[75px]"} ${h.twoLine ? "whitespace-pre-line leading-tight" : "whitespace-nowrap"}`}>
                          <div className="flex items-center justify-center gap-0.5">
                            <span>{h.label}</span>
                            {sc && <span className="flex items-center">
                              {sorts.length > 1 && <span className="text-[8px] text-orange-300">{si + 1}</span>}
                              {sc.dir === "asc" ? <ArrowUp size={10} className="text-orange-300" /> : <ArrowDown size={10} className="text-orange-300" />}
                            </span>}
                          </div>
                        </TableHead>
                      );
                    })}
                    <TableHead className="text-white font-semibold text-center text-[10px] px-2 min-w-[50px]">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grup.satirlar.map((satir, siraIdx) => {
                const s = satir.santiye;
                const c = calc(s, satir.ortakOrani);
                const dim = isDimmed(s);
                const editKey = `${s.id}-${satir.ortakOrani ?? "ana"}`;
                const isEditingThis = editing?.id === editKey;
                const durumText = getDurum(s);
                const durumColor = s.devir_tarihi ? "bg-purple-500" : s.tasfiye_tarihi ? "bg-red-500" : s.kesin_kabul_tarihi ? "bg-gray-500" : s.gecici_kabul_tarihi ? "bg-yellow-600" : "bg-green-600";

                return (
                  <TableRow key={`${s.id}-${satir.ortakOrani ?? "ana"}`} className={`text-xs ${dim ? "bg-gray-100 opacity-50" : "hover:bg-gray-50"}`}>
                    {/* Sıra No - firma içinde 1'den başlar */}
                    <TableCell className="text-center px-2">{siraIdx + 1}</TableCell>
                    {/* İş Tanımları */}
                    <TableCell className="text-center px-2 whitespace-nowrap">{s.is_grubu ?? "—"}</TableCell>
                    {/* Ekap Belge No */}
                    <TableCell className="text-center px-2 whitespace-nowrap">{s.ekap_belge_no ?? "—"}</TableCell>
                    {/* İşin Adı - daraltılmış, hover'da tam gösterim */}
                    <TableCell className="px-2 font-medium max-w-[180px] truncate" title={s.is_adi}>{s.is_adi}</TableCell>
                    {/* İhale Kayıt No */}
                    <TableCell className="text-center px-2 whitespace-nowrap">{s.ihale_kayit_no ?? "—"}</TableCell>
                    {/* Sözleşme Tarihi */}
                    <TableCell className="text-center px-2 whitespace-nowrap">{formatTarih(s.sozlesme_tarihi)}</TableCell>
                    {/* FF Dahil Kalan - otomatik */}
                    <TableCell className="text-right px-2 tabular-nums whitespace-nowrap">{c.ffDahilKalan != null ? formatPara(c.ffDahilKalan) : "—"}</TableCell>
                    {/* Sözl. Fiy. Gerçekleşen - tıklanabilir */}
                    <TableCell className="text-right px-2 tabular-nums whitespace-nowrap cursor-pointer hover:bg-blue-50"
                      onClick={() => !isEditingThis && handleGerceklesenClick(editKey, s.sozlesme_fiyatlariyla_gerceklesen)}>
                      {isEditingThis ? (
                        <Input ref={inputRef} value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }}
                          className="h-6 text-xs px-1 min-w-[100px] text-right" />
                      ) : formatPara(s.sozlesme_fiyatlariyla_gerceklesen)}
                    </TableCell>
                    {/* Geçici Kabul */}
                    <TableCell className="text-center px-2 whitespace-nowrap">
                      {s.gecici_kabul_tarihi ? (
                        <div className="flex items-center gap-1 justify-center">
                          <span>{formatTarih(s.gecici_kabul_tarihi)}</span>
                          {s.gecici_kabul_url && <a href={s.gecici_kabul_url} target="_blank" rel="noopener noreferrer" className="text-[#1E3A5F] hover:text-[#F97316]"><Download size={13} /></a>}
                        </div>
                      ) : "—"}
                    </TableCell>
                    {/* Kesin Kabul */}
                    <TableCell className="text-center px-2 whitespace-nowrap">
                      {s.kesin_kabul_tarihi ? (
                        <div className="flex items-center gap-1 justify-center">
                          <span>{formatTarih(s.kesin_kabul_tarihi)}</span>
                          {s.kesin_kabul_url && <a href={s.kesin_kabul_url} target="_blank" rel="noopener noreferrer" className="text-[#1E3A5F] hover:text-[#F97316]"><Download size={13} /></a>}
                        </div>
                      ) : "—"}
                    </TableCell>
                    {/* İş Deneyim - tasfiye ise gösterme */}
                    <TableCell className="text-center px-2">
                      {s.tasfiye_tarihi ? (
                        <span className="text-gray-400 text-[10px]">—</span>
                      ) : s.is_deneyim_url ? (
                        <div className="flex items-center gap-1 justify-center">
                          <Badge className="bg-green-600">Var</Badge>
                          <a href={s.is_deneyim_url} target="_blank" rel="noopener noreferrer" className="text-[#1E3A5F] hover:text-[#F97316]"><Download size={13} /></a>
                        </div>
                      ) : <Badge variant="secondary">Yok</Badge>}
                    </TableCell>
                    {/* Durum */}
                    <TableCell className="text-center px-2">
                      <Badge className={durumColor}>{durumText}</Badge>
                    </TableCell>
                    {/* Güncel İş Deneyim - tıklayınca iş grubu dağılımı gösterilir */}
                    <TableCell className="text-right px-2 tabular-nums whitespace-nowrap">
                      {(() => {
                        const dagilim = isGrupDagilimMap.get(s.id);
                        const varDagilim = dagilim && dagilim.length > 0 && c.sozYiUfe && guncelYiUfe;
                        if (!varDagilim) return c.guncelDeneyim != null ? formatPara(c.guncelDeneyim) : "—";
                        const oran = satir.ortakOrani ?? s.ortaklik_orani ?? 100;
                        const satirlar = dagilim!.map((d) => ({
                          grup: d.is_grubu,
                          tutar: (guncelYiUfe! / c.sozYiUfe!) * d.tutar * oran / 100,
                        }));
                        const tooltipText = satirlar.map((r) =>
                          `${r.grup}: ${formatPara(r.tutar)}`
                        ).join("\n") + (satirlar.length > 1
                          ? `\n─────────────\nToplam: ${formatPara(satirlar.reduce((a, r) => a + r.tutar, 0))}`
                          : "");
                        return (
                          <span
                            className="cursor-help border-b border-dashed border-[#1E3A5F]"
                            title={tooltipText}
                          >
                            {c.guncelDeneyim != null ? formatPara(c.guncelDeneyim) : "—"}
                          </span>
                        );
                      })()}
                    </TableCell>
                    {/* Fiyat Farkı - sadece devam eden işlerde */}
                    <TableCell className="text-center px-2 tabular-nums">{c.ffYuzde != null ? `%${c.ffYuzde.toFixed(2)}` : "—"}</TableCell>
                    {/* İşlem - sadece düzenle */}
                    <TableCell className="text-center px-2">
                      <Button variant="ghost" size="sm" title="Düzenle"
                        onClick={() => router.push(`/dashboard/yonetim/santiyeler/${s.id}/duzenle`)}>
                        <Pencil size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}

      {/* Tasfiye tarihi dialog */}
      <Dialog open={!!tasfiyeDialog} onOpenChange={() => setTasfiyeDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Tasfiye Tarihi</DialogTitle></DialogHeader>
          <div className="space-y-2 py-4">
            <Label>Tasfiye tarihini girin</Label>
            <Input type="date" value={tasfiyeTarihi} onChange={(e) => setTasfiyeTarihi(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTasfiyeDialog(null)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleTasfiyeOnayla} disabled={!tasfiyeTarihi}>Tasfiye Et</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
