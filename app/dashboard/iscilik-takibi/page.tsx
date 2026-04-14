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
} from "@/lib/supabase/queries/iscilik-takibi";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import type { IscilikTakibiWithSantiye, Tanimlama } from "@/lib/supabase/types";
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
  { key: "sicil_no", label: "Sicil No", editable: true, type: "text",
    getValue: (r) => r.sicil_no ?? "—", getRaw: (r) => r.sicil_no },
  { key: "is_adi", label: "İşin Adı", fromSantiye: true,
    getValue: (r) => r.santiyeler?.is_adi ?? "—", getRaw: () => null },
  { key: "sozlesme_bedeli", label: "Sözleşme Bedeli", fromSantiye: true,
    getValue: (r) => formatPara(r.santiyeler?.sozlesme_bedeli ?? null), getRaw: () => null },
  { key: "kesif_artisi", label: "Keşif Artışı", editable: true, type: "para",
    getValue: (r) => formatPara(r.kesif_artisi), getRaw: (r) => r.kesif_artisi },
  { key: "fiyat_farki", label: "Fiyat Farkı", editable: true, type: "para",
    getValue: (r) => formatPara(r.fiyat_farki), getRaw: (r) => r.fiyat_farki },
  { key: "yatmasi_gereken_prim", label: "Yatması Gereken Prim", computed: true,
    getValue: (r) => {
      const bedel = r.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = r.kesif_artisi ?? 0;
      const ff = r.fiyat_farki ?? 0;
      const oran = r.iscilik_orani ?? 0;
      const toplam = (bedel + kesif + ff) * oran / 100;
      return toplam > 0 ? formatPara(toplam) : "—";
    }, getRaw: () => null },
  { key: "yatan_prim", label: "Yatan Prim", computed: true,
    getValue: (r) => formatPara(r.yatan_prim), getRaw: () => null },
  { key: "kalan_prim", label: "Kalan Prim", computed: true,
    getValue: (r) => {
      const bedel = r.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = r.kesif_artisi ?? 0;
      const ff = r.fiyat_farki ?? 0;
      const oran = r.iscilik_orani ?? 0;
      const yatacak = (bedel + kesif + ff) * oran / 100;
      if (yatacak === 0) return "—";
      return formatPara(yatacak - (r.yatan_prim ?? 0));
    }, getRaw: () => null },
  { key: "yatan_prim_yuzde", label: "Yatan Prim %", computed: true,
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
          d.setDate(d.getDate() + toplam);
          return formatTarih(d.toISOString().split("T")[0]);
        }
      }
      return formatTarih(r.santiyeler?.is_bitim_tarihi ?? null);
    }, getRaw: () => null },
  { key: "taseron_veri_isleme_tarihi", label: "Taşeron Veri\nİşleme", computed: true,
    getValue: (r) => r.taseron_veri_isleme_tarihi ? formatTarih(r.taseron_veri_isleme_tarihi) : "—", getRaw: () => null },
  { key: "son_veri_girisi_tarihi", label: "Son Veri\nGirişi", computed: true,
    getValue: (r) => r.son_veri_girisi_tarihi ? formatTarih(r.son_veri_girisi_tarihi) : "—", getRaw: () => null },
  { key: "toplam_son_veri_tutari", label: "Toplam Son\nVeri Tutarı", computed: true,
    getValue: (r) => formatPara(r.toplam_son_veri_tutari), getRaw: () => null },
];

export default function IscilikTakibiPage() {
  const [rows, setRows] = useState<IscilikTakibiWithSantiye[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const [arama, setArama] = useState("");
  const [isGrupSiralama, setIsGrupSiralama] = useState<Map<string, number>>(new Map());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sekme, setSekme] = useState<"aktif" | "cop">("aktif");
  const [silinenler, setSilinenler] = useState<IscilikTakibiWithSantiye[]>([]);
  const [permanentDeleteId, setPermanentDeleteId] = useState<string | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      await ensureAktifSantiyeler();
      const [data, tData] = await Promise.all([
        getIscilikTakibi(),
        getTanimlamalar("is_grubu"),
      ]);
      // İş grubu sıralama map'i
      const sMap = new Map<string, number>();
      ((tData as Tanimlama[]) ?? []).forEach((t, i) => sMap.set(t.deger, i));
      setIsGrupSiralama(sMap);

      // İş grubu sırasına göre sırala, aynı gruptakiler oluşturulma sırasına göre
      const sorted = ((data as IscilikTakibiWithSantiye[]) ?? []).sort((a, b) => {
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
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  function handleCellClick(row: IscilikTakibiWithSantiye, col: ColDef) {
    if (!col.editable) return;
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
      setSilinenler((data as IscilikTakibiWithSantiye[]) ?? []);
    } catch { /* sessiz */ }
  }

  // Arama filtresi
  const filtrelenmis = rows.filter((r) => {
    if (!arama.trim()) return true;
    const q = arama.toLowerCase();
    const text = [
      r.santiyeler?.is_adi, r.sicil_no,
      r.baslangic_tarihi ? new Date(r.baslangic_tarihi).toLocaleDateString("tr-TR") : null,
      r.santiyeler?.ihale_kayit_no,
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
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}`, 14, 21);

    const headers = COLUMNS.map((c) => tr(c.label.replace(/\n/g, " ")));
    const body = filtrelenmis.map((r) => COLUMNS.map((c) => tr(c.getValue(r))));

    autoTable(doc, {
      startY: 25,
      head: [["No", ...headers]],
      body: body.map((row, i) => [String(i + 1), ...row]),
      styles: { fontSize: 5, cellPadding: 1 },
      headStyles: { fillColor: [30, 58, 95], fontSize: 5 },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("iscilik-takibi.pdf");
  }

  function exportExcel() {
    const headers = ["No", ...COLUMNS.map((c) => c.label.replace(/\n/g, " "))];
    const data = filtrelenmis.map((r, i) => [i + 1, ...COLUMNS.map((c) => c.getValue(r))]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
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
          onClick={() => setSekme("aktif")} className={sekme === "aktif" ? "bg-[#1E3A5F]" : ""}>
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
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#1E3A5F]">
                <TableHead className="text-white font-semibold text-center text-[10px] px-2 min-w-[40px]">No</TableHead>
                {COLUMNS.map((col) => {
                  const hasTwoLines = col.label.includes("\n");
                  return (
                    <TableHead key={col.key}
                      className={`text-white font-semibold text-center text-[10px] px-1 ${hasTwoLines ? "whitespace-pre-line leading-tight" : "whitespace-nowrap"} ${col.key === "is_adi" ? "min-w-[120px]" : "min-w-[60px]"}`}>
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
                const isPasif = !!gk && gk !== "0001-01-01" && new Date(gk).getFullYear() > 2000;
                return (
                <TableRow key={row.id} className={`text-xs ${isPasif ? "bg-gray-100 opacity-50" : "hover:bg-gray-50"}`}>
                  <TableCell className="text-center px-2 text-gray-500">{idx + 1}</TableCell>
                  {COLUMNS.map((col) => {
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
                      else if (kalan > 0) kalanPrimClass = " font-bold";
                    }

                    // İş bitim tarihi renklendirmesi
                    let bitimTarihiClass = "";
                    if (col.key === "is_bitim_tarihi") {
                      let bitimStr: string | null = null;
                      if (row.baslangic_tarihi && row.sure_text) {
                        const toplam = row.sure_text.split("+").reduce((t: number, s: string) => t + (parseInt(s.trim()) || 0), 0);
                        if (toplam > 0) {
                          const d = new Date(row.baslangic_tarihi);
                          d.setDate(d.getDate() + toplam);
                          bitimStr = d.toISOString().split("T")[0];
                        }
                      } else {
                        bitimStr = row.santiyeler?.is_bitim_tarihi ?? null;
                      }
                      if (bitimStr && new Date(bitimStr) < new Date()) {
                        bitimTarihiClass = " text-red-600 font-bold";
                      }
                    }

                    const cellClass = `px-2 whitespace-nowrap ${col.editable ? "cursor-pointer hover:bg-blue-50" : ""} ${col.type === "para" || col.computed ? "text-right tabular-nums" : col.type === "date" ? "text-center" : ""} ${col.key === "is_adi" ? "text-left font-medium max-w-[180px] truncate" : "text-center"}${kalanPrimClass}${bitimTarihiClass}`;

                    if (isEditing) {
                      return (
                        <TableCell key={col.key} className={cellClass}>
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
                        <TableCell key={col.key} className={cellClass + " cursor-pointer text-[#1E3A5F] hover:text-[#F97316] hover:underline"}
                          title={row.santiyeler?.is_adi}
                          onClick={() => router.push(`/dashboard/iscilik-takibi/${row.id}`)}>
                          {col.getValue(row)}
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell key={col.key} className={cellClass}
                        onClick={() => col.editable ? handleCellClick(row, col) : undefined}>
                        {col.getValue(row)}
                      </TableCell>
                    );
                  })}
                  {/* Silme butonu */}
                  <TableCell className="text-center px-1">
                    <button onClick={() => setDeleteId(row.id)} className="text-gray-300 hover:text-red-500 p-0.5" title="Sil">
                      <Trash2 size={13} />
                    </button>
                  </TableCell>
                </TableRow>
                );
              })}
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
