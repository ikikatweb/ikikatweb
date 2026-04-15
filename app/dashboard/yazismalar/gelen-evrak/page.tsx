// Gelen Evrak sayfası - Liste, filtre, yazdır, kopyala, düzenle, sil
"use client";

import { useEffect, useState, useCallback } from "react";
import { getGelenEvraklar, softDeleteGelenEvrak } from "@/lib/supabase/queries/gelen-evrak";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { useAuth } from "@/hooks";
import type { GelenEvrakWithRelations, Firma } from "@/lib/supabase/types";
import GelenEvrakForm from "@/components/shared/gelen-evrak-form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Mail, Printer, Copy, Pencil, Trash2, FileDown, FileSpreadsheet, Download } from "lucide-react";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import GelenEvrakOnIzleme from "@/components/shared/gelen-evrak-onizleme";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

function formatTarih(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}
function formatTarihSaat(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}
function tr(s: string): string {
  return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
    .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
    .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
}

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function GelenEvrakPage() {
  const { kullanici, isYonetici } = useAuth();
  const [evraklar, setEvraklar] = useState<GelenEvrakWithRelations[]>([]);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editEvrak, setEditEvrak] = useState<GelenEvrakWithRelations | undefined>();
  const [silDialog, setSilDialog] = useState<string | null>(null);
  const [silmeNedeni, setSilmeNedeni] = useState("");

  // Yazdırma için seçili evrak
  const [printEvrakRef, setPrintEvrakRef] = useState<GelenEvrakWithRelations | null>(null);

  // Filtreler
  const [fArama, setFArama] = useState("");
  const [fBaslangic, setFBaslangic] = useState("");
  const [fBitis, setFBitis] = useState("");
  const [fFirma, setFFirma] = useState("");
  const [fMuhatap, setFMuhatap] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [eData, fData] = await Promise.all([
        getGelenEvraklar(isYonetici ? undefined : kullanici?.id),
        getFirmalar(),
      ]);
      setEvraklar((eData as GelenEvrakWithRelations[]) ?? []);
      setFirmalar(fData ?? []);
    } catch { toast.error("Veriler yüklenirken hata oluştu."); }
    finally { setLoading(false); }
  }, [isYonetici, kullanici?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filtreleme
  const filtrelenmis = evraklar.filter((e) => {
    if (fBaslangic && e.evrak_tarihi < fBaslangic) return false;
    if (fBitis && e.evrak_tarihi > fBitis) return false;
    if (fFirma && e.firma_id !== fFirma) return false;
    if (fMuhatap && !(e.muhatap?.toLowerCase().includes(fMuhatap.toLowerCase()) ?? false)) return false;
    if (fArama.trim()) {
      const q = fArama.toLowerCase();
      const hit =
        e.evrak_sayi_no?.toLowerCase().includes(q) ||
        e.konu?.toLowerCase().includes(q) ||
        (e.muhatap?.toLowerCase().includes(q) ?? false) ||
        (e.firmalar?.firma_adi?.toLowerCase().includes(q) ?? false) ||
        (e.kullanicilar?.ad_soyad?.toLowerCase().includes(q) ?? false) ||
        (e.icerik?.toLowerCase().includes(q) ?? false) ||
        (e.ilgi?.toLowerCase().includes(q) ?? false) ||
        formatTarih(e.evrak_tarihi).includes(q);
      if (!hit) return false;
    }
    return true;
  });

  function handleAdd() { setEditEvrak(undefined); setFormOpen(true); }
  function handleEdit(e: GelenEvrakWithRelations) { setEditEvrak(e); setFormOpen(true); }

  function handleCopy(e: GelenEvrakWithRelations) {
    setEditEvrak({ ...e, id: "", evrak_sayi_no: "" } as GelenEvrakWithRelations);
    setFormOpen(true);
  }

  async function handleSil() {
    if (!silDialog || !silmeNedeni.trim()) { toast.error("Silme nedeni zorunludur."); return; }
    try {
      await softDeleteGelenEvrak(silDialog, silmeNedeni, kullanici?.id ?? null);
      setEvraklar((p) => p.filter((e) => e.id !== silDialog));
      toast.success("Evrak silindi.");
    } catch { toast.error("Silme hatası."); }
    finally { setSilDialog(null); setSilmeNedeni(""); }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Gelen Evrak Listesi", 14, 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length}`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Tarih", "Sayi No", "Firma", "Konu", "Muhatap", "Olusturan"]],
      body: filtrelenmis.map((e) => [
        tr(formatTarih(e.evrak_tarihi)), tr(e.evrak_sayi_no),
        tr(e.firmalar?.firma_adi ?? ""), tr(e.konu), tr(e.muhatap ?? ""),
        tr(e.kullanicilar?.ad_soyad ?? ""),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("gelen-evrak-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Tarih", "Sayı No", "Firma", "Konu", "Muhatap", "Oluşturan", "Oluşturma Tarihi"];
    const data = filtrelenmis.map((e) => [
      formatTarih(e.evrak_tarihi), e.evrak_sayi_no,
      e.firmalar?.firma_adi ?? "", e.konu, e.muhatap ?? "",
      e.kullanicilar?.ad_soyad ?? "", formatTarihSaat(e.olusturma_tarihi),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gelen Evrak");
    XLSX.writeFile(wb, "gelen-evrak-listesi.xlsx");
  }

  function printEvrak(e: GelenEvrakWithRelations) {
    setPrintEvrakRef(e);
    // Render olduktan sonra print başlat
    setTimeout(() => {
      window.print();
      // Print sonrası temizle
      setTimeout(() => setPrintEvrakRef(null), 500);
    }, 200);
  }

  return (
    <div>
      {/* Başlık */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Gelen Evrak</h1>
        <div className="flex items-center gap-2">
          <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleAdd}>
            <Plus size={16} className="mr-1" /> Yeni Gelen Evrak
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={16} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={16} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Genel Arama */}
      <div className="mb-3">
        <Input
          value={fArama}
          onChange={(e) => setFArama(e.target.value)}
          placeholder="Genel arama: sayı no, konu, muhatap, firma, oluşturan, ilgi, içerik..."
          className="h-9"
        />
      </div>

      {/* Filtreler */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Başlangıç</Label>
          <Input type="date" value={fBaslangic} onChange={(e) => setFBaslangic(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Bitiş</Label>
          <Input type="date" value={fBitis} onChange={(e) => setFBitis(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Firma</Label>
          <select value={fFirma} onChange={(e) => setFFirma(e.target.value)} className={selectClass + " h-8 text-xs w-full"}>
            <option value="">Tümü</option>
            {firmalar.filter((f) => (f.durum ?? "aktif") === "aktif").map((f) => (
              <option key={f.id} value={f.id}>{f.firma_adi}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Muhatap</Label>
          <Input value={fMuhatap} onChange={(e) => setFMuhatap(e.target.value)} placeholder="Ara..." className="h-8 text-xs" />
        </div>
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Mail size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Henüz gelen evrak eklenmemiş.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-[#1E3A5F]">
                <TableHead className="text-white text-xs px-2">Tarih</TableHead>
                <TableHead className="text-white text-xs px-2">Sayı No</TableHead>
                <TableHead className="text-white text-xs px-2">Firma</TableHead>
                <TableHead className="text-white text-xs px-2">Konu</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">Muhatap</TableHead>
                <TableHead className="text-white text-xs px-2">Oluşturan</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((e) => (
                <TableRow key={e.id} className="text-xs hover:bg-gray-50">
                  <TableCell className="px-2 whitespace-nowrap">{formatTarih(e.evrak_tarihi)}</TableCell>
                  <TableCell className="px-2 whitespace-nowrap font-medium">{e.evrak_sayi_no}</TableCell>
                  <TableCell className="px-2 max-w-[120px] truncate" title={e.firmalar?.firma_adi ?? ""}>{e.firmalar?.firma_adi ?? "—"}</TableCell>
                  <TableCell className="px-2 max-w-[200px] truncate" title={e.konu}>{e.konu}</TableCell>
                  <TableCell className="px-2 leading-snug">
                    {e.muhatap ? tekSatirMuhatap(e.muhatap) : "—"}
                  </TableCell>
                  <TableCell className="px-2">
                    <div>
                      <div className="font-medium">{e.kullanicilar?.ad_soyad ?? "—"}</div>
                      <div className="text-[10px] text-gray-400">{formatTarihSaat(e.olusturma_tarihi)}</div>
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => printEvrak(e)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Yazdır"><Printer size={14} /></button>
                      <button onClick={() => handleCopy(e)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Kopyala"><Copy size={14} /></button>
                      {e.pdf_url && (
                        <a href={e.pdf_url} target="_blank" rel="noopener noreferrer" className="p-1 text-gray-400 hover:text-green-600" title="PDF İndir"><Download size={14} /></a>
                      )}
                      <button onClick={() => handleEdit(e)} className="p-1 text-gray-400 hover:text-[#F97316]" title="Düzenle"><Pencil size={14} /></button>
                      <button onClick={() => { setSilDialog(e.id); setSilmeNedeni(""); }} className="p-1 text-gray-400 hover:text-red-500" title="Sil"><Trash2 size={14} /></button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Evrak Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="!w-[95vw] md:!w-[50vw] !max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEvrak?.id ? "Evrak Düzenle" : "Yeni Gelen Evrak"}</DialogTitle>
          </DialogHeader>
          <GelenEvrakForm
            key={editEvrak?.id || String(Date.now())}
            evrak={editEvrak?.id ? editEvrak : undefined}
            onSuccess={() => { setFormOpen(false); loadData(); }}
            onCancel={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Silme Nedeni Dialog */}
      <Dialog open={!!silDialog} onOpenChange={() => setSilDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Evrak Silme</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Silme Nedeni <span className="text-red-500">*</span></Label>
            <Textarea value={silmeNedeni} onChange={(e) => setSilmeNedeni(e.target.value)}
              placeholder="Silme nedenini yazınız..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSilDialog(null)}>İptal</Button>
            <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={handleSil} disabled={!silmeNedeni.trim()}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Yazdırma için görünmez render alanı - print modunda görünür */}
      {printEvrakRef && (
        <div className="evrak-print-area" style={{ position: "fixed", left: "-10000px", top: 0 }}>
          <GelenEvrakOnIzleme
            firma={printEvrakRef.firmalar ?? null}
            evrakTarihi={printEvrakRef.evrak_tarihi}
            evrakSayiNo={printEvrakRef.evrak_sayi_no}
            konu={printEvrakRef.konu}
            muhatap={printEvrakRef.muhatap}
            ilgi={printEvrakRef.ilgi}
            icerik={printEvrakRef.icerik}
            ekler={printEvrakRef.ekler}
          />
        </div>
      )}
    </div>
  );
}
