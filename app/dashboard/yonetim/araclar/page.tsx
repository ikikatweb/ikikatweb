// Araç listesi sayfası - Sıra no, firma, HGS, aktif/pasif, ruhsat indirme
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAraclar, toggleAracDurum, deleteArac } from "@/lib/supabase/queries/araclar";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import { getSantiyelerBasic } from "@/lib/supabase/queries/santiyeler";
import { createClient } from "@/lib/supabase/client";
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

type Filtre = "tumu" | "aktif" | "pasif" | "trafikten_cekildi";

export default function AraclarPage() {
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [cinsSiralama, setCinsSiralama] = useState<Map<string, number>>(new Map());
  const [cinsListesi, setCinsListesi] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [arama, setArama] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tumu");
  const [mulkiyetFiltre, setMulkiyetFiltre] = useState<"tumu" | "ozmal" | "kiralik">("ozmal");
  const [cinsFiltre, setCinsFiltre] = useState("tumu");
  const [sortList, setSortList] = useState<{ key: string; dir: "asc" | "desc" }[]>([]);
  const [sonYakitSantiye, setSonYakitSantiye] = useState<Map<string, string>>(new Map());
  const router = useRouter();

  function handleSort(key: string) {
    setSortList((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx >= 0) {
        // Zaten var — yönü değiştir
        const next = [...prev];
        next[idx] = { key, dir: prev[idx].dir === "asc" ? "desc" : "asc" };
        return next;
      }
      // Yeni sıralama ekle (max 2)
      const yeni = [...prev, { key, dir: "asc" as const }];
      return yeni.slice(-2);
    });
  }
  function sortIcon(key: string) {
    const s = sortList.find((s) => s.key === key);
    if (!s) return "";
    const sira = sortList.indexOf(s) + 1;
    return s.dir === "asc" ? ` ↑${sira > 1 ? sira : ""}` : ` ↓${sira > 1 ? sira : ""}`;
  }

  async function loadAraclar() {
    try {
      const [data, cinsData, santiyeData] = await Promise.all([
        getAraclar(),
        getTanimlamalar("arac_cinsi"),
        getSantiyelerBasic(),
      ]);
      setAraclar((data as AracWithRelations[]) ?? []);
      const tItems = (cinsData as Tanimlama[]) ?? [];
      const sMap = new Map<string, number>();
      tItems.forEach((t, i) => sMap.set(t.deger, i));
      setCinsSiralama(sMap);
      setCinsListesi(tItems.map((t) => t.deger));

      // Her araç için son yakıt verilen şantiyeyi bul
      const santiyeMap = new Map<string, string>();
      for (const s of (santiyeData ?? []) as { id: string; is_adi: string }[]) santiyeMap.set(s.id, s.is_adi);
      try {
        const supabase = createClient();
        const { data: yakitlar } = await supabase
          .from("arac_yakit")
          .select("arac_id, santiye_id, tarih, saat")
          .order("tarih", { ascending: false })
          .order("saat", { ascending: false });
        if (yakitlar) {
          const sonYakit = new Map<string, string>();
          for (const y of yakitlar as { arac_id: string; santiye_id: string }[]) {
            if (!sonYakit.has(y.arac_id)) {
              sonYakit.set(y.arac_id, santiyeMap.get(y.santiye_id) ?? "");
            }
          }
          setSonYakitSantiye(sonYakit);
        }
      } catch { /* sessiz */ }
    } catch {
      toast.error("Araçlar yüklenirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAraclar(); }, []);

  async function handleDurumDegistir(id: string, yeniDurum: "aktif" | "pasif" | "trafikten_cekildi") {
    try {
      await toggleAracDurum(id, yeniDurum);
      setAraclar((prev) => prev.map((a) =>
        a.id === id ? { ...a, durum: yeniDurum } : a
      ));
      const mesajlar = { aktif: "Araç aktif yapıldı.", pasif: "Araç pasife alındı.", trafikten_cekildi: "Araç trafikten çekildi olarak işaretlendi." };
      toast.success(mesajlar[yeniDurum]);
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
        (sonYakitSantiye.get(a.id)?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => {
      for (const s of sortList) {
        let cmp = 0;
        switch (s.key) {
          case "plaka": cmp = a.plaka.localeCompare(b.plaka, "tr"); break;
          case "firma": {
            const fa = (a.tip === "ozmal" ? a.firmalar?.firma_adi : a.kiralama_firmasi) ?? "zzz";
            const fb = (b.tip === "ozmal" ? b.firmalar?.firma_adi : b.kiralama_firmasi) ?? "zzz";
            cmp = fa.localeCompare(fb, "tr"); break;
          }
          case "marka": cmp = (a.marka ?? "").localeCompare(b.marka ?? "", "tr"); break;
          case "cinsi": {
            const sa = cinsSiralama.get(a.cinsi ?? "") ?? 999;
            const sb = cinsSiralama.get(b.cinsi ?? "") ?? 999;
            cmp = sa - sb; break;
          }
          case "yili": cmp = (a.yili ?? 0) - (b.yili ?? 0); break;
          case "santiye": cmp = (sonYakitSantiye.get(a.id) ?? "zzz").localeCompare(sonYakitSantiye.get(b.id) ?? "zzz", "tr"); break;
          case "durum": cmp = (a.durum ?? "").localeCompare(b.durum ?? ""); break;
          case "mulkiyet": cmp = (a.tip ?? "").localeCompare(b.tip ?? ""); break;
        }
        if (cmp !== 0) return cmp * (s.dir === "asc" ? 1 : -1);
      }
      return 0;
    });

  return (
    <div>
      {/* Başlık ve butonlar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Araçlar</h1>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/yonetim/araclar/yeni">
            <Button className="bg-[#64748B] hover:bg-[#2a4f7a] text-white">
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
          { key: "trafikten_cekildi", label: "Trafikten Çekildi" },
        ] as { key: Filtre; label: string }[]).map((f) => (
          <Button key={f.key} variant={filtre === f.key ? "default" : "outline"} size="sm"
            onClick={() => setFiltre(f.key)} className={filtre === f.key ? "bg-[#64748B]" : ""}>
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
        {sortList.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSortList([])} className="text-red-500 text-xs">
            Sıralamayı Temizle
          </Button>
        )}
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
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white shadow-sm">
              <TableRow>
                <TableHead className="w-[50px]">No</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("mulkiyet")}>Mülkiyet{sortIcon("mulkiyet")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("plaka")}>Plaka{sortIcon("plaka")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("firma")}>Firma{sortIcon("firma")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("marka")}>Marka / Model{sortIcon("marka")}</TableHead>
                <TableHead className="hidden md:table-cell cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("cinsi")}>Cinsi{sortIcon("cinsi")}</TableHead>
                <TableHead className="hidden lg:table-cell cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("yili")}>Yılı{sortIcon("yili")}</TableHead>
                <TableHead className="hidden md:table-cell cursor-pointer select-none hover:text-blue-600" onClick={() => handleSort("santiye")}>Şantiye{sortIcon("santiye")}</TableHead>
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
                    <Badge className={arac.tip === "ozmal" ? "bg-[#64748B]" : "bg-[#F97316]"}>
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
                  <TableCell className="hidden md:table-cell max-w-[120px] truncate" title={sonYakitSantiye.get(arac.id) ?? ""}>{sonYakitSantiye.get(arac.id) || "—"}</TableCell>
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
                      onChange={(e) => handleDurumDegistir(arac.id, e.target.value as "aktif" | "pasif" | "trafikten_cekildi")}
                      className="text-xs border rounded px-1.5 py-0.5 bg-white">
                      <option value="aktif">Aktif</option>
                      <option value="pasif">Pasif</option>
                      <option value="trafikten_cekildi">Trafikten Çekildi</option>
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
