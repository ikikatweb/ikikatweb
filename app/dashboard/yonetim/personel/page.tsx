// Personel listesi sayfası - Çalışanlar tablosu (isim sıralı)
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPersoneller, deletePersonel } from "@/lib/supabase/queries/personel";
import { getPersonelSantiyeler } from "@/lib/supabase/queries/personel-santiye";
import { getAtamaGecmisiTumu } from "@/lib/supabase/queries/bordro";
import { getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import type { PersonelWithRelations, PersonelSantiye, PersonelAtamaGecmisi } from "@/lib/supabase/types";
import { useAuth } from "@/hooks";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import PersonelForm from "@/components/shared/personel-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, UserCog, Search, FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { trAramaNormalize } from "@/lib/utils/isim";

function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}

// Bir personelin "şu an aktif olduğu" şantiye id'lerini hesapla.
// Kural:
//   - bitis_tarihi NULL olan tüm atamalar = aktif (birden fazla olabilir → çoklu şantiye)
//   - Hiç aktif atama yoksa boş döner → personel listesinde "—" görünür
//     (eski davranış: en son kapanmış atamayı gösterirdi; artık çıkış sonrası şantiye adı görünmüyor)
function aktifSantiyeIdleri(atamalar: PersonelAtamaGecmisi[]): string[] {
  const aktifler = atamalar.filter((a) => !a.bitis_tarihi);
  if (aktifler.length === 0) return [];
  // Aynı şantiye birden çok kez varsa unique
  return Array.from(new Set(aktifler.map((a) => a.santiye_id)));
}

export default function PersonelPage() {
  const [personeller, setPersoneller] = useState<PersonelWithRelations[]>([]);
  const [personelSantiyeler, setPersonelSantiyeler] = useState<PersonelSantiye[]>([]);
  const [atamalar, setAtamalar] = useState<PersonelAtamaGecmisi[]>([]);
  const [santiyeAdMap, setSantiyeAdMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // Filtre seçimleri sessionStorage ile korunur — düzenleme sayfasından dönünce
  // (mount→unmount→mount) seçimler kaybolmasın diye.
  // ÖNEMLİ: sessionStorage SSR'de yok — init'te okumak hydration mismatch'e neden olur.
  // Bu yüzden varsayılanlarla başlıyoruz, mount sonrası useEffect'te restore ediyoruz.
  const FILTRE_KEY = "personel-page-filters";
  const [arama, setArama] = useState("");
  // Personel tipi filtresi: "tumu" | "kadro" | "taseron"
  const [tipFiltre, setTipFiltre] = useState<"tumu" | "kadro" | "taseron">("tumu");
  // Durum filtresi: varsayılan "aktif" — sayfa açılışında pasifler gizli
  const [durumFiltre, setDurumFiltre] = useState<"aktif" | "pasif" | "tumu">("aktif");
  // sessionStorage hidrasyon hazır olduktan SONRA okunur (initial render server ile aynı kalsın diye).
  // ÖNEMLİ: Sadece personel alt-route'undan (ekle/duzenle) dönüldüğünde restore edilir.
  // Sidebar üzerinden başka bir sayfaya gidip dönülürse varsayılanlar kullanılır.
  const PERSONEL_PATH_PREFIX = "/dashboard/yonetim/personel";
  const [filtreYuklendi, setFiltreYuklendi] = useState(false);
  useEffect(() => {
    try {
      const prevPath = sessionStorage.getItem("nav-prev-path") ?? "";
      const personelAltRouteIdiMi =
        prevPath.startsWith(PERSONEL_PATH_PREFIX) && prevPath.length > PERSONEL_PATH_PREFIX.length;
      if (personelAltRouteIdiMi) {
        // Personel düzenleme/ekleme sayfasından dönüş → filtreleri restore et
        const stored = sessionStorage.getItem(FILTRE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<{ arama: string; tipFiltre: typeof tipFiltre; durumFiltre: typeof durumFiltre }>;
          if (typeof parsed.arama === "string") setArama(parsed.arama);
          if (parsed.tipFiltre === "tumu" || parsed.tipFiltre === "kadro" || parsed.tipFiltre === "taseron") setTipFiltre(parsed.tipFiltre);
          if (parsed.durumFiltre === "aktif" || parsed.durumFiltre === "pasif" || parsed.durumFiltre === "tumu") setDurumFiltre(parsed.durumFiltre);
        }
      } else {
        // Başka bir yerden geldi → eski snapshot'ı temizle, varsayılanlar kullanılsın
        sessionStorage.removeItem(FILTRE_KEY);
      }
    } catch { /* sessiz */ }
    setFiltreYuklendi(true);
  }, []);
  // Filtre değişince sessionStorage'a kaydet (sadece restore tamamlandıktan sonra)
  useEffect(() => {
    if (!filtreYuklendi) return;
    try {
      sessionStorage.setItem(FILTRE_KEY, JSON.stringify({ arama, tipFiltre, durumFiltre }));
    } catch { /* sessiz */ }
  }, [arama, tipFiltre, durumFiltre, filtreYuklendi]);
  const { kullanici, isYonetici, hasPermission } = useAuth();
  const yEkle = hasPermission("yonetim-personel", "ekle");
  const yDuzenle = hasPermission("yonetim-personel", "duzenle");
  const ySil = hasPermission("yonetim-personel", "sil");
  // Personel düzenleme — kalem ikonuna tıklayınca dialog (pencere) olarak açılır
  const [duzenlePersonel, setDuzenlePersonel] = useState<PersonelWithRelations | null>(null);

  async function loadPersoneller() {
    try {
      const [data, ps, ag, sList] = await Promise.all([
        getPersoneller(),
        getPersonelSantiyeler().catch(() => []),
        getAtamaGecmisiTumu().catch(() => [] as PersonelAtamaGecmisi[]),
        getSantiyelerAll().catch(() => [] as { id: string; is_adi: string }[]),
      ]);
      setPersoneller((data as PersonelWithRelations[]) ?? []);
      setPersonelSantiyeler(ps as PersonelSantiye[]);
      setAtamalar(ag as PersonelAtamaGecmisi[]);
      const adMap: Record<string, string> = {};
      for (const s of (sList as { id: string; is_adi: string }[])) {
        adMap[s.id] = s.is_adi;
      }
      setSantiyeAdMap(adMap);
    } catch {
      toast.error("Personeller yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  // Personel id → şantiye adı listesi (aktif veya en son atama)
  // Pasif personellerde gösterilmez — bordro takiple aynı davranış (atama kayıtları
  // genellikle pasife alınırken kapatılmıyor; bu yüzden personel.durum'a güveniyoruz).
  const personelSantiyeAdlari = (personelId: string): string[] => {
    const personel = personeller.find((p) => p.id === personelId);
    if (personel?.durum === "pasif") return [];
    const personelAtamalari = atamalar.filter((a) => a.personel_id === personelId);
    const ids = aktifSantiyeIdleri(personelAtamalari);
    return ids.map((id) => santiyeAdMap[id]).filter(Boolean);
  };

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

  // Kısıtlı / Şantiye admini: sadece atandığı şantiyelerdeki personeller
  // (primary santiye_id VEYA personel_santiye junction VEYA atama_gecmisi üzerinden).
  // santiyesiz_veri_gor=true → şantiye atanmamış personeller (primary=null) da görünür.
  const izinliSantiyeler = !isYonetici && kullanici?.santiye_ids
    ? new Set(kullanici.santiye_ids)
    : null;
  const santiyesizDahil = !!kullanici?.santiyesiz_veri_gor;
  const personelIzinliSantiyedeMi = (personelId: string, primarySantiyeId: string | null) => {
    if (!izinliSantiyeler) return true;
    // Primary şantiyesi yoksa: santiyesiz_veri_gor yetkisi varsa göster
    if (!primarySantiyeId) {
      // Junction veya atama geçmişi varsa, izinli şantiyede mi kontrol et
      const junctionVar = personelSantiyeler.some((ps) => ps.personel_id === personelId);
      const atamaVar = atamalar.some((a) => a.personel_id === personelId);
      if (!junctionVar && !atamaVar) return santiyesizDahil;
    } else if (izinliSantiyeler.has(primarySantiyeId)) return true;
    // Junction tablosunda atanmış mı?
    if (personelSantiyeler.some(
      (ps) => ps.personel_id === personelId && izinliSantiyeler.has(ps.santiye_id),
    )) return true;
    // Atama geçmişinde herhangi bir izinli şantiye var mı? (aktif veya kapanmış)
    return atamalar.some((a) =>
      a.personel_id === personelId && izinliSantiyeler.has(a.santiye_id),
    );
  };

  const filtrelenmis = personeller.filter((p) => {
    if (!personelIzinliSantiyedeMi(p.id, p.santiye_id)) return false;
    // Durum filtresi (varsayılan: aktif)
    if (durumFiltre === "aktif" && p.durum === "pasif") return false;
    if (durumFiltre === "pasif" && p.durum !== "pasif") return false;
    // Tip filtresi: kadro = personel_tipi !== "taseron" (boş veya "kadro"); taseron = "taseron"
    if (tipFiltre === "kadro" && p.personel_tipi === "taseron") return false;
    if (tipFiltre === "taseron" && p.personel_tipi !== "taseron") return false;
    if (!arama.trim()) return true;
    const q = trAramaNormalize(arama);
    const santiyeAdlari = personelSantiyeAdlari(p.id).join(" ");
    return (
      trAramaNormalize(p.ad_soyad).includes(q) ||
      p.tc_kimlik_no.includes(q) ||
      trAramaNormalize(p.meslek).includes(q) ||
      trAramaNormalize(p.gorev).includes(q) ||
      trAramaNormalize(santiyeAdlari).includes(q) ||
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
      body: filtrelenmis.map((p) => {
        const santiyeAdlari = personelSantiyeAdlari(p.id);
        return [
          tr(p.ad_soyad), p.tc_kimlik_no,
          tr(santiyeAdlari.length > 0 ? santiyeAdlari.join(", ") : "—"),
          p.cep_telefon ?? "—",
          tr(p.meslek ?? "—"), tr(p.gorev ?? "—"),
          p.maas != null ? p.maas.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "—",
          p.izin_hakki != null ? String(p.izin_hakki) : "—",
          p.durum === "pasif" ? "Pasif" : "Aktif",
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 7 },
    });
    doc.save("personel-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Ad Soyad", "TC Kimlik No", "Şantiye", "Cep Telefonu", "Meslek", "Görev", "Maaş", "İzin Hakkı", "Durum"];
    const data = filtrelenmis.map((p) => {
      const santiyeAdlari = personelSantiyeAdlari(p.id);
      return [
        p.ad_soyad, p.tc_kimlik_no,
        santiyeAdlari.join(", "),
        p.cep_telefon ?? "",
        p.meslek ?? "", p.gorev ?? "",
        p.maas ?? "", p.izin_hakki ?? "",
        p.durum === "pasif" ? "Pasif" : "Aktif",
      ];
    });
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
          {yEkle && (
            <Link href="/dashboard/yonetim/personel/yeni">
              <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white">
                <Plus size={16} className="mr-1" /> Personel Ekle
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Ad, TC, meslek, görev ile ara..." value={arama} onChange={(e) => setArama(e.target.value)} className="pl-9" />
        </div>
        {/* Durum filtresi: Aktif / Pasif / Tümü (varsayılan: Aktif) */}
        <div className="inline-flex items-center bg-white border border-gray-300 rounded-md overflow-hidden">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2.5 border-r border-gray-200">
            Durum
          </span>
          {([
            { k: "aktif", l: "Aktif" },
            { k: "pasif", l: "Pasif" },
            { k: "tumu", l: "Hepsi" },
          ] as const).map((b) => {
            const aktif = durumFiltre === b.k;
            const sayi =
              b.k === "aktif" ? personeller.filter((p) => p.durum !== "pasif").length :
              b.k === "pasif" ? personeller.filter((p) => p.durum === "pasif").length :
              personeller.length;
            return (
              <button key={b.k} type="button" onClick={() => setDurumFiltre(b.k)}
                className={`text-xs px-3 py-2 transition-colors inline-flex items-center gap-1.5 border-r border-gray-200 last:border-r-0 ${
                  aktif ? "bg-emerald-600 text-white"
                    : "bg-white text-gray-600 hover:bg-emerald-50"
                }`}>
                {b.l}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  aktif ? "bg-white/20" : "bg-gray-100 text-gray-500"
                }`}>{sayi}</span>
              </button>
            );
          })}
        </div>
        {/* Tip filtresi: Tümü / Kadro / Taşeron */}
        <div className="inline-flex items-center bg-white border border-gray-300 rounded-md overflow-hidden">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2.5 border-r border-gray-200">
            Tip
          </span>
          {([
            { k: "tumu", l: "Hepsi" },
            { k: "kadro", l: "Kadro" },
            { k: "taseron", l: "Taşeron" },
          ] as const).map((b) => {
            const aktif = tipFiltre === b.k;
            const sayi =
              b.k === "tumu" ? personeller.length :
              b.k === "kadro" ? personeller.filter((p) => p.personel_tipi !== "taseron").length :
              personeller.filter((p) => p.personel_tipi === "taseron").length;
            return (
              <button key={b.k} type="button" onClick={() => setTipFiltre(b.k)}
                className={`text-xs px-3 py-2 transition-colors inline-flex items-center gap-1.5 border-r border-gray-200 last:border-r-0 ${
                  aktif ? "bg-[#1E3A5F] text-white"
                    : "bg-white text-gray-600 hover:bg-blue-50"
                }`}>
                {b.l}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  aktif ? "bg-white/20" : "bg-gray-100 text-gray-500"
                }`}>{sayi}</span>
              </button>
            );
          })}
        </div>
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
                <TableHead className="text-right whitespace-nowrap w-px">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((p) => {
                const pasif = p.durum === "pasif";
                return (
                  <TableRow key={p.id} className={pasif ? "opacity-60 bg-gray-50" : undefined}>
                    <TableCell className="tabular-nums whitespace-nowrap w-px">{p.tc_kimlik_no}</TableCell>
                    <TableCell className="font-medium whitespace-nowrap w-px">
                      <div className="flex items-center gap-1.5">
                        <span className={pasif ? "text-gray-500" : undefined}>{p.ad_soyad}</span>
                        {p.personel_tipi === "taseron" && (
                          <span className="shrink-0 text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold" title="Taşeron">TŞ</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="w-auto min-w-0 max-w-0">
                      {(() => {
                        const adlar = personelSantiyeAdlari(p.id);
                        if (adlar.length === 0) return "—";
                        // Tek şantiye: truncate + title — TruncateTooltip global handler
                        // tıklamayı yakalayıp toast gösterir (çift toast olmasın diye onClick eklenmez).
                        if (adlar.length === 1) {
                          return (
                            <div
                              className="block truncate text-left w-full hover:text-[#F97316] cursor-pointer"
                              title={adlar[0]}
                            >
                              {adlar[0]}
                            </div>
                          );
                        }
                        // Birden fazla şantiye — her chip ayrı satır, kısaltılmış.
                        // Her chip'in kendi title'ı var, TruncateTooltip tıklananı gösterir.
                        return (
                          <div className="flex flex-col gap-0.5 max-w-full text-left w-full">
                            {adlar.map((ad) => (
                              <span
                                key={ad}
                                className="block px-1.5 py-0.5 bg-blue-50 text-blue-800 text-[11px] rounded border border-blue-200 truncate hover:bg-blue-100 cursor-pointer"
                                title={ad}
                              >
                                {ad}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell tabular-nums whitespace-nowrap w-px">{p.cep_telefon ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell whitespace-nowrap w-px">{p.meslek ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell whitespace-nowrap w-px">{p.gorev ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums whitespace-nowrap w-px text-right">
                      {p.maas != null ? `${p.maas.toLocaleString("tr-TR")} ₺` : "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap w-px">
                      <div className="flex items-center justify-end gap-1">
                        {yDuzenle && (
                          <Button variant="ghost" size="sm" onClick={() => setDuzenlePersonel(p)}>
                            <Pencil size={16} />
                          </Button>
                        )}
                        {ySil && (
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => setDeleteId(p.id)}>
                            <Trash2 size={16} />
                          </Button>
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

      {/* Personel düzenleme penceresi — kalem ikonuna tıklayınca açılır (ayrı sayfa yerine dialog) */}
      <Dialog open={!!duzenlePersonel} onOpenChange={(o) => { if (!o) setDuzenlePersonel(null); }}>
        <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle className="truncate">Personel Düzenle{duzenlePersonel ? ` — ${duzenlePersonel.ad_soyad}` : ""}</DialogTitle>
          </DialogHeader>
          {duzenlePersonel && (
            <PersonelForm
              personel={duzenlePersonel}
              onSuccess={() => { setDuzenlePersonel(null); loadPersoneller(); }}
              onCancel={() => setDuzenlePersonel(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
