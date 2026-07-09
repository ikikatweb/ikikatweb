// Silinen yazışmalar sayfası - Gelen, Giden ve Banka yazışmalarının silinen kayıtları
"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal, flushSync } from "react-dom";
import { trAramaNormalize } from "@/lib/utils/isim";
import { evrakYazdir } from "@/lib/utils/evrak-yazdir";
import {
  getSilinenGelenEvraklar,
  restoreGelenEvrak,
  hardDeleteGelenEvrak,
} from "@/lib/supabase/queries/gelen-evrak";
import {
  getSilinenGidenEvraklar,
  restoreGidenEvrak,
  hardDeleteGidenEvrak,
} from "@/lib/supabase/queries/giden-evrak";
import {
  getSilinenBankaYazismalari,
  restoreBankaYazisma,
  hardDeleteBankaYazisma,
} from "@/lib/supabase/queries/banka-yazismalari";
import { useAuth } from "@/hooks";
import type {
  GelenEvrakWithRelations,
  GidenEvrakWithRelations,
  BankaYazismaWithRelations,
} from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, RotateCcw, Trash, Printer } from "lucide-react";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import GelenEvrakOnIzleme from "@/components/shared/gelen-evrak-onizleme";
import GidenEvrakOnIzleme from "@/components/shared/giden-evrak-onizleme";
import BankaYazismaOnIzleme from "@/components/shared/banka-yazisma-onizleme";
import toast from "react-hot-toast";

type YazismaTuru = "gelen" | "giden" | "banka";

type BirlesikSilinen = {
  id: string;
  tur: YazismaTuru;
  evrak_tarihi: string;
  evrak_sayi_no: string;
  firma_adi: string | null;
  konu: string;
  muhatap: string | null;
  olusturan_ad: string | null;
  silen_ad: string | null;
  silme_nedeni: string | null;
  silme_tarihi: string | null;
  // Tüm kayıt (ön izleme için)
  raw: GelenEvrakWithRelations | GidenEvrakWithRelations | BankaYazismaWithRelations;
};

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

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

const TUR_ETIKET: Record<YazismaTuru, { label: string; color: string }> = {
  gelen: { label: "Gelen Evrak", color: "bg-blue-600" },
  giden: { label: "Giden Evrak", color: "bg-emerald-600" },
  banka: { label: "Banka Yazışması", color: "bg-[#F97316]" },
};

export default function SilinenPage() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  // Silinen yazışmalar modülü yetkileri
  const ySil = hasPermission("yazismalar-silinen", "sil");
  const yEkle = hasPermission("yazismalar-silinen", "ekle"); // geri yükle = ekleme niteliği
  const [kayitlar, setKayitlar] = useState<BirlesikSilinen[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtreler
  const [fArama, setFArama] = useState("");
  const [fTur, setFTur] = useState<"tumu" | YazismaTuru>("tumu");
  const [fBaslangic, setFBaslangic] = useState("");
  const [fBitis, setFBitis] = useState("");

  // Dialog'lar
  const [geriYukleDialog, setGeriYukleDialog] = useState<BirlesikSilinen | null>(null);
  const [kaliciSilDialog, setKaliciSilDialog] = useState<BirlesikSilinen | null>(null);
  // Yazdırma için seçili kayıt (gizli print-portal'a render edilir → window.print())
  const [printKayit, setPrintKayit] = useState<BirlesikSilinen | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const uid = isYonetici ? undefined : kullanici?.id;
      const [gelen, giden, banka] = await Promise.all([
        getSilinenGelenEvraklar(uid),
        getSilinenGidenEvraklar(uid),
        getSilinenBankaYazismalari(uid),
      ]);

      const birlesik: BirlesikSilinen[] = [
        ...(gelen as GelenEvrakWithRelations[]).map((e) => ({
          id: e.id,
          tur: "gelen" as YazismaTuru,
          evrak_tarihi: e.evrak_tarihi,
          evrak_sayi_no: e.evrak_sayi_no,
          firma_adi: e.firmalar?.firma_adi ?? null,
          konu: e.konu,
          muhatap: e.muhatap ?? null,
          olusturan_ad: e.kullanicilar?.ad_soyad ?? null,
          silen_ad: e.silen_kullanici?.ad_soyad ?? null,
          silme_nedeni: e.silme_nedeni ?? null,
          silme_tarihi: e.silme_tarihi ?? e.updated_at ?? null,
          raw: e,
        })),
        ...(giden as GidenEvrakWithRelations[]).map((e) => ({
          id: e.id,
          tur: "giden" as YazismaTuru,
          evrak_tarihi: e.evrak_tarihi,
          evrak_sayi_no: e.evrak_sayi_no,
          firma_adi: e.firmalar?.firma_adi ?? null,
          konu: e.konu,
          muhatap: e.muhatap ?? null,
          olusturan_ad: e.kullanicilar?.ad_soyad ?? null,
          silen_ad: e.silen_kullanici?.ad_soyad ?? null,
          silme_nedeni: e.silme_nedeni ?? null,
          silme_tarihi: e.silme_tarihi ?? e.updated_at ?? null,
          raw: e,
        })),
        ...(banka as BankaYazismaWithRelations[]).map((e) => ({
          id: e.id,
          tur: "banka" as YazismaTuru,
          evrak_tarihi: e.evrak_tarihi,
          evrak_sayi_no: e.evrak_sayi_no,
          firma_adi: e.firmalar?.firma_adi ?? null,
          konu: e.konu,
          muhatap: e.muhatap ?? null,
          olusturan_ad: e.kullanicilar?.ad_soyad ?? null,
          silen_ad: e.silen_kullanici?.ad_soyad ?? null,
          silme_nedeni: e.silme_nedeni ?? null,
          silme_tarihi: e.silme_tarihi ?? e.updated_at ?? null,
          raw: e,
        })),
      ];

      // Silinme tarihine göre sırala (en yeni en üstte)
      birlesik.sort((a, b) => {
        const ta = a.silme_tarihi ? new Date(a.silme_tarihi).getTime() : 0;
        const tb = b.silme_tarihi ? new Date(b.silme_tarihi).getTime() : 0;
        return tb - ta;
      });

      setKayitlar(birlesik);
    } catch {
      toast.error("Silinen yazışmalar yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [isYonetici, kullanici?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filtreleme
  const filtrelenmis = kayitlar.filter((k) => {
    if (fTur !== "tumu" && k.tur !== fTur) return false;
    if (fBaslangic && k.evrak_tarihi < fBaslangic) return false;
    if (fBitis && k.evrak_tarihi > fBitis) return false;
    if (fArama.trim()) {
      const q = trAramaNormalize(fArama);
      const text = trAramaNormalize([
        k.evrak_sayi_no,
        k.konu,
        k.muhatap,
        k.firma_adi,
        k.olusturan_ad,
        k.silen_ad,
        k.silme_nedeni,
      ].filter(Boolean).join(" "));
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const sayilar = {
    gelen: kayitlar.filter((k) => k.tur === "gelen").length,
    giden: kayitlar.filter((k) => k.tur === "giden").length,
    banka: kayitlar.filter((k) => k.tur === "banka").length,
  };

  async function handleGeriYukle() {
    if (!yEkle) { toast.error("Geri yükleme yetkiniz yok."); return; }
    if (!geriYukleDialog) return;
    try {
      if (geriYukleDialog.tur === "gelen") await restoreGelenEvrak(geriYukleDialog.id);
      else if (geriYukleDialog.tur === "giden") await restoreGidenEvrak(geriYukleDialog.id);
      else await restoreBankaYazisma(geriYukleDialog.id);
      setKayitlar((p) => p.filter((x) => !(x.id === geriYukleDialog.id && x.tur === geriYukleDialog.tur)));
      toast.success("Yazışma geri yüklendi.");
    } catch { toast.error("Geri yükleme hatası."); }
    finally { setGeriYukleDialog(null); }
  }

  async function handleKaliciSil() {
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    if (!kaliciSilDialog) return;
    try {
      if (kaliciSilDialog.tur === "gelen") await hardDeleteGelenEvrak(kaliciSilDialog.id);
      else if (kaliciSilDialog.tur === "giden") await hardDeleteGidenEvrak(kaliciSilDialog.id);
      else await hardDeleteBankaYazisma(kaliciSilDialog.id);
      setKayitlar((p) => p.filter((x) => !(x.id === kaliciSilDialog.id && x.tur === kaliciSilDialog.tur)));
      toast.success("Yazışma kalıcı olarak silindi.");
    } catch { toast.error("Silme hatası."); }
    finally { setKaliciSilDialog(null); }
  }

  // Yazdırma — gizli print-portal'a evrağı render edip tarayıcı yazdırma önizlemesini aç (ana sayfalarla aynı)
  function yazdir(k: BirlesikSilinen) {
    flushSync(() => { setPrintKayit(k); });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        evrakYazdir(`${k.evrak_sayi_no ?? ""} ${k.konu ?? ""}`).finally(() => setTimeout(() => setPrintKayit(null), 500));
      });
    });
  }

  return (
    <div>
      {/* Başlık + özet sayılar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Silinen Yazışmalar</h1>
          <p className="text-xs text-gray-500 mt-0.5">Gelen, giden ve banka yazışmalarının silinmiş tüm kayıtları</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge className="bg-blue-600">Gelen: {sayilar.gelen}</Badge>
          <Badge className="bg-emerald-600">Giden: {sayilar.giden}</Badge>
          <Badge className="bg-[#F97316]">Banka: {sayilar.banka}</Badge>
          <Badge variant="secondary">Toplam: {kayitlar.length}</Badge>
        </div>
      </div>

      {/* Genel Arama */}
      <div className="mb-3">
        <Input
          value={fArama}
          onChange={(e) => setFArama(e.target.value)}
          placeholder="Genel arama: sayı no, konu, muhatap, firma, oluşturan, silen, silme nedeni..."
          className="h-9"
        />
      </div>

      {/* Filtreler */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Yazışma Türü</Label>
          <select value={fTur} onChange={(e) => setFTur(e.target.value as "tumu" | YazismaTuru)} className={selectClass + " h-8 text-xs w-full"}>
            <option value="tumu">Tümü</option>
            <option value="gelen">Gelen Evrak</option>
            <option value="giden">Giden Evrak</option>
            <option value="banka">Banka Yazışması</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Başlangıç</Label>
          <Input type="date" value={fBaslangic} onChange={(e) => setFBaslangic(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Bitiş</Label>
          <Input type="date" value={fBitis} onChange={(e) => setFBitis(e.target.value)} className="h-8 text-xs" />
        </div>
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Trash2 size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{kayitlar.length === 0 ? "Silinmiş yazışma yok." : "Filtreye uygun kayıt bulunamadı."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-xs px-2">Tür</TableHead>
                <TableHead className="text-white text-xs px-2">Tarih</TableHead>
                <TableHead className="text-white text-xs px-2">Sayı No</TableHead>
                <TableHead className="text-white text-xs px-2">Firma</TableHead>
                <TableHead className="text-white text-xs px-2">Konu</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">Muhatap</TableHead>
                <TableHead className="text-white text-xs px-2">Oluşturan</TableHead>
                <TableHead className="text-white text-xs px-2">Silen</TableHead>
                <TableHead className="text-white text-xs px-2">Silme Nedeni</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((k) => {
                const tur = TUR_ETIKET[k.tur];
                return (
                  <TableRow key={`${k.tur}-${k.id}`} className="text-xs hover:bg-gray-50">
                    <TableCell className="px-2 whitespace-nowrap">
                      <Badge className={tur.color + " text-[10px]"}>{tur.label}</Badge>
                    </TableCell>
                    <TableCell className="px-2 whitespace-nowrap">{formatTarih(k.evrak_tarihi)}</TableCell>
                    <TableCell className="px-2 whitespace-nowrap font-mono text-[10px]">{k.evrak_sayi_no}</TableCell>
                    <TableCell className="px-2 max-w-[120px] truncate" title={k.firma_adi ?? ""}>{k.firma_adi ?? "—"}</TableCell>
                    <TableCell className="px-2 max-w-[180px] truncate" title={k.konu}>{k.konu}</TableCell>
                    <TableCell className="px-2 leading-snug">
                      {k.muhatap ? tekSatirMuhatap(k.muhatap) : "—"}
                    </TableCell>
                    <TableCell className="px-2">
                      <div className="font-medium">{k.olusturan_ad ?? "—"}</div>
                    </TableCell>
                    <TableCell className="px-2">
                      <div className="font-medium text-red-700">{k.silen_ad ?? "—"}</div>
                      <div className="text-[10px] text-gray-400">{formatTarihSaat(k.silme_tarihi)}</div>
                    </TableCell>
                    <TableCell className="px-2 max-w-[160px] truncate text-gray-600" title={k.silme_nedeni ?? ""}>
                      {k.silme_nedeni ?? "—"}
                    </TableCell>
                    <TableCell className="px-2">
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          onClick={() => yazdir(k)}
                          className="p-1 text-gray-400 hover:text-[#1E3A5F]"
                          title="Yazdır"
                        >
                          <Printer size={14} />
                        </button>
                        {yEkle && (
                          <button
                            onClick={() => setGeriYukleDialog(k)}
                            className="p-1 text-gray-400 hover:text-green-600"
                            title="Geri Yükle"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        {ySil && (
                          <button
                            onClick={() => setKaliciSilDialog(k)}
                            className="p-1 text-gray-400 hover:text-red-600"
                            title="Kalıcı Olarak Sil"
                          >
                            <Trash size={14} />
                          </button>
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

      {/* Geri Yükleme Onay */}
      <AlertDialog open={!!geriYukleDialog} onOpenChange={() => setGeriYukleDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Yazışmayı Geri Yükle</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{geriYukleDialog?.evrak_sayi_no}&quot; numaralı {geriYukleDialog ? TUR_ETIKET[geriYukleDialog.tur].label.toLowerCase() : ""} kaydını geri yüklemek istediğinize emin misiniz? Yazışma ilgili listeye geri döner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleGeriYukle} className="bg-green-600 hover:bg-green-700">
              Geri Yükle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Kalıcı Silme Onay */}
      <AlertDialog open={!!kaliciSilDialog} onOpenChange={() => setKaliciSilDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kalıcı Olarak Sil</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{kaliciSilDialog?.evrak_sayi_no}&quot; numaralı {kaliciSilDialog ? TUR_ETIKET[kaliciSilDialog.tur].label.toLowerCase() : ""} kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleKaliciSil} className="bg-red-600 hover:bg-red-700">
              Kalıcı Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Yazdırma — Portal ile body'ye render edilir; "evrak-print-area" SADECE print'te görünür, ekranda gizli */}
      {printKayit && typeof document !== "undefined" && createPortal(
        <div className="evrak-print-portal evrak-print-area">
          {printKayit.tur === "gelen" && (
            <GelenEvrakOnIzleme
              firma={(printKayit.raw as GelenEvrakWithRelations).firmalar ?? null}
              evrakTarihi={printKayit.raw.evrak_tarihi}
              evrakSayiNo={printKayit.raw.evrak_sayi_no}
              konu={printKayit.raw.konu}
              muhatap={printKayit.raw.muhatap}
              ilgi={(printKayit.raw as GelenEvrakWithRelations).ilgi}
              icerik={(printKayit.raw as GelenEvrakWithRelations).icerik}
              ekler={(printKayit.raw as GelenEvrakWithRelations).ekler}
            />
          )}
          {printKayit.tur === "giden" && (
            <GidenEvrakOnIzleme
              firma={(printKayit.raw as GidenEvrakWithRelations).firmalar ?? null}
              evrakTarihi={printKayit.raw.evrak_tarihi}
              tarihGosterim={(printKayit.raw as GidenEvrakWithRelations).tarih_gosterim ?? null}
              evrakSayiNo={printKayit.raw.evrak_sayi_no}
              konu={printKayit.raw.konu}
              muhatap={printKayit.raw.muhatap}
              ilgiListesi={(printKayit.raw as GidenEvrakWithRelations).ilgi_listesi ?? []}
              metin={(printKayit.raw as GidenEvrakWithRelations).metin}
              ekler={(printKayit.raw as GidenEvrakWithRelations).ekler ?? []}
              kaseDahil={(printKayit.raw as GidenEvrakWithRelations).kase_dahil ?? false}
            />
          )}
          {printKayit.tur === "banka" && (
            <BankaYazismaOnIzleme
              firma={(printKayit.raw as BankaYazismaWithRelations).firmalar ?? null}
              evrakTarihi={printKayit.raw.evrak_tarihi}
              evrakSayiNo={printKayit.raw.evrak_sayi_no}
              konu={printKayit.raw.konu}
              muhatap={printKayit.raw.muhatap}
              ilgiListesi={(printKayit.raw as BankaYazismaWithRelations).ilgi_listesi ?? []}
              metin={(printKayit.raw as BankaYazismaWithRelations).metin}
              ekler={(printKayit.raw as BankaYazismaWithRelations).ekler ?? []}
              kaseDahil={(printKayit.raw as BankaYazismaWithRelations).kase_dahil ?? false}
            />
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
