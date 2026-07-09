// Giden Evrak sayfası - Liste, filtre, yazdır, çoğalt, düzenle, sil (kayıt no kontrolü)
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal, flushSync } from "react-dom";
import { getGidenEvraklar, softDeleteGidenEvrak, updateGidenEvrak, createGidenEvrak, getGidenEvrakSayiNo } from "@/lib/supabase/queries/giden-evrak";
import { trAramaNormalize } from "@/lib/utils/isim";
import { evrakYazdir } from "@/lib/utils/evrak-yazdir";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { useAuth } from "@/hooks";
import type { GidenEvrakWithRelations, Firma } from "@/lib/supabase/types";
import GidenEvrakForm from "@/components/shared/giden-evrak-form";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, MailOpen, Printer, Copy, Pencil, Trash2, FileDown, FileSpreadsheet, Download, AlertCircle, Eye, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import GidenEvrakOnIzleme from "@/components/shared/giden-evrak-onizleme";
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

// Ek satırı parse: "metin|url", "url", veya "metin" formatlarını destekler.
//   - "url"      → { metin: dosya_adi (URL'den çıkarılır), url: url }
//   - "metin|url"→ { metin, url }
//   - "metin"    → { metin, url: null }
function parseEk(ek: string): { metin: string; url: string | null } {
  if (/^https?:\/\//i.test(ek)) {
    let isim = "Ek";
    try {
      const path = new URL(ek).pathname;
      const raw = decodeURIComponent(path.split("/").pop() ?? "");
      isim = raw.replace(/^\d+-/, "") || "Ek";
    } catch { /* default */ }
    return { metin: isim, url: ek };
  }
  // "metin|url" formatını ara — son "|" pozisyonundan böl (metinde "|" varsa diye)
  const idx = ek.lastIndexOf("|");
  if (idx > 0) {
    const olasilik = ek.slice(idx + 1).trim();
    if (/^https?:\/\//i.test(olasilik)) {
      return { metin: ek.slice(0, idx).trim() || "Ek", url: olasilik };
    }
  }
  return { metin: ek, url: null };
}

// Türkçe karakter + özel karakter temizliği (Supabase Storage path için)
function sanitizeDosyaAdi(ad: string): string {
  const harfHaritasi: Record<string, string> = {
    "ç": "c", "Ç": "C", "ğ": "g", "Ğ": "G", "ı": "i", "İ": "I",
    "ö": "o", "Ö": "O", "ş": "s", "Ş": "S", "ü": "u", "Ü": "U",
  };
  let temiz = ad.replace(/[çÇğĞıİöÖşŞüÜ]/g, (m) => harfHaritasi[m] || m);
  temiz = temiz.replace(/[^a-zA-Z0-9._-]/g, "_");
  temiz = temiz.replace(/_+/g, "_");
  return temiz.toLowerCase();
}

export default function GidenEvrakPage() {
  const { kullanici, isYonetici, hasPermission, loading: authLoading } = useAuth();
  const yEkle = hasPermission("yazismalar-giden-evrak", "ekle");
  const yDuzenle = hasPermission("yazismalar-giden-evrak", "duzenle");
  const ySil = hasPermission("yazismalar-giden-evrak", "sil");
  const [evraklar, setEvraklar] = useState<GidenEvrakWithRelations[]>([]);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [loading, setLoading] = useState(true);

  // Form dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editEvrak, setEditEvrak] = useState<GidenEvrakWithRelations | undefined>();

  // Silme dialog'ları
  const [silDialog, setSilDialog] = useState<GidenEvrakWithRelations | null>(null);
  const [silmeNedeni, setSilmeNedeni] = useState("");
  const [silmeOnayDialog, setSilmeOnayDialog] = useState<GidenEvrakWithRelations | null>(null);

  // Kayıt no düzenleme
  const [kayitNoDialog, setKayitNoDialog] = useState<GidenEvrakWithRelations | null>(null);
  // Ek görüntüleme dialog — bir evraka ait ek metin listesini gösterir
  const [ekDialog, setEkDialog] = useState<GidenEvrakWithRelations | null>(null);
  // Dialog içinde belirli bir ek satırına dosya yüklerken index tutar (-1 = yok)
  const [ekUploadIdx, setEkUploadIdx] = useState<number>(-1);
  const [yeniKayitNo, setYeniKayitNo] = useState("");

  // Yazdırma için seçili evrak
  const [printEvrakRef, setPrintEvrakRef] = useState<GidenEvrakWithRelations | null>(null);

  // Filtreler — URL'den ?ara=... ile başlat (bildirimden tıklanarak gelindiğinde)
  const [fArama, setFArama] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ara") ?? ""
      : ""
  );
  const [fBaslangic, setFBaslangic] = useState("");
  const [fBitis, setFBitis] = useState("");
  const [fFirma, setFFirma] = useState("");
  const [fFirmaArama, setFFirmaArama] = useState("");
  const [fFirmaDropdownAcik, setFFirmaDropdownAcik] = useState(false);
  const [fMuhatap, setFMuhatap] = useState("");
  // Muhatap filtresi — aranabilir + seçilebilir dropdown state'leri
  const [fMuhatapArama, setFMuhatapArama] = useState("");
  const [fMuhatapDropdownAcik, setFMuhatapDropdownAcik] = useState(false);

  const loadData = useCallback(async () => {
    // KRİTİK: Auth bilgisi yüklenmeden veri çekme — aksi halde filtre uygulanmadan
    // TÜM evraklar gelir (santiye_admin/kısıtlı kullanıcılar için kısa süreli sızıntı).
    if (authLoading || !kullanici) return;
    try {
      // Kısıtlı kullanıcı: kendi yazdıklarını görür
      // Şantiye admin: kendi şantiyelerinin tüm evraklarını görür
      // Yönetici: hepsini görür
      const olusturan = (kullanici.rol === "kisitli") ? kullanici.id : undefined;
      const santiyeFilter = (!isYonetici && kullanici.santiye_ids) ? kullanici.santiye_ids : undefined;
      const santiyesizDahil = !!kullanici.santiyesiz_veri_gor;
      const [eData, fData] = await Promise.all([
        getGidenEvraklar(olusturan, santiyeFilter, santiyesizDahil),
        getFirmalar(),
      ]);
      // Firma kapsamı: kullanıcının firma_ids'i tanımlıysa sadece o firmalar görünür.
      // (Rol fark etmez — yönetici de kendine firma_ids tanımlayabilir.
      // firma_ids null/boş ise tümüne erişir.)
      const izinliFirmaIds = (kullanici?.firma_ids && kullanici.firma_ids.length > 0)
        ? new Set(kullanici.firma_ids)
        : null;
      const filtreliFirmalar = izinliFirmaIds
        ? (fData ?? []).filter((f) => izinliFirmaIds.has(f.id))
        : (fData ?? []);
      // KISITLI KULLANICI: kendi yazdığı evrakı FIRMA filtresinden bağımsız görür
      // (firma ataması sonradan değişse veya o firma izinli listede olmasa bile).
      setEvraklar(((eData as GidenEvrakWithRelations[]) ?? []).filter((e) =>
        izinliFirmaIds
          ? (!e.firma_id || izinliFirmaIds.has(e.firma_id) || e.olusturan_id === kullanici.id)
          : true,
      ));
      setFirmalar(filtreliFirmalar);
    } catch { toast.error("Veriler yüklenirken hata oluştu."); }
    finally { setLoading(false); }
  }, [authLoading, isYonetici, kullanici?.id, kullanici?.rol, kullanici?.santiye_ids, kullanici?.firma_ids, kullanici?.santiyesiz_veri_gor]);

  useEffect(() => { loadData(); }, [loadData]);

  // Bildirimden ?yazdir={id} ile gelindiyse → o evrağın YAZDIRMA ÖNİZLEMESİNİ otomatik aç.
  const yazdirAcildiRef = useRef(false);
  useEffect(() => {
    if (yazdirAcildiRef.current || loading) return;
    const id = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("yazdir") : null;
    if (!id) return;
    const ev = evraklar.find((e) => e.id === id);
    if (!ev) return;
    yazdirAcildiRef.current = true;
    printEvrak(ev);
    try { const u = new URL(window.location.href); u.searchParams.delete("yazdir"); window.history.replaceState({}, "", u.toString()); } catch { /* sessiz */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evraklar, loading]);

  // NOT: Antet/kaşe ön belleği için artık DOM'a gerçek <img> mount ediyoruz
  // (sayfanın altındaki hidden div'de). new Image() sadece byte cache'liyor,
  // decode bitmeden window.print() snapshot alıyor → ilk yazdırma boş çıkıyordu.

  // Listede kayıtlı olan benzersiz muhataplar (filtre dropdown'u için)
  const kayitliMuhataplar = Array.from(
    new Set(
      evraklar
        .map((e) => (e.muhatap ?? "").trim())
        .filter((m) => m.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, "tr"));

  // Listede en az 1 giden evrak kaydı bulunan firma id'leri (filtre dropdown'u için)
  const kayitliFirmaIds = new Set(
    evraklar.map((e) => e.firma_id).filter((id): id is string => !!id),
  );

  // Firma id → renk map'i (Firma sütunu kaldırıldı, renk şeridi için kullanılır)
  const firmaRenkMap = new Map<string, string>();
  for (const f of firmalar) {
    if (f.renk) firmaRenkMap.set(f.id, f.renk);
  }

  const filtrelenmis = evraklar.filter((e) => {
    if (fBaslangic && e.evrak_tarihi < fBaslangic) return false;
    if (fBitis && e.evrak_tarihi > fBitis) return false;
    if (fFirma && e.firma_id !== fFirma) return false;
    // Muhatap filtresi artık tam eşleşme (dropdown'dan seçilen değer)
    if (fMuhatap && (e.muhatap ?? "") !== fMuhatap) return false;
    if (fArama.trim()) {
      const q = trAramaNormalize(fArama);
      const text = trAramaNormalize([
        e.evrak_sayi_no,
        e.evrak_kayit_no,
        e.konu,
        e.muhatap,
        e.firmalar?.firma_adi,
        e.kullanicilar?.ad_soyad,
        e.metin,
        formatTarih(e.evrak_tarihi),
      ].filter(Boolean).join(" "));
      if (!text.includes(q)) return false;
    }
    return true;
  });

  function handleAdd() { setEditEvrak(undefined); setFormOpen(true); }
  function handleEdit(e: GidenEvrakWithRelations) {
    // Kayıt numarası girilmiş evraklar değiştirilemez
    if (e.evrak_kayit_no) {
      toast.error("Bu evrakın kayıt numarası girilmiş — düzenlenemez.");
      return;
    }
    setEditEvrak(e); setFormOpen(true);
  }

  async function handleCogalt(e: GidenEvrakWithRelations) {
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    // Çoğalt: form açmadan, mevcut evrakın bir kopyasını otomatik kayıt eder.
    // Yeni sayı no üretilir; kayıt no boş; oluşturma tarihi anlık.
    try {
      const yeniSayiNo = await getGidenEvrakSayiNo(e.firma_id, e.muhatap_id ?? null).catch(() => "");
      const payload = {
        evrak_tarihi: new Date().toISOString().slice(0, 10),
        tarih_gosterim: null,
        firma_id: e.firma_id,
        santiye_id: e.santiye_id ?? null,
        evrak_sayi_no: yeniSayiNo,
        evrak_kayit_no: null,
        konu: e.konu,
        muhatap: e.muhatap ?? null,
        muhatap_id: e.muhatap_id ?? null,
        ilgi_listesi: e.ilgi_listesi ?? [],
        metin: e.metin ?? null,
        ekler: e.ekler ?? [],
        kase_dahil: e.kase_dahil ?? false,
        pdf_url: null, // PDF kopyalanmaz — yeni yükleme gerekirse düzenlemeden eklenir
        olusturan_id: kullanici?.id ?? "",
        olusturma_tarihi: new Date().toISOString(),
        silindi: false,
        silme_nedeni: null,
      };
      await createGidenEvrak(payload);
      await loadData();
      toast.success("Evrak çoğaltıldı (yeni kayıt oluşturuldu).");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu";
      toast.error(`Çoğaltma hatası: ${msg}`);
    }
  }

  function handleSilTikla(e: GidenEvrakWithRelations) {
    // Kayıt numarası girilmiş evrak silinemez (rol fark etmez — kalıcı kayıt)
    if (e.evrak_kayit_no) {
      toast.error("Evrak kayıt numarası girilmiş yazıyı silemezsiniz.");
      return;
    }
    setSilDialog(e);
    setSilmeNedeni("");
  }

  async function handleSil() {
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    if (!silDialog || !silmeNedeni.trim()) { toast.error("Silme nedeni zorunludur."); return; }
    try {
      await softDeleteGidenEvrak(silDialog.id, silmeNedeni, kullanici?.id ?? null);
      setEvraklar((p) => p.filter((e) => e.id !== silDialog.id));
      toast.success("Evrak silindi.");
    } catch { toast.error("Silme hatası."); }
    finally { setSilDialog(null); setSilmeNedeni(""); }
  }

  async function handleKayitNoKaydet() {
    if (!kayitNoDialog) return;
    try {
      const guncel = await updateGidenEvrak(kayitNoDialog.id, { evrak_kayit_no: yeniKayitNo || null });
      setEvraklar((p) => p.map((e) => e.id === kayitNoDialog.id ? { ...e, ...(guncel as GidenEvrakWithRelations) } : e));
      toast.success("Kayıt no güncellendi.");
    } catch { toast.error("Güncelleme hatası."); }
    finally { setKayitNoDialog(null); setYeniKayitNo(""); }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Giden Evrak Listesi", 14, 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length}`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Tarih", "Sayi No", "Kayit No", "Firma", "Konu", "Muhatap", "Olusturan"]],
      body: filtrelenmis.map((e) => [
        tr(formatTarih(e.evrak_tarihi)), tr(e.evrak_sayi_no),
        tr(e.evrak_kayit_no ?? "-"),
        tr(e.firmalar?.firma_adi ?? ""), tr(e.konu),
        tr((e.muhatap ?? "").replace(/\n/g, " ")),
        tr(e.kullanicilar?.ad_soyad ?? ""),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("giden-evrak-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Tarih", "Sayı No", "Kayıt No", "Firma", "Konu", "Muhatap", "Oluşturan", "Oluşturma Tarihi"];
    const data = filtrelenmis.map((e) => [
      formatTarih(e.evrak_tarihi), e.evrak_sayi_no, e.evrak_kayit_no ?? "",
      e.firmalar?.firma_adi ?? "", e.konu, (e.muhatap ?? "").replace(/\n/g, " "),
      e.kullanicilar?.ad_soyad ?? "", formatTarihSaat(e.olusturma_tarihi),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Giden Evrak");
    XLSX.writeFile(wb, "giden-evrak-listesi.xlsx");
  }

  function printEvrak(e: GidenEvrakWithRelations) {
    // iOS Safari: setTimeout içindeki print() "otomatik" sayılıp engelleniyor.
    // flushSync ile state'i senkron uygula → print() user-gesture içinde kalsın.
    flushSync(() => {
      setPrintEvrakRef(e);
    });
    // DOM'un layout pass'ı tamamlanması için çift rAF — şehir offset hesabı
    // (hesaplaSehirOfset) doğru render edilmiş bounding box'lara erişebilsin.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Masaüstü: window.print(); iOS: portal PDF'e çevrilip açılır (Safari'nin URL/tarih alt bilgisi
        // yalnız web sayfası yazdırmasında basılır, PDF'te basılmaz). Portal iş bitene kadar mount kalır.
        evrakYazdir(`${e.evrak_sayi_no ?? ""} ${e.konu ?? ""}`).finally(() => setTimeout(() => setPrintEvrakRef(null), 500));
      });
    });
  }

  return (
    <div>
      {/* Başlık */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Giden Evrak</h1>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {yEkle && (
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleAdd}>
              <Plus size={16} className="mr-1" /> Yeni Giden Evrak
            </Button>
          )}
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
          placeholder="Genel arama: sayı no, kayıt no, konu, muhatap, firma, oluşturan, metin..."
          className="h-9"
        />
      </div>

      {/* Filtreler — mobilde tek sütun (alt alta), tarihler küçük max-genişlikte */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4">
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-gray-400">Başlangıç</Label>
          <input type="date" value={fBaslangic} onChange={(e) => setFBaslangic(e.target.value)}
            className="h-8 text-xs w-full max-w-[180px] sm:max-w-none rounded-lg border border-input bg-white px-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/50" />
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-gray-400">Bitiş</Label>
          <input type="date" value={fBitis} onChange={(e) => setFBitis(e.target.value)}
            className="h-8 text-xs w-full max-w-[180px] sm:max-w-none rounded-lg border border-input bg-white px-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/50" />
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-gray-400">Firma</Label>
          {/* Native <select> yerine custom aranabilir dropdown — Chrome'un
              native select dropdown'unu uzun isimlerle genişletmesini engeller.
              Trigger sabit genişlikte, uzun firma isimleri ellipsis ile kırpılır. */}
          <div className="relative">
            <input
              type="text"
              value={fFirmaArama || (fFirma ? (firmalar.find((f) => f.id === fFirma)?.firma_adi ?? "") : "")}
              onChange={(e) => {
                setFFirmaArama(e.target.value);
                setFFirmaDropdownAcik(true);
                if (fFirma) setFFirma("");
              }}
              onFocus={() => setFFirmaDropdownAcik(true)}
              onBlur={() => setTimeout(() => setFFirmaDropdownAcik(false), 150)}
              placeholder="Tümü"
              className="h-8 text-xs w-full min-w-0 rounded-lg border border-input bg-white px-2 pr-7 outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 truncate"
            />
            {(fFirma || fFirmaArama) && (
              <button
                type="button"
                onClick={() => { setFFirma(""); setFFirmaArama(""); setFFirmaDropdownAcik(false); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs leading-none"
                title="Temizle"
              >
                ×
              </button>
            )}
            {fFirmaDropdownAcik && (() => {
              const q = trAramaNormalize(fFirmaArama);
              const firmaListesi = firmalar.filter((f) => kayitliFirmaIds.has(f.id));
              const filtreli = q
                ? firmaListesi.filter((f) => trAramaNormalize(f.firma_adi).includes(q))
                : firmaListesi;
              if (filtreli.length === 0) {
                return (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg p-3 text-[11px] text-gray-400"
                  >
                    Eşleşen firma yok.
                  </div>
                );
              }
              return (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto"
                >
                  {filtreli.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setFFirma(f.id);
                        setFFirmaArama("");
                        setFFirmaDropdownAcik(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 truncate ${fFirma === f.id ? "bg-blue-50 font-semibold" : ""}`}
                      title={f.firma_adi}
                    >
                      {f.firma_adi}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-gray-400">Muhatap</Label>
          {/* Aranabilir + seçilebilir dropdown — yazıp süzebilir veya tıklayıp seçebilir.
              Liste sadece giden evraklarda kullanılmış muhatapları içerir. */}
          <div className="relative">
            <input
              type="text"
              value={fMuhatapArama || (fMuhatap ? tekSatirMuhatap(fMuhatap) : "")}
              onChange={(e) => {
                setFMuhatapArama(e.target.value);
                setFMuhatapDropdownAcik(true);
                if (fMuhatap) setFMuhatap("");
              }}
              onFocus={() => setFMuhatapDropdownAcik(true)}
              onBlur={() => setTimeout(() => setFMuhatapDropdownAcik(false), 150)}
              placeholder="Ara veya seç..."
              className="h-8 text-xs w-full min-w-0 rounded-lg border border-input bg-white px-2 pr-7 outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
            />
            {(fMuhatap || fMuhatapArama) && (
              <button
                type="button"
                onClick={() => { setFMuhatap(""); setFMuhatapArama(""); setFMuhatapDropdownAcik(false); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs leading-none"
                title="Temizle"
              >
                ×
              </button>
            )}
            {fMuhatapDropdownAcik && (() => {
              const q = trAramaNormalize(fMuhatapArama);
              const filtreli = q
                ? kayitliMuhataplar.filter((m) => trAramaNormalize(tekSatirMuhatap(m)).includes(q))
                : kayitliMuhataplar;
              if (filtreli.length === 0) {
                return (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg p-3 text-[11px] text-gray-400"
                  >
                    Eşleşen muhatap yok.
                  </div>
                );
              }
              return (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto"
                >
                  {filtreli.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setFMuhatap(m);
                        setFMuhatapArama("");
                        setFMuhatapDropdownAcik(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${fMuhatap === m ? "bg-blue-50 font-semibold" : ""}`}
                    >
                      {tekSatirMuhatap(m)}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <MailOpen size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Henüz giden evrak eklenmemiş.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          {/* border-separate border-spacing-0: Tailwind preflight tabloya border-collapse: collapse uyguluyor,
              bu position: sticky'nin <th> üzerinde çalışmasını engelliyor. border-separate sticky'i etkinleştirir. */}
          <Table noWrapper className="min-w-[1100px] border-separate border-spacing-0">
            <TableHeader className="sticky top-0 z-20">
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead
                  className="text-white text-xs px-2"
                  style={{
                    position: "sticky",
                    left: 0,
                    top: 0,
                    zIndex: 100,
                    backgroundColor: "#64748B",
                  }}
                >Tarih</TableHead>
                <TableHead className="text-white text-xs px-2">Sayı No</TableHead>
                <TableHead className="text-white text-xs px-2">Kayıt No</TableHead>
                <TableHead className="text-white text-xs px-2">Konu</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">Muhatap</TableHead>
                <TableHead className="text-white text-xs px-2 text-center w-[60px]">Ek</TableHead>
                <TableHead className="text-white text-xs px-2">Oluşturan</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((e) => (
                <TableRow key={e.id} className="text-xs hover:bg-gray-50">
                  {/* Tarih hücresinin solunda firma rengi şeridi (sütun kaldırıldı).
                      sticky left-0 INLINE — header sticky'nin (z:100) altında kalsın (z:5). */}
                  <TableCell
                    className="px-2 whitespace-nowrap"
                    style={{ position: "sticky", left: 0, zIndex: 5, backgroundColor: "white" }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-1 self-stretch rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: firmaRenkMap.get(e.firma_id ?? "") ?? "#e5e7eb",
                          minHeight: "1.25rem",
                        }}
                        title={e.firmalar?.firma_adi ?? "Firma yok"}
                      />
                      <span>{formatTarih(e.evrak_tarihi)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 whitespace-nowrap font-mono text-[10px]">{e.evrak_sayi_no}</TableCell>
                  <TableCell className="px-2 whitespace-nowrap">
                    {e.evrak_kayit_no ? (
                      <span className="text-green-700 font-medium">{e.evrak_kayit_no}</span>
                    ) : (
                      <button
                        onClick={() => { setKayitNoDialog(e); setYeniKayitNo(""); }}
                        className="flex items-center gap-1 text-red-500 hover:text-red-700 hover:underline"
                        title="Kayıt no eksik - tıkla ekle"
                      >
                        <AlertCircle size={12} /> Evrak kayıt no eksik
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="px-2 max-w-[200px] truncate" title={e.konu}>{e.konu}</TableCell>
                  <TableCell className="px-2 leading-snug">
                    {e.muhatap ? tekSatirMuhatap(e.muhatap) : "—"}
                  </TableCell>
                  {/* Ek sütunu — Muhatap ile Oluşturan arasında. Ek listesi varsa göz ikonu */}
                  <TableCell className="px-2 text-center">
                    {e.ekler && e.ekler.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setEkDialog(e)}
                        className="relative inline-flex items-center justify-center p-1 text-gray-500 hover:text-[#1E3A5F]"
                        title={`${e.ekler.length} ek — görüntüle`}
                      >
                        <Eye size={16} />
                        {e.ekler.length > 1 && (
                          <span className="absolute -top-1 -right-1 bg-[#F97316] text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] px-0.5 flex items-center justify-center leading-none">
                            {e.ekler.length}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
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
                      {yEkle && (
                        <button onClick={() => handleCogalt(e)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Çoğalt"><Copy size={14} /></button>
                      )}
                      {/* Evrak Taraması (PDF) butonu — sadece pdf_url yüklenmiş evraklar için gözükür */}
                      {e.pdf_url && (
                        <a href={e.pdf_url} target="_blank" rel="noopener noreferrer" className="p-1 text-gray-400 hover:text-green-600" title="Evrak Taraması (PDF)"><Download size={14} /></a>
                      )}
                      {yDuzenle && !e.evrak_kayit_no && (
                        <button onClick={() => handleEdit(e)} className="p-1 text-gray-400 hover:text-[#F97316]" title="Düzenle"><Pencil size={14} /></button>
                      )}
                      {yDuzenle && e.evrak_kayit_no && (
                        <button
                          type="button"
                          disabled
                          className="p-1 text-gray-300 cursor-not-allowed"
                          title="Kayıt numarası girilmiş — düzenlenemez"
                        ><Pencil size={14} /></button>
                      )}
                      {ySil && !e.evrak_kayit_no && (
                        <button onClick={() => handleSilTikla(e)} className="p-1 text-gray-400 hover:text-red-500" title="Sil"><Trash2 size={14} /></button>
                      )}
                      {ySil && e.evrak_kayit_no && (
                        <button
                          type="button"
                          disabled
                          className="p-1 text-gray-300 cursor-not-allowed"
                          title="Kayıt numarası girilmiş — silinemez"
                        ><Trash2 size={14} /></button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Form Dialog — boşluğa veya Esc'e tıklayınca kapanmaz; sadece ✕ / İptal / Kaydet ile kapanır */}
      <Dialog open={formOpen} onOpenChange={setFormOpen} disablePointerDismissal>
        <DialogContent className="!w-[95vw] md:!w-[50vw] !max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEvrak?.id ? "Giden Evrak Düzenle" : "Yeni Giden Evrak"}</DialogTitle>
          </DialogHeader>
          {(() => {
            const cogaltKey = (editEvrak as unknown as { _cogaltKey?: number } | null)?._cogaltKey;
            const formKey = editEvrak?.id
              ? `edit-${editEvrak.id}`
              : cogaltKey
              ? `cogalt-${cogaltKey}`
              : "yeni";
            return (
              <GidenEvrakForm
                key={formKey}
                evrak={editEvrak ?? undefined}
                onSuccess={() => { setFormOpen(false); loadData(); }}
                onCancel={() => setFormOpen(false)}
              />
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Ek Listesi Dialog — Ek sütunundaki göz ikonuna tıklanınca açılır */}
      <Dialog open={!!ekDialog} onOpenChange={() => setEkDialog(null)}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Ekler</DialogTitle>
          </DialogHeader>
          {ekDialog && (
            <div className="space-y-1.5 py-2 min-w-0">
              <p className="text-xs text-gray-500 mb-2 break-words" title={ekDialog.konu}>
                <span className="font-semibold">{ekDialog.konu.length > 60 ? ekDialog.konu.slice(0, 60) + "..." : ekDialog.konu}</span> · {(ekDialog.ekler ?? []).length} ek
              </p>
              {(ekDialog.ekler ?? []).map((ek, i) => {
                const { metin, url } = parseEk(ek);
                // Açılacak dosya: ek'in kendi URL'i varsa onu, yoksa evrak'ın
                // ana PDF taramasını (pdf_url) kullan.
                const acilacakUrl = url || ekDialog.pdf_url || null;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200 bg-gray-50 text-sm text-[#1E3A5F] min-w-0"
                  >
                    {/* PDF İndir butonu — sadece dosyası olan ekler için gösterilir.
                        Dosyası yoksa hiç görünmez (kullanıcı talebine göre). */}
                    {acilacakUrl && (
                      <a
                        href={acilacakUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 p-1 text-gray-400 hover:text-green-600"
                        title="Eki Görüntüle / İndir"
                      >
                        <Download size={14} />
                      </a>
                    )}
                    <span className="text-[10px] font-semibold text-gray-500 w-10 flex-shrink-0">Ek {i + 1}</span>
                    <span className="truncate flex-1 min-w-0" title={metin}>{metin}</span>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEkDialog(null)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kayıt no düzenleme dialog */}
      <Dialog open={!!kayitNoDialog} onOpenChange={() => setKayitNoDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Evrak Kayıt Numarası</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Kurumdan gelen resmi kayıt numarasını girin</Label>
            <Input value={yeniKayitNo} onChange={(e) => setYeniKayitNo(e.target.value)} placeholder="Örn: 2026/12345" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKayitNoDialog(null)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleKayitNoKaydet} disabled={!yeniKayitNo.trim()}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Silme nedeni dialog (kayıt no yok) */}
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

      {/* Kayıt no varsa çift onay */}
      <AlertDialog open={!!silmeOnayDialog} onOpenChange={() => setSilmeOnayDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dikkat: Kayıt Numaralı Evrak</AlertDialogTitle>
            <AlertDialogDescription>
              Evrak kayıt numarası girilmiş silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (silmeOnayDialog) {
                  setSilDialog(silmeOnayDialog);
                  setSilmeNedeni("");
                }
                setSilmeOnayDialog(null);
              }}
              className="bg-red-500 hover:bg-red-600">
              Devam Et
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* GİZLİ PRE-RENDER: tüm firmaların antet/kaşe görsellerini DOM'a mount et.
          Tarayıcı bunları gerçekten yükleyip decode eder ve cache'ler.
          Print portal mount edildiğinde aynı URL'ler anında render olur.
          Ekranda görünmesinler (offscreen + size 1px). */}
      <div aria-hidden="true" style={{ position: "absolute", left: -99999, top: -99999, width: 1, height: 1, overflow: "hidden", pointerEvents: "none" }}>
        {firmalar.map((f) => (
          <span key={f.id}>
            {f.antet_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.antet_url} alt="" width={1} height={1} loading="eager" decoding="sync" />
            )}
            {f.kase_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.kase_url} alt="" width={1} height={1} loading="eager" decoding="sync" />
            )}
          </span>
        ))}
      </div>

      {/* Yazdırma için — Portal ile body'nin en üstüne render edilir
          (sayfa hierarşisine girmez, ilk sayfa boş kalmaz)
          "evrak-print-portal" class'ı SADECE print'de kullanılır, ekranda gizlenir */}
      {printEvrakRef && typeof document !== "undefined" && createPortal(
        <div className="evrak-print-portal evrak-print-area">
          <GidenEvrakOnIzleme
            firma={printEvrakRef.firmalar ?? null}
            evrakTarihi={printEvrakRef.evrak_tarihi}
            tarihGosterim={printEvrakRef.tarih_gosterim ?? null}
            evrakSayiNo={printEvrakRef.evrak_sayi_no}
            konu={printEvrakRef.konu}
            muhatap={printEvrakRef.muhatap}
            ilgiListesi={printEvrakRef.ilgi_listesi ?? []}
            metin={printEvrakRef.metin}
            ekler={printEvrakRef.ekler ?? []}
            kaseDahil={printEvrakRef.kase_dahil ?? false}
          />
        </div>,
        document.body,
      )}

    </div>
  );
}
