// Acente Takip — tüm poliçelerin tarih sıralı listesi
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getAraclar, getTumPoliceler, deleteAracPolice, updateAracPolice, uploadPolice } from "@/lib/supabase/queries/araclar";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { useAuth } from "@/hooks";
import type { AracWithRelations, AracPolice } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Headphones, Search, ExternalLink, Trash2, Pencil, FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function formatTarih(tarih: string | null): string {
  if (!tarih) return "—";
  const d = new Date(tarih + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function tr(s: string): string {
  return s.replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ı/g,"i").replace(/İ/g,"I").replace(/ö/g,"o").replace(/Ö/g,"O").replace(/ü/g,"u").replace(/Ü/g,"U");
}

function formatPara(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
}

export default function AcenteTakipPage() {
  const { isYonetici, hasPermission } = useAuth();
  const yDuzenle = hasPermission("araclar-acente-takip", "duzenle");
  const ySil = hasPermission("araclar-acente-takip", "sil");
  const [loading, setLoading] = useState(true);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [policeler, setPoliceler] = useState<AracPolice[]>([]);
  const [arama, setArama] = useState("");
  const [tipFiltre, setTipFiltre] = useState<"" | "kasko" | "trafik">("");
  const [fBaslangic, setFBaslangic] = useState("");
  const [fBitis, setFBitis] = useState("");
  const [silOnay, setSilOnay] = useState<string | null>(null);
  const [sigortaFirmalari, setSigortaFirmalari] = useState<string[]>([]);
  const [acenteler, setAcenteler] = useState<string[]>([]);

  // Düzenleme dialog
  const [editPolice, setEditPolice] = useState<AracPolice | null>(null);
  const [eTip, setETip] = useState<"kasko" | "trafik">("trafik");
  const [eTutar, setETutar] = useState("");
  const [eFirma, setEFirma] = useState("");
  const [eAcente, setEAcente] = useState("");
  const [eIslemTarih, setEIslemTarih] = useState("");
  const [eBaslangicTarih, setEBaslangicTarih] = useState("");
  const [eBitisTarih, setEBitisTarih] = useState("");
  const [ePoliceNo, setEPoliceNo] = useState("");
  const [eDosya, setEDosya] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aData, pData, sfData, acData] = await Promise.all([
        getAraclar(),
        getTumPoliceler().catch(() => []),
        getDegerler("sigorta_firmasi").catch(() => []),
        getDegerler("sigorta_acente").catch(() => []),
      ]);
      setAraclar((aData as AracWithRelations[]) ?? []);
      setPoliceler(pData as AracPolice[]);
      setSigortaFirmalari(sfData);
      setAcenteler(acData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const aracMap = useMemo(() => {
    const m = new Map<string, AracWithRelations>();
    for (const a of araclar) m.set(a.id, a);
    return m;
  }, [araclar]);

  const filtrelenmis = useMemo(() => {
    const q = arama.trim().toLowerCase();
    return policeler
      .filter((p) => {
        if (tipFiltre && p.police_tipi !== tipFiltre) return false;
        // Filtreleme tarihi: islem_tarihi → yoksa kaydedilme tarihi
        // baslangic_tarihi gelecek tarih olabilir, ona fallback YAPMA
        const tarih = p.islem_tarihi || p.created_at?.slice(0, 10) || "";
        if (fBaslangic && tarih && tarih < fBaslangic) return false;
        if (fBitis && tarih && tarih > fBitis) return false;
        if (q) {
          const arac = aracMap.get(p.arac_id);
          const text = [
            arac?.plaka, arac?.marka, arac?.model,
            arac?.firmalar?.firma_adi,
            p.sigorta_firmasi, p.acente, p.police_no,
            formatTarih(p.islem_tarihi), formatTarih(p.baslangic_tarihi), formatTarih(p.bitis_tarihi),
            p.tutar != null ? p.tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : null,
            p.tutar != null ? String(p.tutar) : null,
          ].filter(Boolean).join(" ").toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.islem_tarihi ?? b.created_at).localeCompare(a.islem_tarihi ?? a.created_at));
  }, [policeler, tipFiltre, arama, aracMap, fBaslangic, fBitis]);

  function duzenleAc(p: AracPolice) {
    setEditPolice(p);
    setETip(p.police_tipi);
    setETutar(p.tutar != null ? String(p.tutar).replace(".", ",") : "");
    setEFirma(p.sigorta_firmasi ?? "");
    setEAcente(p.acente ?? "");
    setEIslemTarih(p.islem_tarihi ?? "");
    setEBaslangicTarih(p.baslangic_tarihi ?? "");
    setEBitisTarih(p.bitis_tarihi ?? "");
    setEPoliceNo(p.police_no ?? "");
    setEDosya(null);
  }

  async function duzenleKaydet() {
    if (!editPolice) return;
    setEditSaving(true);
    try {
      let policeUrl = editPolice.police_url;
      if (eDosya) {
        policeUrl = await uploadPolice(eDosya, editPolice.id);
      }
      await updateAracPolice(editPolice.id, {
        police_tipi: eTip,
        tutar: parseParaInput(eTutar) || null,
        sigorta_firmasi: eFirma || null,
        acente: eAcente || null,
        islem_tarihi: eIslemTarih || null,
        baslangic_tarihi: eBaslangicTarih || null,
        bitis_tarihi: eBitisTarih || null,
        police_no: ePoliceNo || null,
        police_url: policeUrl,
      });
      setEditPolice(null);
      await loadData();
      toast.success("Poliçe güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEditSaving(false);
    }
  }

  async function policeSil() {
    if (!silOnay) return;
    try {
      await deleteAracPolice(silOnay);
      setSilOnay(null);
      await loadData();
      toast.success("Poliçe silindi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function hizliTarih(ay: number) {
    const bitis = new Date();
    const baslangic = new Date();
    baslangic.setMonth(baslangic.getMonth() - ay);
    if (ay <= 1) baslangic.setDate(1);
    setFBaslangic(baslangic.toISOString().slice(0, 10));
    setFBitis(bitis.toISOString().slice(0, 10));
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Acente Takip - Police Listesi", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length} police`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Islem Tarihi", "Plaka", "Firma", "Tip", "Sigorta Firmasi", "Acente", "Tutar", "Baslangic", "Bitis", "Police No"]],
      body: filtrelenmis.map((p) => {
        const arac = aracMap.get(p.arac_id);
        return [
          tr(formatTarih(p.islem_tarihi)), arac?.plaka ?? "", tr(arac?.firmalar?.firma_adi ?? ""),
          p.police_tipi === "kasko" ? "Kasko" : "Trafik",
          tr(p.sigorta_firmasi ?? ""), tr(p.acente ?? ""),
          p.tutar != null ? p.tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "",
          tr(formatTarih(p.baslangic_tarihi)), tr(formatTarih(p.bitis_tarihi)),
          p.police_no ?? "",
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("acente-takip.pdf");
  }

  function exportExcel() {
    const headers = ["İşlem Tarihi", "Plaka", "Firma", "Poliçe Tipi", "Sigorta Firması", "Acente", "Tutar", "Başlangıç", "Bitiş", "Poliçe No"];
    const data = filtrelenmis.map((p) => {
      const arac = aracMap.get(p.arac_id);
      return [
        formatTarih(p.islem_tarihi), arac?.plaka ?? "", arac?.firmalar?.firma_adi ?? "",
        p.police_tipi === "kasko" ? "Kasko" : "Trafik",
        p.sigorta_firmasi ?? "", p.acente ?? "",
        p.tutar ?? "", formatTarih(p.baslangic_tarihi), formatTarih(p.bitis_tarihi),
        p.police_no ?? "",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Acente Takip");
    XLSX.writeFile(wb, "acente-takip.xlsx");
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Headphones size={24} /> Acente Takip
        </h1>
        <div className="text-xs text-gray-400">{filtrelenmis.length} poliçe</div>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Arama</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Plaka, firma, acente..." className="pl-8 h-9 w-56" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Poliçe Tipi</Label>
          <select value={tipFiltre} onChange={(e) => setTipFiltre(e.target.value as typeof tipFiltre)} className={selectClass}>
            <option value="">Tümü</option>
            <option value="trafik">Trafik Sigortası</option>
            <option value="kasko">Kasko</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Başlangıç</Label>
          <input type="date" value={fBaslangic} onChange={(e) => setFBaslangic(e.target.value)} className={selectClass} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Bitiş</Label>
          <input type="date" value={fBitis} onChange={(e) => setFBitis(e.target.value)} className={selectClass} />
        </div>
        <div className="flex gap-1 items-end">
          {[{ l: "Bu Ay", a: 1 }, { l: "3 Ay", a: 3 }, { l: "6 Ay", a: 6 }, { l: "1 Yıl", a: 12 }].map((b) => (
            <button key={b.l} type="button" onClick={() => hizliTarih(b.a)}
              className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
              {b.l}
            </button>
          ))}
        </div>
        <div className="flex gap-1 items-end ml-auto">
          <Button variant="outline" size="sm" onClick={exportPDF} className="h-9 gap-1 text-xs">
            <FileDown size={14} /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs">
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Headphones size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Poliçe bulunamadı.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">İşlem Tarihi</TableHead>
                <TableHead
                  style={{ position: "sticky", left: 0, zIndex: 11, backgroundColor: "#64748B" }}
                  className="text-white text-[11px] px-2 shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                >Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Ruhsat Sahibi / Firma</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Poliçe Tipi</TableHead>
                <TableHead className="text-white text-[11px] px-2">Sigorta Firması</TableHead>
                <TableHead className="text-white text-[11px] px-2">Mevcut Acente</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Tutar</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Başlangıç</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Bitiş</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Poliçe No</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">PDF</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center w-[50px]">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((p) => {
                const arac = aracMap.get(p.arac_id);
                return (
                  <TableRow key={p.id} className="hover:bg-gray-50">
                    <TableCell className="px-2 whitespace-nowrap">{formatTarih(p.islem_tarihi)}</TableCell>
                    <TableCell
                      style={{ position: "sticky", left: 0, zIndex: 5, backgroundColor: "white" }}
                      className="px-2 font-bold text-[#1E3A5F] whitespace-nowrap shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                    >{arac?.plaka ?? "—"}</TableCell>
                    <TableCell className="px-2 truncate max-w-[150px]" title={arac?.firmalar?.firma_adi ?? ""}>
                      {arac?.firmalar?.firma_adi ?? "—"}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      <Badge className={p.police_tipi === "kasko" ? "bg-blue-600" : "bg-emerald-600"}>
                        {p.police_tipi === "kasko" ? "Kasko" : "Trafik"}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-2">{p.sigorta_firmasi ?? "—"}</TableCell>
                    <TableCell className="px-2">{p.acente ?? "—"}</TableCell>
                    <TableCell className="px-2 text-right whitespace-nowrap">{formatPara(p.tutar)}</TableCell>
                    <TableCell className="px-2 text-center whitespace-nowrap">{formatTarih(p.baslangic_tarihi)}</TableCell>
                    <TableCell className="px-2 text-center whitespace-nowrap">{formatTarih(p.bitis_tarihi)}</TableCell>
                    <TableCell className="px-2 text-center font-mono text-[10px]">{p.police_no ?? "—"}</TableCell>
                    <TableCell className="px-2 text-center">
                      {p.police_url ? (
                        <a href={p.police_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
                          <ExternalLink size={14} />
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {yDuzenle && (
                          <button type="button" onClick={() => duzenleAc(p)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                        )}
                        {ySil && (
                          <button type="button" onClick={() => setSilOnay(p.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Silme Onayı */}
      <Dialog open={!!silOnay} onOpenChange={(o) => !o && setSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Poliçeyi Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu poliçeyi silmek istediğinize emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setSilOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={policeSil}>Sil</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Düzenleme Dialog */}
      <Dialog open={!!editPolice} onOpenChange={(o) => !o && setEditPolice(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Poliçe Düzenle</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Tipi</Label>
              <select value={eTip} onChange={(e) => setETip(e.target.value as "kasko" | "trafik")} className={selectClass + " w-full"}>
                <option value="trafik">Trafik Sigortası</option>
                <option value="kasko">Kasko</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tutar (TL)</Label>
              <input type="text" inputMode="decimal" value={eTutar} onChange={(e) => setETutar(formatParaInput(e.target.value))}
                placeholder="0,00" className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sigorta Firması</Label>
              <select value={eFirma} onChange={(e) => setEFirma(e.target.value)} className={selectClass + " w-full"}>
                <option value="">Seçiniz</option>
                {sigortaFirmalari.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Acente</Label>
              <select value={eAcente} onChange={(e) => setEAcente(e.target.value)} className={selectClass + " w-full"}>
                <option value="">Seçiniz</option>
                {acenteler.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">İşlem Tarihi</Label>
              <input type="date" value={eIslemTarih} onChange={(e) => setEIslemTarih(e.target.value)} className={selectClass + " w-full"} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Başlangıç Tarihi</Label>
                <input type="date" value={eBaslangicTarih} onChange={(e) => setEBaslangicTarih(e.target.value)} className={selectClass + " w-full"} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bitiş Tarihi</Label>
                <input type="date" value={eBitisTarih} onChange={(e) => setEBitisTarih(e.target.value)} className={selectClass + " w-full"} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Numarası</Label>
              <input type="text" value={ePoliceNo} onChange={(e) => setEPoliceNo(e.target.value)} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe PDF (yeni dosya yükle)</Label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setEDosya(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[#64748B] file:text-white" />
              {editPolice?.police_url && !eDosya && (
                <a href={editPolice.police_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">Mevcut dosyayı görüntüle</a>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditPolice(null)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={duzenleKaydet} disabled={editSaving}>
                {editSaving ? "Kaydediliyor..." : "Güncelle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
