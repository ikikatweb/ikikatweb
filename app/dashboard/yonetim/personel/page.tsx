// Personel listesi sayfası - Çalışanlar tablosu (isim sıralı)
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getPersoneller, deletePersonel } from "@/lib/supabase/queries/personel";
import type { PersonelWithRelations } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, UserCog, Search, FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}

export default function PersonelPage() {
  const [personeller, setPersoneller] = useState<PersonelWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const router = useRouter();

  async function loadPersoneller() {
    try {
      const data = await getPersoneller();
      setPersoneller((data as PersonelWithRelations[]) ?? []);
    } catch {
      toast.error("Personeller yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPersoneller(); }, []);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deletePersonel(deleteId);
      setPersoneller((prev) => prev.filter((p) => p.id !== deleteId));
      toast.success("Personel silindi.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Personel silinirken hata oluştu.");
    } finally {
      setDeleteId(null);
    }
  }

  const filtrelenmis = personeller.filter((p) => {
    if (!arama.trim()) return true;
    const q = arama.toLowerCase();
    return (
      p.ad_soyad.toLowerCase().includes(q) ||
      p.tc_kimlik_no.includes(q) ||
      (p.meslek?.toLowerCase().includes(q) ?? false) ||
      (p.gorev?.toLowerCase().includes(q) ?? false) ||
      (p.santiyeler?.is_adi?.toLowerCase().includes(q) ?? false) ||
      (p.cep_telefon?.includes(q) ?? false)
    );
  });

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Personel Listesi", 14, 12);
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text(`Toplam: ${filtrelenmis.length} personel`, 14, 17);
    autoTable(doc, {
      startY: 22,
      head: [["Ad Soyad", "TC Kimlik No", "Santiye", "Cep Telefonu", "Meslek", "Gorev", "Maas", "Izin Hakki", "Durum"]],
      body: filtrelenmis.map((p) => [
        tr(p.ad_soyad), p.tc_kimlik_no,
        tr(p.santiyeler?.is_adi ?? "—"),
        p.cep_telefon ?? "—",
        tr(p.meslek ?? "—"), tr(p.gorev ?? "—"),
        p.maas != null ? p.maas.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "—",
        p.izin_hakki != null ? String(p.izin_hakki) : "—",
        p.durum === "pasif" ? "Pasif" : "Aktif",
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 7 },
    });
    doc.save("personel-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Ad Soyad", "TC Kimlik No", "Şantiye", "Cep Telefonu", "Meslek", "Görev", "Maaş", "İzin Hakkı", "Durum"];
    const data = filtrelenmis.map((p) => [
      p.ad_soyad, p.tc_kimlik_no,
      p.santiyeler?.is_adi ?? "",
      p.cep_telefon ?? "",
      p.meslek ?? "", p.gorev ?? "",
      p.maas ?? "", p.izin_hakki ?? "",
      p.durum === "pasif" ? "Pasif" : "Aktif",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Personel");
    XLSX.writeFile(wb, "personel-listesi.xlsx");
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Personel</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={14} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={14} className="mr-1" /> Excel
          </Button>
          <Link href="/dashboard/yonetim/personel/yeni">
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white">
              <Plus size={16} className="mr-1" /> Personel Ekle
            </Button>
          </Link>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input placeholder="Ad, TC, meslek, görev ile ara..." value={arama} onChange={(e) => setArama(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      ) : personeller.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <UserCog size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">Henüz personel eklenmemiş.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          <Table noWrapper>
            <TableHeader className="sticky top-0 z-10 bg-white shadow-sm">
              <TableRow>
                <TableHead>TC Kimlik No</TableHead>
                <TableHead>Ad Soyad</TableHead>
                <TableHead>Şantiye</TableHead>
                <TableHead className="hidden sm:table-cell">Cep Telefonu</TableHead>
                <TableHead className="hidden md:table-cell">Meslek</TableHead>
                <TableHead className="hidden md:table-cell">Görev</TableHead>
                <TableHead className="hidden lg:table-cell">Maaş</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((p) => {
                const pasif = p.durum === "pasif";
                return (
                  <TableRow key={p.id} className={pasif ? "opacity-60 bg-gray-50" : undefined}>
                    <TableCell className="tabular-nums">{p.tc_kimlik_no}</TableCell>
                    <TableCell className="font-medium">
                      <span className={pasif ? "text-gray-500" : undefined}>{p.ad_soyad}</span>
                      {pasif && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded bg-gray-200 text-gray-600 align-middle">
                          PASİF{p.pasif_tarihi ? ` · ${new Date(p.pasif_tarihi).toLocaleDateString("tr-TR")}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{p.santiyeler?.is_adi ?? "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell tabular-nums">{p.cep_telefon ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{p.meslek ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{p.gorev ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums">
                      {p.maas != null ? `${p.maas.toLocaleString("tr-TR")} ₺` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/yonetim/personel/${p.id}/duzenle`)}>
                          <Pencil size={16} />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => setDeleteId(p.id)}>
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Personeli silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Bu işlem geri alınamaz.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
