// Araç listesi sayfası - Sıra no, firma, HGS, aktif/pasif, ruhsat indirme
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAraclar, toggleAracDurum, deleteArac } from "@/lib/supabase/queries/araclar";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import { exportAraclarPDF, exportAraclarExcel } from "@/lib/export";
import type { AracWithRelations, Tanimlama } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Pencil, Truck, Plus, Search, FileDown, FileSpreadsheet, FileCheck, Trash2,
} from "lucide-react";
import toast from "react-hot-toast";

type Filtre = "tumu" | "aktif" | "pasif";

export default function AraclarPage() {
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [cinsSiralama, setCinsSiralama] = useState<Map<string, number>>(new Map());
  const [cinsListesi, setCinsListesi] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [arama, setArama] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tumu");
  const [mulkiyetFiltre, setMulkiyetFiltre] = useState<"tumu" | "ozmal" | "kiralik">("tumu");
  const [cinsFiltre, setCinsFiltre] = useState("tumu");
  const router = useRouter();

  async function loadAraclar() {
    try {
      const [data, cinsData] = await Promise.all([
        getAraclar(),
        getTanimlamalar("arac_cinsi"),
      ]);
      setAraclar((data as AracWithRelations[]) ?? []);
      const tItems = (cinsData as Tanimlama[]) ?? [];
      const sMap = new Map<string, number>();
      tItems.forEach((t, i) => sMap.set(t.deger, i));
      setCinsSiralama(sMap);
      setCinsListesi(tItems.map((t) => t.deger));
    } catch {
      toast.error("Araçlar yüklenirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAraclar(); }, []);

  async function handleDurumDegistir(id: string, yeniDurum: "aktif" | "pasif") {
    try {
      await toggleAracDurum(id, yeniDurum);
      setAraclar((prev) => prev.map((a) =>
        a.id === id ? { ...a, durum: yeniDurum } : a
      ));
      toast.success(yeniDurum === "aktif" ? "Araç aktif yapıldı." : "Araç pasife alındı.");
    } catch {
      toast.error("Durum güncellenirken hata oluştu.");
    }
  }

  // Arama + durum filtresi
  const filtrelenmis = araclar
    .filter((a) => {
      if (filtre !== "tumu" && a.durum !== filtre) return false;
      if (mulkiyetFiltre !== "tumu" && a.tip !== mulkiyetFiltre) return false;
      if (cinsFiltre !== "tumu" && a.cinsi !== cinsFiltre) return false;
      if (!arama.trim()) return true;
      const q = arama.toLowerCase();
      return (
        a.plaka.toLowerCase().includes(q) ||
        (a.marka?.toLowerCase().includes(q) ?? false) ||
        (a.model?.toLowerCase().includes(q) ?? false) ||
        (a.cinsi?.toLowerCase().includes(q) ?? false) ||
        (a.firmalar?.firma_adi?.toLowerCase().includes(q) ?? false) ||
        (a.kiralama_firmasi?.toLowerCase().includes(q) ?? false) ||
        (a.santiyeler?.is_adi?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => {
      const sa = cinsSiralama.get(a.cinsi ?? "") ?? 999;
      const sb = cinsSiralama.get(b.cinsi ?? "") ?? 999;
      return sa - sb;
    });

  return (
    <div>
      {/* Başlık ve butonlar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Araçlar</h1>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/yonetim/araclar/yeni">
            <Button className="bg-[#1E3A5F] hover:bg-[#2a4f7a] text-white">
              <Plus size={16} className="mr-1" /> Yeni Araç Ekle
            </Button>
          </Link>
          <Link href="/dashboard/yonetim/araclar/kiralik">
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white">
              <Plus size={16} className="mr-1" /> Kiralık Araç Ekle
            </Button>
          </Link>
        </div>
      </div>

      {/* Filtre butonları */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          { key: "tumu", label: "Tümü" },
          { key: "aktif", label: "Aktif" },
          { key: "pasif", label: "Pasif" },
        ] as { key: Filtre; label: string }[]).map((f) => (
          <Button key={f.key} variant={filtre === f.key ? "default" : "outline"} size="sm"
            onClick={() => setFiltre(f.key)} className={filtre === f.key ? "bg-[#1E3A5F]" : ""}>
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
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">No</TableHead>
                <TableHead>Mülkiyet</TableHead>
                <TableHead>Plaka</TableHead>
                <TableHead>Firma</TableHead>
                <TableHead>Marka / Model</TableHead>
                <TableHead className="hidden md:table-cell">Cinsi</TableHead>
                <TableHead className="hidden lg:table-cell">Yılı</TableHead>
                <TableHead className="hidden md:table-cell">Şantiye</TableHead>
                <TableHead className="hidden lg:table-cell">Gösterge</TableHead>
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
                    <Badge className={arac.tip === "ozmal" ? "bg-[#1E3A5F]" : "bg-[#F97316]"}>
                      {arac.tip === "ozmal" ? "Özmal" : "Kiralık"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-bold">{arac.plaka}</TableCell>
                  <TableCell className="max-w-[120px] truncate" title={arac.tip === "ozmal" ? arac.firmalar?.firma_adi ?? "" : arac.kiralama_firmasi ?? ""}>
                    {arac.tip === "ozmal"
                      ? arac.firmalar?.firma_adi ?? "—"
                      : arac.kiralama_firmasi ?? "—"}
                  </TableCell>
                  <TableCell>
                    {[arac.marka, arac.model].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{arac.cinsi ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{arac.yili ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell max-w-[120px] truncate" title={arac.santiyeler?.is_adi ?? ""}>{arac.santiyeler?.is_adi ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell tabular-nums">
                    {arac.guncel_gosterge != null
                      ? `${arac.guncel_gosterge.toLocaleString("tr-TR")} ${arac.sayac_tipi === "saat" ? "sa" : "km"}`
                      : "—"}
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
                      onChange={(e) => handleDurumDegistir(arac.id, e.target.value as "aktif" | "pasif")}
                      className="text-xs border rounded px-1.5 py-0.5 bg-white">
                      <option value="aktif">Aktif</option>
                      <option value="pasif">Pasif</option>
                    </select>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" title="Düzenle"
                        onClick={() => router.push(`/dashboard/yonetim/araclar/${arac.id}/duzenle`)}>
                        <Pencil size={16} />
                      </Button>
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
                              toast.error("Bu araca ait puantaj, yakıt veya kira verisi var. Önce ilişkili verileri silin.", { duration: 8000 });
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
    </div>
  );
}
