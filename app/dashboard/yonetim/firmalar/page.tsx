// Firma listesi sayfası - Aktif/pasif filtre, düzenleme, durum toggle
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getFirmalar, toggleFirmaDurum, deleteFirma, updateFirmaSiraNo } from "@/lib/supabase/queries/firmalar";
import { getAraclar, updateArac, toggleAracDurum } from "@/lib/supabase/queries/araclar";
import type { Firma, AracWithRelations } from "@/lib/supabase/types";
import PageHeader from "@/components/shared/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pencil, Building2, Search, Truck, Trash2, Power, FileDown, FileSpreadsheet, ArrowUp, ArrowDown } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";

function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}

type Filtre = "tumu" | "aktif" | "pasif";

export default function FirmalarPage() {
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState<Filtre>("tumu");
  const [arama, setArama] = useState("");
  const router = useRouter();

  async function loadFirmalar() {
    try {
      const [fData, aData] = await Promise.all([
        getFirmalar(),
        getAraclar(),
      ]);
      setFirmalar(fData ?? []);
      setAraclar((aData ?? []) as AracWithRelations[]);
    } catch {
      toast.error("Firmalar yüklenirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFirmalar(); }, []);

  // Kiralık firma adı değiştir: o firmaya ait tüm araçlardaki kiralama_firmasi'nı güncelle
  async function handleKiralikFirmaRename(eskiAd: string, yeniAd: string) {
    try {
      const ilgiliAraclar = araclar.filter((a) => a.tip === "kiralik" && a.kiralama_firmasi === eskiAd);
      for (const a of ilgiliAraclar) {
        await updateArac(a.id, { kiralama_firmasi: yeniAd });
      }
      await loadFirmalar();
      toast.success(`"${eskiAd}" → "${yeniAd}" olarak güncellendi (${ilgiliAraclar.length} araç).`);
    } catch {
      toast.error("Firma adı güncellenirken hata oluştu.");
    }
  }

  // Kiralık firma sil: o firmaya ait tüm araçlardaki kiralama_firmasi'nı null yap
  async function handleKiralikFirmaSil(firmaAdi: string, aracListesi: AracWithRelations[]) {
    try {
      for (const a of aracListesi) {
        await updateArac(a.id, { kiralama_firmasi: null });
      }
      await loadFirmalar();
      toast.success(`"${firmaAdi}" firma bilgisi ${aracListesi.length} araçtan kaldırıldı.`);
    } catch {
      toast.error("Firma silinirken hata oluştu.");
    }
  }

  // Kiralık firma araçlarını toplu aktif/pasif yap
  async function handleKiralikFirmaDurumDegistir(aracListesi: AracWithRelations[], yeniDurum: "aktif" | "pasif") {
    try {
      for (const a of aracListesi) {
        await toggleAracDurum(a.id, yeniDurum);
      }
      await loadFirmalar();
      toast.success(`${aracListesi.length} araç ${yeniDurum === "pasif" ? "pasife alındı" : "aktif yapıldı"}.`);
    } catch {
      toast.error("Durum güncellenirken hata oluştu.");
    }
  }

  // Kiralık araç firmalarını grupla: firma adı → araç listesi
  const kiralikFirmalar = useMemo(() => {
    const map = new Map<string, AracWithRelations[]>();
    for (const a of araclar) {
      if (a.tip !== "kiralik" || !a.kiralama_firmasi) continue;
      if (!map.has(a.kiralama_firmasi)) map.set(a.kiralama_firmasi, []);
      map.get(a.kiralama_firmasi)!.push(a);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "tr"));
  }, [araclar]);

  async function handleDurumDegistir(id: string, mevcutDurum: "aktif" | "pasif") {
    const yeniDurum = mevcutDurum === "aktif" ? "pasif" : "aktif";
    try {
      await toggleFirmaDurum(id, yeniDurum);
      setFirmalar((prev) => prev.map((f) => f.id === id ? { ...f, durum: yeniDurum } : f));
      toast.success(yeniDurum === "aktif" ? "Firma aktif yapıldı." : "Firma pasife alındı.");
    } catch {
      toast.error("Durum güncellenirken hata oluştu.");
    }
  }

  const filtrelenmis = firmalar.filter((f) => {
    if (filtre !== "tumu" && (f.durum ?? "aktif") !== filtre) return false;
    if (!arama.trim()) return true;
    const q = arama.toLowerCase();
    return (
      f.firma_adi.toLowerCase().includes(q) ||
      (f.kisa_adi?.toLowerCase().includes(q) ?? false) ||
      (f.vergi_no?.includes(q) ?? false) ||
      (f.adres?.toLowerCase().includes(q) ?? false)
    );
  });

  async function handleSiraDegistir(index: number, yon: "yukari" | "asagi") {
    const hedefIndex = yon === "yukari" ? index - 1 : index + 1;
    if (hedefIndex < 0 || hedefIndex >= filtrelenmis.length) return;
    const a = filtrelenmis[index];
    const b = filtrelenmis[hedefIndex];
    try {
      await Promise.all([
        updateFirmaSiraNo(a.id, hedefIndex + 1),
        updateFirmaSiraNo(b.id, index + 1),
      ]);
      await loadFirmalar();
    } catch { toast.error("Sıralama güncellenemedi."); }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Firmalar", 14, 12);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Toplam: ${filtrelenmis.length} firma`, 14, 17);
    autoTable(doc, {
      startY: 22,
      head: [["Firma Adi", "Kisa Adi", "Vergi No", "Adres", "Durum"]],
      body: filtrelenmis.map((f) => [
        tr(f.firma_adi), tr(f.kisa_adi ?? "—"), f.vergi_no ?? "—",
        tr(f.adres ?? "—"), (f.durum ?? "aktif") === "aktif" ? "Aktif" : "Pasif",
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    });
    doc.save("firmalar.pdf");
  }

  function exportExcel() {
    const headers = ["Firma Adı", "Kısa Adı", "Vergi No", "Adres", "Durum"];
    const data = filtrelenmis.map((f) => [
      f.firma_adi, f.kisa_adi ?? "", f.vergi_no ?? "", f.adres ?? "",
      (f.durum ?? "aktif") === "aktif" ? "Aktif" : "Pasif",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Firmalar");
    XLSX.writeFile(wb, "firmalar.xlsx");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <PageHeader
          title="Firmalar"
          actionLabel="Yeni Firma Ekle"
          actionHref="/dashboard/yonetim/firmalar/yeni"
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={14} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={14} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Filtre */}
      <div className="flex gap-2 mb-4">
        {([
          { key: "tumu", label: "Tümü" },
          { key: "aktif", label: "Aktif" },
          { key: "pasif", label: "Pasif" },
        ] as { key: Filtre; label: string }[]).map((f) => (
          <Button key={f.key} variant={filtre === f.key ? "default" : "outline"} size="sm"
            onClick={() => setFiltre(f.key)} className={filtre === f.key ? "bg-[#64748B]" : ""}>
            {f.label}
          </Button>
        ))}
      </div>

      {/* Arama */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input placeholder="Firma adı, kısa adı, vergi no ile ara..." value={arama} onChange={(e) => setArama(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      ) : firmalar.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">Henüz firma eklenmemiş.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Sıra</TableHead>
                <TableHead>Firma Adı</TableHead>
                <TableHead>Kısa Adı</TableHead>
                <TableHead>Vergi No</TableHead>
                <TableHead className="hidden md:table-cell">Adres</TableHead>
                <TableHead className="text-center">Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((firma, idx) => (
                <TableRow key={firma.id} className={(firma.durum ?? "aktif") === "pasif" ? "bg-gray-100 opacity-50" : ""}>
                  <TableCell className="text-center">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => handleSiraDegistir(idx, "yukari")} disabled={idx === 0}
                        className="p-0.5 text-gray-400 hover:text-[#1E3A5F] disabled:opacity-20"><ArrowUp size={14} /></button>
                      <button onClick={() => handleSiraDegistir(idx, "asagi")} disabled={idx === filtrelenmis.length - 1}
                        className="p-0.5 text-gray-400 hover:text-[#1E3A5F] disabled:opacity-20"><ArrowDown size={14} /></button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{firma.firma_adi}</TableCell>
                  <TableCell>{firma.kisa_adi ?? "—"}</TableCell>
                  <TableCell>{firma.vergi_no ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell max-w-xs truncate">{firma.adres ?? "—"}</TableCell>
                  <TableCell className="text-center">
                    <button
                      onClick={() => handleDurumDegistir(firma.id, firma.durum ?? "aktif")}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        (firma.durum ?? "aktif") === "aktif"
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-red-100 text-red-700 hover:bg-red-200"
                      }`}
                    >
                      {(firma.durum ?? "aktif") === "aktif" ? "Aktif" : "Pasif"}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm"
                        onClick={() => router.push(`/dashboard/yonetim/firmalar/${firma.id}/duzenle`)}>
                        <Pencil size={16} />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" title="Sil"
                        onClick={async () => {
                          if (!confirm(`"${firma.firma_adi}" firmasını silmek istediğinize emin misiniz?`)) return;
                          try {
                            await deleteFirma(firma.id);
                            setFirmalar((prev) => prev.filter((f) => f.id !== firma.id));
                            toast.success(`${firma.firma_adi} silindi.`);
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            if (msg.includes("violates foreign key") || msg.includes("referenced") || msg.includes("constraint")) {
                              toast.error("Bu firmaya ait araç, şantiye, evrak veya başka veri bulunuyor. Firma silinemez.", { duration: 8000 });
                            } else {
                              toast.error(`Silme hatası: ${msg}`, { duration: 6000 });
                            }
                          }
                        }}>
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

      {/* Kiralık Araç Firmaları — aynı tablo mantığında */}
      {!loading && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Truck size={20} className="text-[#F97316]" />
              <h2 className="text-lg font-bold text-[#1E3A5F]">Kiralık Araç Firmaları</h2>
              <Badge className="bg-[#F97316]">{kiralikFirmalar.length}</Badge>
            </div>
          </div>

          {kiralikFirmalar.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-lg border border-gray-200">
              <Truck size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">Henüz kiralık araç firması yok.</p>
              <p className="text-xs text-gray-400 mt-1">Kiralık araç eklediğinizde firma otomatik görünür.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Firma Adı</TableHead>
                    <TableHead className="text-center">Araç Sayısı</TableHead>
                    <TableHead>İletişim</TableHead>
                    <TableHead className="text-center">Durum</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kiralikFirmalar.map(([firmaAdi, aracListesi]) => {
                    const iletisim = aracListesi.find((a) => a.kiralik_iletisim)?.kiralik_iletisim ?? "—";
                    return (
                      <TableRow key={firmaAdi}>
                        <TableCell className="font-medium">{firmaAdi}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{aracListesi.length}</Badge>
                        </TableCell>
                        <TableCell className="text-gray-600">{iletisim}</TableCell>
                        <TableCell className="text-center">
                          {(() => {
                            const aktifSayisi = aracListesi.filter((a) => (a.durum ?? "aktif") === "aktif").length;
                            const pasifSayisi = aracListesi.length - aktifSayisi;
                            const tumPasif = aktifSayisi === 0 && aracListesi.length > 0;
                            const tumAktif = pasifSayisi === 0;
                            return (
                              <button
                                onClick={() => {
                                  const yeniDurum = tumPasif ? "aktif" : "pasif";
                                  if (confirm(`"${firmaAdi}" firmasına ait ${aracListesi.length} aracı ${yeniDurum === "pasif" ? "pasife almak" : "aktif yapmak"} istediğinize emin misiniz?`)) {
                                    handleKiralikFirmaDurumDegistir(aracListesi, yeniDurum);
                                  }
                                }}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                  tumPasif
                                    ? "bg-red-100 text-red-700 hover:bg-red-200"
                                    : tumAktif
                                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                                    : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                                }`}
                              >
                                {tumPasif ? "Pasif" : tumAktif ? "Aktif" : `${aktifSayisi}A/${pasifSayisi}P`}
                              </button>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const yeniAd = prompt("Yeni firma adı:", firmaAdi);
                                if (yeniAd && yeniAd.trim() && yeniAd.trim() !== firmaAdi) {
                                  handleKiralikFirmaRename(firmaAdi, yeniAd.trim());
                                }
                              }}
                              title="Firma adını düzenle"
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => {
                                if (aracListesi.length > 0) {
                                  toast.error(`"${firmaAdi}" firmasına ait ${aracListesi.length} araç bulunuyor. Firma silinemez.`, { duration: 6000 });
                                  return;
                                }
                                if (confirm(`"${firmaAdi}" firma bilgisini silmek istediğinize emin misiniz?`)) {
                                  handleKiralikFirmaSil(firmaAdi, aracListesi);
                                }
                              }}
                              title="Sil"
                            >
                              <Trash2 size={14} />
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
        </div>
      )}
    </div>
  );
}
