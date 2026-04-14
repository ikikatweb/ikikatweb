// Kullanıcı yönetimi sayfası - Kullanıcı listesi, ekleme, düzenleme, aktif/pasif
"use client";

import { useEffect, useState } from "react";
import {
  getKullanicilar,
  updateKullanici,
  deleteKullanici,
} from "@/lib/supabase/queries/kullanicilar";
import { getSantiyeler } from "@/lib/supabase/queries/santiyeler";
import type { Kullanici, SantiyeWithRelations } from "@/lib/supabase/types";
import KullaniciForm from "@/components/shared/kullanici-form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Users, Search, FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}

export default function KullanicilarPage() {
  const [kullanicilar, setKullanicilar] = useState<Kullanici[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editKullanici, setEditKullanici] = useState<Kullanici | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [santiyeMap, setSantiyeMap] = useState<Record<string, string>>({});

  async function loadKullanicilar() {
    try {
      const [kData, sData] = await Promise.all([getKullanicilar(), getSantiyeler()]);
      setKullanicilar(kData);
      const map: Record<string, string> = {};
      ((sData as SantiyeWithRelations[]) ?? []).forEach((s) => { map[s.id] = s.is_adi; });
      setSantiyeMap(map);
    } catch {
      toast.error("Kullanıcılar yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadKullanicilar(); }, []);

  function handleAdd() {
    setEditKullanici(undefined);
    setDialogOpen(true);
  }

  function handleEdit(k: Kullanici) {
    setEditKullanici(k);
    setDialogOpen(true);
  }

  async function handleToggleAktif(k: Kullanici) {
    try {
      await updateKullanici(k.id, { aktif: !k.aktif });
      setKullanicilar((prev) =>
        prev.map((u) => u.id === k.id ? { ...u, aktif: !k.aktif } : u)
      );
      toast.success(k.aktif ? "Kullanıcı pasife alındı." : "Kullanıcı aktif yapıldı.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hata oluştu";
      toast.error(msg);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteKullanici(deleteId);
      setKullanicilar((prev) => prev.filter((u) => u.id !== deleteId));
      toast.success("Kullanıcı silindi.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hata oluştu";
      toast.error(msg);
    } finally {
      setDeleteId(null);
    }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Kullanicilar", 14, 12);
    autoTable(doc, {
      startY: 18,
      head: [["Ad Soyad", "Kullanici Adi", "Rol", "Durum"]],
      body: kullanicilar.map((k) => [
        tr(k.ad_soyad), k.kullanici_adi,
        k.rol === "yonetici" ? "Yonetici" : "Kisitli",
        k.aktif ? "Aktif" : "Pasif",
      ]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    });
    doc.save("kullanicilar.pdf");
  }

  function exportExcel() {
    const headers = ["Ad Soyad", "Kullanıcı Adı", "Rol", "Durum"];
    const data = kullanicilar.map((k) => [
      k.ad_soyad, k.kullanici_adi,
      k.rol === "yonetici" ? "Yönetici" : "Kısıtlı",
      k.aktif ? "Aktif" : "Pasif",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kullanicilar");
    XLSX.writeFile(wb, "kullanicilar.xlsx");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Kullanıcılar</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={kullanicilar.length === 0}>
            <FileDown size={14} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={kullanicilar.length === 0}>
            <FileSpreadsheet size={14} className="mr-1" /> Excel
          </Button>
          <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleAdd}>
            <Plus size={16} className="mr-1" /> Kullanıcı Ekle
          </Button>
        </div>
      </div>

      {/* Arama */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input placeholder="Ad, kullanıcı adı ile ara..." value={arama} onChange={(e) => setArama(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
        ))}</div>
      ) : kullanicilar.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">Henüz kullanıcı eklenmemiş.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad Soyad</TableHead>
                <TableHead>Kullanıcı Adı</TableHead>
                <TableHead>Şifre</TableHead>
                <TableHead className="text-center">Rol</TableHead>
                <TableHead className="hidden md:table-cell">Şantiyeler</TableHead>
                <TableHead className="text-center">Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kullanicilar.filter((k) => {
                if (!arama.trim()) return true;
                const q = arama.toLowerCase();
                return k.ad_soyad.toLowerCase().includes(q) || k.kullanici_adi.toLowerCase().includes(q);
              }).map((k) => (
                <TableRow key={k.id} className={!k.aktif ? "bg-gray-100 opacity-50" : ""}>
                  <TableCell className="font-medium">{k.ad_soyad}</TableCell>
                  <TableCell>{k.kullanici_adi}</TableCell>
                  <TableCell className="font-mono text-sm">{k.sifre_gorunur ?? "••••••"}</TableCell>
                  <TableCell className="text-center">
                    <Badge className={k.rol === "yonetici" ? "bg-[#F97316]" : "bg-gray-500"}>
                      {k.rol === "yonetici" ? "Yönetici" : "Kısıtlı"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {k.santiye_ids && k.santiye_ids.length > 0
                      ? k.santiye_ids.map((sid) => santiyeMap[sid] || sid).join(", ")
                      : k.rol === "yonetici" ? "Tümü" : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      onClick={() => handleToggleAktif(k)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        k.aktif
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-red-100 text-red-700 hover:bg-red-200"
                      }`}
                    >
                      {k.aktif ? "Aktif" : "Pasif"}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(k)}>
                        <Pencil size={16} />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                        onClick={() => setDeleteId(k.id)}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Kullanıcı Ekle/Düzenle Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="!max-w-none w-screen h-screen !rounded-none overflow-y-auto m-0 p-6">
          <DialogHeader>
            <DialogTitle>{editKullanici ? "Kullanıcı Düzenle" : "Yeni Kullanıcı Ekle"}</DialogTitle>
          </DialogHeader>
          <KullaniciForm
            kullanici={editKullanici}
            onSuccess={() => { setDialogOpen(false); loadKullanicilar(); }}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Silme Onay */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kullanıcıyı silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Bu işlem geri alınamaz. Kullanıcı tamamen silinecektir.</AlertDialogDescription>
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
