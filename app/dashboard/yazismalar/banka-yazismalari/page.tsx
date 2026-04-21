// Banka Yazışmaları sayfası - Liste, filtre, yazdır, çoğalt, düzenle, sil
"use client";

import { useEffect, useState, useCallback } from "react";
import { getBankaYazismalari, softDeleteBankaYazisma } from "@/lib/supabase/queries/banka-yazismalari";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { useAuth } from "@/hooks";
import type { BankaYazismaWithRelations, Firma } from "@/lib/supabase/types";
import BankaYazismaForm from "@/components/shared/banka-yazisma-form";
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
import { Plus, Landmark, Printer, Copy, Pencil, Trash2, FileDown, FileSpreadsheet, Download, Zap } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import BankaYazismaOnIzleme from "@/components/shared/banka-yazisma-onizleme";
import HizliTalimatDialog from "@/components/shared/hizli-talimat-dialog";
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

export default function BankaYazismalariPage() {
  const { kullanici, isYonetici } = useAuth();
  const [yazismalar, setYazismalar] = useState<BankaYazismaWithRelations[]>([]);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [loading, setLoading] = useState(true);

  // Form dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editYazisma, setEditYazisma] = useState<BankaYazismaWithRelations | undefined>();

  // Hızlı talimat dialog
  const [hizliTalimatOpen, setHizliTalimatOpen] = useState(false);

  // Silme dialog'u
  const [silDialog, setSilDialog] = useState<BankaYazismaWithRelations | null>(null);
  const [silmeNedeni, setSilmeNedeni] = useState("");

  // Yazdırma için seçili yazışma
  const [printRef, setPrintRef] = useState<BankaYazismaWithRelations | null>(null);

  // Filtreler
  const [fArama, setFArama] = useState("");
  const [fBaslangic, setFBaslangic] = useState("");
  const [fBitis, setFBitis] = useState("");
  const [fFirma, setFFirma] = useState("");
  const [fMuhatap, setFMuhatap] = useState("");
  const [fOlusturan, setFOlusturan] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [yData, fData] = await Promise.all([
        getBankaYazismalari(isYonetici ? undefined : kullanici?.id),
        getFirmalar(),
      ]);
      setYazismalar((yData as BankaYazismaWithRelations[]) ?? []);
      setFirmalar(fData ?? []);
    } catch { toast.error("Veriler yüklenirken hata oluştu."); }
    finally { setLoading(false); }
  }, [isYonetici, kullanici?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Oluşturan kullanıcı listesini çıkar
  const olusturanlar = Array.from(
    new Map(yazismalar.filter((y) => y.kullanicilar?.ad_soyad).map((y) => [y.olusturan_id, y.kullanicilar!.ad_soyad])).entries()
  ).map(([id, ad]) => ({ id, ad }));

  const filtrelenmis = yazismalar.filter((y) => {
    if (fBaslangic && y.evrak_tarihi < fBaslangic) return false;
    if (fBitis && y.evrak_tarihi > fBitis) return false;
    if (fFirma && y.firma_id !== fFirma) return false;
    if (fMuhatap && !(y.muhatap?.toLowerCase().includes(fMuhatap.toLowerCase()) ?? false)) return false;
    if (fOlusturan && y.olusturan_id !== fOlusturan) return false;
    if (fArama.trim()) {
      const q = fArama.toLowerCase();
      const hit =
        y.evrak_sayi_no?.toLowerCase().includes(q) ||
        y.konu?.toLowerCase().includes(q) ||
        (y.muhatap?.toLowerCase().includes(q) ?? false) ||
        (y.firmalar?.firma_adi?.toLowerCase().includes(q) ?? false) ||
        (y.kullanicilar?.ad_soyad?.toLowerCase().includes(q) ?? false) ||
        (y.metin?.toLowerCase().includes(q) ?? false) ||
        formatTarih(y.evrak_tarihi).includes(q);
      if (!hit) return false;
    }
    return true;
  });

  function handleAdd() { setEditYazisma(undefined); setFormOpen(true); }
  function handleEdit(y: BankaYazismaWithRelations) { setEditYazisma(y); setFormOpen(true); }

  function handleCogalt(y: BankaYazismaWithRelations) {
    setEditYazisma({ ...y, id: "", evrak_sayi_no: "" } as BankaYazismaWithRelations);
    setFormOpen(true);
  }

  async function handleSil() {
    if (!silDialog || !silmeNedeni.trim()) { toast.error("Silme nedeni zorunludur."); return; }
    try {
      await softDeleteBankaYazisma(silDialog.id, silmeNedeni, kullanici?.id ?? null);
      setYazismalar((p) => p.filter((y) => y.id !== silDialog.id));
      toast.success("Yazışma silindi.");
    } catch { toast.error("Silme hatası."); }
    finally { setSilDialog(null); setSilmeNedeni(""); }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Banka Yazismalari Listesi", 14, 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length}`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Tarih", "Sayi No", "Firma", "Konu", "Muhatap", "Olusturan"]],
      body: filtrelenmis.map((y) => [
        tr(formatTarih(y.evrak_tarihi)), tr(y.evrak_sayi_no),
        tr(y.firmalar?.firma_adi ?? ""), tr(y.konu),
        tr((y.muhatap ?? "").replace(/\n/g, " ")),
        tr(y.kullanicilar?.ad_soyad ?? ""),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("banka-yazismalari-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Tarih", "Sayı No", "Firma", "Konu", "Muhatap", "Oluşturan", "Oluşturma Tarihi"];
    const data = filtrelenmis.map((y) => [
      formatTarih(y.evrak_tarihi), y.evrak_sayi_no,
      y.firmalar?.firma_adi ?? "", y.konu, (y.muhatap ?? "").replace(/\n/g, " "),
      y.kullanicilar?.ad_soyad ?? "", formatTarihSaat(y.olusturma_tarihi),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Banka Yazismalari");
    XLSX.writeFile(wb, "banka-yazismalari-listesi.xlsx");
  }

  function printYazisma(y: BankaYazismaWithRelations) {
    setPrintRef(y);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrintRef(null), 500);
    }, 200);
  }

  return (
    <div>
      {/* Başlık */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Banka Yazışmaları</h1>
        <div className="flex items-center gap-2">
          <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleAdd}>
            <Plus size={16} className="mr-1" /> Yeni Banka Yazışma Ekle
          </Button>
          <Button className="bg-[#64748B] hover:bg-[#2a4f7a] text-white" onClick={() => setHizliTalimatOpen(true)}>
            <Zap size={16} className="mr-1" /> Hızlı Talimat
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={16} className="mr-1" /> Listeyi Yazdır (PDF)
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={16} className="mr-1" /> Excel İndir
          </Button>
        </div>
      </div>

      {/* Genel Arama */}
      <div className="mb-3">
        <Input
          value={fArama}
          onChange={(e) => setFArama(e.target.value)}
          placeholder="Genel arama: sayı no, konu, muhatap, firma, oluşturan, metin..."
          className="h-9"
        />
      </div>

      {/* Filtreler */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
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
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Oluşturan</Label>
          <select value={fOlusturan} onChange={(e) => setFOlusturan(e.target.value)} className={selectClass + " h-8 text-xs w-full"}>
            <option value="">Tümü</option>
            {olusturanlar.map((o) => (
              <option key={o.id} value={o.id}>{o.ad}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Landmark size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{yazismalar.length === 0 ? "Henüz banka yazışması eklenmemiş." : "Filtreye uygun kayıt bulunamadı."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          <Table noWrapper>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-[#64748B]">
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
              {filtrelenmis.map((y) => (
                <TableRow key={y.id} className="text-xs hover:bg-gray-50">
                  <TableCell className="px-2 whitespace-nowrap">{formatTarih(y.evrak_tarihi)}</TableCell>
                  <TableCell className="px-2 whitespace-nowrap font-mono text-[10px]">{y.evrak_sayi_no}</TableCell>
                  <TableCell className="px-2 max-w-[120px] truncate" title={y.firmalar?.firma_adi ?? ""}>{y.firmalar?.firma_adi ?? "—"}</TableCell>
                  <TableCell className="px-2 max-w-[200px] truncate" title={y.konu}>{y.konu}</TableCell>
                  <TableCell className="px-2 leading-snug">
                    {y.muhatap ? tekSatirMuhatap(y.muhatap) : "—"}
                  </TableCell>
                  <TableCell className="px-2">
                    <div>
                      <div className="font-medium">{y.kullanicilar?.ad_soyad ?? "—"}</div>
                      <div className="text-[10px] text-gray-400">{formatTarihSaat(y.olusturma_tarihi)}</div>
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => printYazisma(y)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Yazdır"><Printer size={14} /></button>
                      <button onClick={() => handleCogalt(y)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Çoğalt"><Copy size={14} /></button>
                      {y.pdf_url && (
                        <a href={y.pdf_url} target="_blank" rel="noopener noreferrer" className="p-1 text-gray-400 hover:text-green-600" title="PDF İndir"><Download size={14} /></a>
                      )}
                      <button onClick={() => handleEdit(y)} className="p-1 text-gray-400 hover:text-[#F97316]" title="Düzenle"><Pencil size={14} /></button>
                      <button onClick={() => { setSilDialog(y); setSilmeNedeni(""); }} className="p-1 text-gray-400 hover:text-red-500" title="Sil"><Trash2 size={14} /></button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="!w-[95vw] md:!w-[50vw] !max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editYazisma?.id ? "Banka Yazışma Düzenle" : "Yeni Banka Yazışması"}</DialogTitle>
          </DialogHeader>
          <BankaYazismaForm
            key={editYazisma?.id || String(Date.now())}
            yazisma={editYazisma?.id ? editYazisma : undefined}
            onSuccess={() => { setFormOpen(false); loadData(); }}
            onCancel={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Silme Nedeni Dialog */}
      <Dialog open={!!silDialog} onOpenChange={() => setSilDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yazışma Silme</DialogTitle>
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

      {/* Hızlı Talimat Dialog */}
      <HizliTalimatDialog
        open={hizliTalimatOpen}
        onOpenChange={setHizliTalimatOpen}
        onSuccess={loadData}
      />

      {/* Yazdırma için görünmez render alanı - print modunda görünür */}
      {printRef && (
        <div className="evrak-print-area" style={{ position: "fixed", left: "-10000px", top: 0 }}>
          <BankaYazismaOnIzleme
            firma={printRef.firmalar ?? null}
            evrakTarihi={printRef.evrak_tarihi}
            evrakSayiNo={printRef.evrak_sayi_no}
            konu={printRef.konu}
            muhatap={printRef.muhatap}
            ilgiListesi={printRef.ilgi_listesi ?? []}
            metin={printRef.metin}
            ekler={printRef.ekler ?? []}
            kaseDahil={printRef.kase_dahil ?? false}
          />
        </div>
      )}
    </div>
  );
}
