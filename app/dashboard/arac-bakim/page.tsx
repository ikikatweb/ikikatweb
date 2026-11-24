// Araç Bakım & Tamirat sayfası
"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { getAracBakimlar, deleteAracBakim } from "@/lib/supabase/queries/arac-bakim";
import { getAraclar } from "@/lib/supabase/queries/araclar";
import { getPersoneller } from "@/lib/supabase/queries/personel";
import { useAuth, useOturumFiltresi } from "@/hooks";
import BakimFormDialog, { type BakimFormAcilis } from "@/components/shared/bakim-form-dialog";
import type { AracBakimWithArac, AracBakimTipi, AracWithRelations } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Wrench, Plus, Pencil, Trash2, Search, FileDown, FileSpreadsheet, ExternalLink } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { formatParaInput } from "@/lib/utils/para-format";
import { trAramaNormalize } from "@/lib/utils/isim";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { dosyaUrl } from "@/lib/utils/dosya-url";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function formatTarih(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}

function formatSayi(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}


// Supabase/PostgREST hata nesnesini okunabilir stringe çevir
function hataMesaji(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint, e.code ? `(${e.code})` : ""].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
    try { return JSON.stringify(err); } catch { return "Bilinmeyen hata"; }
  }
  return String(err);
}

// Bakım tipi etiketi
function tipEtiket(tip: string | null | undefined): string {
  return tip === "tamirat" ? "Tamirat" : tip === "yedek_parca" ? "Yedek Parça" : "Bakım";
}

// Dosya tipi algılama
function resimMi(url: string): boolean {
  return /\.(jpg|jpeg|png|webp|heic|gif|bmp)(\?|$)/i.test(url);
}
function pdfMi(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

// Dosya URL'inden kısa isim çıkar (ör: .../abc-123-fatura.pdf → fatura.pdf)
function dosyaAd(url: string): string {
  try {
    const last = url.split("/").pop() ?? url;
    // suffix-safeName.ext formatında → ilk iki tireden sonrasını al
    const m = last.match(/^[a-z0-9]+-[a-z0-9]+-(.+)$/i);
    return m ? m[1] : last;
  } catch { return url; }
}

type AdKayit = { id: string; ad_soyad: string; durum?: "aktif" | "pasif" };

export default function AracBakimPage() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  const yEkle = hasPermission("arac-bakim", "ekle");
  const yDuzenle = hasPermission("arac-bakim", "duzenle");
  const ySil = hasPermission("arac-bakim", "sil");
  const [loading, setLoading] = useState(true);
  const [bakimlar, setBakimlar] = useState<AracBakimWithArac[]>([]);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [personeller, setPersoneller] = useState<AdKayit[]>([]);

  // URL parametresi — bildirimden gelen arac_id ile başlangıç
  const urlAracParam = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("arac") ?? ""
    : "";

  // Filtreler oturum-içi (F5'te korunur, sayfadan çıkınca sıfırlanır). filtreArac deep-link'ten (?arac)
  // gelirse taze gelişte URL değeri, F5'te sessionStorage kullanılır (URL zaten temizleniyor).
  const [arama, setArama] = useOturumFiltresi("arac-bakim:arama", "");
  const [filtreArac, setFiltreArac] = useOturumFiltresi("arac-bakim:arac", urlAracParam);
  const [filtreTip, setFiltreTip] = useOturumFiltresi<"" | AracBakimTipi>("arac-bakim:tip", "");
  const [filtreBaslangic, setFiltreBaslangic] = useOturumFiltresi("arac-bakim:bas", "");
  const [filtreBitis, setFiltreBitis] = useOturumFiltresi("arac-bakim:bit", "");

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  // Kasa defterinden gelindiyse: kaydedince/kapatınca kasaya geri dön (?geri=1)
  const [kasayaDon, setKasayaDon] = useState(false);
  const router = useRouter();
  // Form artık ortak bileşende (components/shared/bakim-form-dialog): sayfa yalnız
  // "hangi kayıt düzenleniyor" / "yeni kayıt neyle açılıyor" bilgisini tutar.
  const [duzenleKayit, setDuzenleKayit] = useState<AracBakimWithArac | null>(null);
  const [formAcilis, setFormAcilis] = useState<BakimFormAcilis | undefined>(undefined);

  // Silme onayı
  const [silOnay, setSilOnay] = useState<string | null>(null);


  // Lightbox (fatura/foto önizleme)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);

  // Esc ile kapat, zoom sıfırla
  useEffect(() => {
    if (!lightboxUrl) return;
    setLightboxZoom(1);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
      else if (e.key === "+" || e.key === "=") setLightboxZoom((z) => Math.min(4, z + 0.25));
      else if (e.key === "-") setLightboxZoom((z) => Math.max(0.25, z - 0.25));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxUrl]);

  // Mouse wheel ile zoom (resim + PDF) — passive:false gerektiğinden native listener
  const lightboxWheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!lightboxUrl) return;
    const node = lightboxWheelRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      // Ctrl basılı değilken de wheel ile zoom — kullanıcı isteği
      e.preventDefault();
      const adim = e.deltaY < 0 ? 0.15 : -0.15;
      setLightboxZoom((z) => {
        const yeni = z + adim;
        if (yeni < 0.25) return 0.25;
        if (yeni > 5) return 5;
        return Math.round(yeni * 100) / 100;
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => node.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  }, [lightboxUrl]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [bData, aData, pData] = await Promise.all([
        getAracBakimlar(),
        getAraclar(),
        getPersoneller(),
      ]);
      setBakimlar(bData);
      setAraclar((aData as AracWithRelations[]) ?? []);
      setPersoneller(((pData ?? []) as AdKayit[]));
    } catch (err) {
      console.error("Bakım yükleme hatası:", err);
      const msg = hataMesaji(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("arac_bakim tablosu Supabase'de yok. SQL migrasyonunu çalıştırın.", { duration: toastSuresi() });
      } else {
        toast.error(`Yükleme hatası: ${msg}`, { duration: toastSuresi() });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);


  // Kasa defterinden gelindiyse (?yeni=bakim|tamirat|yedek_parca&tutar&tarih&detay):
  // ilgili pencereyi ÖNCEDEN DOLDURARAK aç. Ödeme kasa üzerinden yapıldığı için
  // "ödemesi yapıldı" otomatik işaretli + ödeyen = giriş yapan kullanıcı. Araç elle seçilir.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const yeni = sp.get("yeni");
    if (yeni !== "bakim" && yeni !== "tamirat" && yeni !== "yedek_parca") return;
    const t = sp.get("tutar") ? parseFloat(sp.get("tutar")!) : NaN;
    setDuzenleKayit(null);
    setFormAcilis({
      tip: yeni,
      tarih: sp.get("tarih") || new Date().toISOString().slice(0, 10),
      tutar: !isNaN(t) ? formatParaInput(t.toFixed(2).replace(".", ",")) : "",
      detay: sp.get("detay") || "",
      kasaId: sp.get("kasaId") || null,
      faturaUrl: sp.get("fatura"),
      odemeYapildi: true,
    });
    setKasayaDon(sp.get("geri") === "1");
    setDialogOpen(true);
    // URL'i temizle — sayfa yenilenince pencere tekrar açılmasın
    window.history.replaceState(null, "", "/dashboard/arac-bakim");
  }, []);


  // Daha önce girilmiş servis/tamirci adlarını topla (autocomplete için)
  const servisTamirciOnerileri = useMemo(() => {
    const set = new Set<string>();
    for (const b of bakimlar) {
      const s = (b.servis_tamirci ?? "").trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [bakimlar]);

  // Sadece öz mal araçlar, plakaya göre sıralı — DİALOG için (araç ekleme/düzenleme)
  const ozMalAraclar = useMemo(() => {
    return araclar
      .filter((a) => a.tip === "ozmal")
      .slice()
      .sort((a, b) => (a.plaka ?? "").localeCompare(b.plaka ?? "", "tr"));
  }, [araclar]);

  // FİLTRE için: sadece daha önce bakım/tamirat kaydı girilmiş araçlar
  const bakimYapilmisAraclar = useMemo(() => {
    const ids = new Set(bakimlar.map((b) => b.arac_id));
    return ozMalAraclar.filter((a) => ids.has(a.id));
  }, [ozMalAraclar, bakimlar]);


  // Filtrelenmiş liste
  // Kısıtlı/şantiye admin için izinli araç id seti:
  //  - Varsayılan: sadece atanmış şantiyelerdeki araçlar
  //  - santiyesiz_veri_gor=true → ayrıca şantiye atanmamış (NULL) araçlar da dahil
  const izinliAracIds = useMemo(() => {
    if (isYonetici || !kullanici?.santiye_ids) return null;
    const izinliS = new Set(kullanici.santiye_ids);
    const santiyesizDahil = !!kullanici.santiyesiz_veri_gor;
    return new Set(
      araclar
        .filter((a) => {
          if (a.santiye_id) return izinliS.has(a.santiye_id);
          return santiyesizDahil; // santiye_id null → yetki varsa görünür
        })
        .map((a) => a.id),
    );
  }, [araclar, isYonetici, kullanici]);

  const filtrelenmis = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    return bakimlar.filter((b) => {
      // Atanmamış şantiyelerin araç bakımlarını gizle
      if (izinliAracIds && !izinliAracIds.has(b.arac_id)) return false;
      if (filtreArac && b.arac_id !== filtreArac) return false;
      if (filtreTip && (b.tip ?? "bakim") !== filtreTip) return false;
      if (filtreBaslangic && b.bakim_tarihi < filtreBaslangic) return false;
      if (filtreBitis && b.bakim_tarihi > filtreBitis) return false;
      if (q) {
        const text = trAramaNormalize([
          b.araclar?.plaka,
          b.araclar?.marka,
          b.araclar?.model,
          b.yaptiran_ad,
          b.servis_tamirci,
          b.detay,
          b.tutar != null ? String(b.tutar) : null,
        ].filter(Boolean).join(" "));
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [bakimlar, filtreArac, filtreTip, filtreBaslangic, filtreBitis, arama, izinliAracIds]);

  // Özet
  const ozet = useMemo(() => {
    const toplamTutar = filtrelenmis.reduce((s, b) => s + (b.tutar ?? 0), 0);
    const odenenTutar = filtrelenmis.reduce((s, b) => s + (b.odeme_yapildi ? (b.tutar ?? 0) : 0), 0);
    const odenmeyenTutar = toplamTutar - odenenTutar;
    return { sayi: filtrelenmis.length, toplamTutar, odenenTutar, odenmeyenTutar };
  }, [filtrelenmis]);

  function dialogAc(tip: AracBakimTipi = "bakim", aracId = "") {
    setDuzenleKayit(null);
    setFormAcilis({ tip, aracId });
    setDialogOpen(true);
  }

  function dialogDuzenleAc(b: AracBakimWithArac) {
    setFormAcilis(undefined);
    setDuzenleKayit(b);
    setDialogOpen(true);
  }


  async function kayitSil() {
    if (!silOnay) return;
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    try {
      await deleteAracBakim(silOnay);
      setSilOnay(null);
      await loadAll();
      toast.success("Silindi.");
    } catch (err) {
      console.error("Silme hatası:", err);
      toast.error(`Hata: ${hataMesaji(err)}`, { duration: toastSuresi() });
    }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(
      filtreTip === "bakim" ? "Arac Bakim Listesi" :
      filtreTip === "tamirat" ? "Arac Tamirat Listesi" :
      filtreTip === "yedek_parca" ? "Arac Yedek Parca Listesi" :
      "Arac Bakim, Tamirat & Yedek Parca Listesi",
      14, 15,
    );
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")} | Toplam: ${filtrelenmis.length} kayit | Toplam tutar: ${formatSayi(ozet.toplamTutar)} TL`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Tarih", "Tip", "Plaka", "Marka/Model", "Yaptiran", "Islemi Giren", "Km", "Servis/Tamirci", "Detay", "Tutar (TL)", "Bakim Yapilacak"]],
      body: filtrelenmis.map((b) => [
        tr(formatTarih(b.bakim_tarihi)),
        tr(tipEtiket(b.tip)),
        tr(b.araclar?.plaka ?? ""),
        tr([b.araclar?.marka, b.araclar?.model].filter(Boolean).join(" ")),
        tr(b.yaptiran_ad ?? ""),
        tr(b.isleme_giren_ad ?? ""),
        b.km != null ? b.km.toLocaleString("tr-TR") : "",
        tr(b.servis_tamirci ?? ""),
        tr(b.detay ?? "").slice(0, 60),
        b.tutar != null ? formatSayi(b.tutar) : "",
        [
          b.sonraki_bakim_km != null ? `${b.sonraki_bakim_km.toLocaleString("tr-TR")} km` : "",
          tr(formatTarih(b.sonraki_bakim_tarihi)),
        ].filter(Boolean).join(" / "),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("arac-bakim-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Tarih", "Tip", "Plaka", "Marka", "Model", "Yaptıran", "İşlemi Giren", "Km/Saat", "Servis/Tamirci", "Detay", "Tutar (TL)", "Ödemeyi Yapan", "Bakım Yapılacak Km", "Bakım Yapılacak Tarih", "Fatura URL'leri", "İş Foto/PDF URL'leri"];
    const data = filtrelenmis.map((b) => {
      const faturaDosyalar = Array.isArray(b.fatura_urls) && b.fatura_urls.length > 0
        ? b.fatura_urls
        : (b.fatura_url ? [b.fatura_url] : []);
      const isFotoDosyalar = Array.isArray(b.is_foto_urls) ? b.is_foto_urls : [];
      return [
        formatTarih(b.bakim_tarihi),
        tipEtiket(b.tip),
        b.araclar?.plaka ?? "",
        b.araclar?.marka ?? "",
        b.araclar?.model ?? "",
        b.yaptiran_ad ?? "",
        b.isleme_giren_ad ?? "",
        b.km ?? "",
        b.servis_tamirci ?? "",
        b.detay ?? "",
        b.tutar ?? "",
        b.odeme_yapildi ? (b.odeyen_adi || "Ödendi") : "",
        b.sonraki_bakim_km ?? "",
        formatTarih(b.sonraki_bakim_tarihi),
        faturaDosyalar.join(" | "),
        isFotoDosyalar.join(" | "),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 40 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 50 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Araç Bakım");
    XLSX.writeFile(wb, "arac-bakim-listesi.xlsx");
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Wrench size={24} /> Araç Bakım, Tamirat &amp; Yedek Parça
        </h1>
        {/* Mobilde 2 satır (PDF/Excel üstte, Yeni Bakım/Tamirat altta), masaüstünde tek satır */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0} className="flex-1 sm:flex-none">
              <FileDown size={14} className="mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0} className="flex-1 sm:flex-none">
              <FileSpreadsheet size={14} className="mr-1" /> Excel
            </Button>
          </div>
          {yEkle && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1 sm:flex-none" onClick={() => dialogAc("bakim")}>
              <Plus size={14} className="mr-1" /> Yeni Bakım
            </Button>
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white flex-1 sm:flex-none" onClick={() => dialogAc("tamirat")}>
              <Plus size={14} className="mr-1" /> Yeni Tamirat
            </Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white flex-1 sm:flex-none" onClick={() => dialogAc("yedek_parca")}>
              <Plus size={14} className="mr-1" /> Yedek Parça
            </Button>
          </div>
          )}
        </div>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Arama</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Plaka, yaptıran, servis, detay..." className="pl-8 h-9 w-56" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Araç</Label>
          <select value={filtreArac} onChange={(e) => setFiltreArac(e.target.value)} className={selectClass}>
            <option value="">Tümü</option>
            {bakimYapilmisAraclar.map((a) => (
              <option key={a.id} value={a.id}>{a.plaka} {a.marka || ""}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Tip</Label>
          <select value={filtreTip} onChange={(e) => setFiltreTip(e.target.value as "" | AracBakimTipi)} className={selectClass}>
            <option value="">Tümü</option>
            <option value="bakim">Bakım</option>
            <option value="tamirat">Tamirat</option>
            <option value="yedek_parca">Yedek Parça</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Başlangıç</Label>
          <input type="date" value={filtreBaslangic} onChange={(e) => setFiltreBaslangic(e.target.value)} className={selectClass} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Bitiş</Label>
          <input type="date" value={filtreBitis} onChange={(e) => setFiltreBitis(e.target.value)} className={selectClass} />
        </div>
        <div className="ml-auto text-xs text-gray-600 text-right">
          <div>Kayıt: <strong>{ozet.sayi}</strong></div>
          <div>Toplam: <strong className="text-[#1E3A5F]">{formatSayi(ozet.toplamTutar)} TL</strong></div>
          <div>Ödenen: <strong className="text-emerald-700">{formatSayi(ozet.odenenTutar)} TL</strong></div>
          <div>Ödenmeyen: <strong className="text-red-600">{formatSayi(ozet.odenmeyenTutar)} TL</strong></div>
        </div>
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="text-center py-16 bg-white rounded-lg border text-gray-500">Yükleniyor...</div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Wrench size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Henüz bakım kaydı yok. Yeni Bakım butonu ile ekleyebilirsiniz.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-auto max-h-[75vh]">
          <Table noWrapper>
            <TableHeader className="sticky top-0 z-10 bg-white shadow-sm">
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">Tarih</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Tip</TableHead>
                <TableHead className="text-white text-[11px] px-2">Araç</TableHead>
                <TableHead className="text-white text-[11px] px-2">Yaptıran</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Km/Saat</TableHead>
                <TableHead className="text-white text-[11px] px-2">Servis/Tamirci</TableHead>
                <TableHead className="text-white text-[11px] px-2">Detay</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Tutar</TableHead>
                <TableHead className="text-white text-[11px] px-2">Ödemesi Yapıldı</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Bakım Yapılacak</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Dosyalar</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center w-[70px]">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((b) => (
                <TableRow key={b.id} className={`text-xs hover:bg-gray-50 ${b.odeme_yapildi ? "italic opacity-60" : ""}`}>
                  <TableCell className="px-2 whitespace-nowrap">{formatTarih(b.bakim_tarihi)}</TableCell>
                  <TableCell className="px-2 text-center">
                    {(b.tip ?? "bakim") === "tamirat" ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">Tamirat</span>
                    ) : (b.tip === "yedek_parca") ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700 border border-purple-200">Yedek Parça</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">Bakım</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 max-w-[150px]">
                    <div className="font-bold text-[#1E3A5F] whitespace-nowrap">{b.araclar?.plaka ?? "—"}</div>
                    <div className="text-[10px] text-gray-500 truncate">{[b.araclar?.marka, b.araclar?.model].filter(Boolean).join(" ") || ""}</div>
                  </TableCell>
                  <TableCell className="px-2 max-w-[130px]">
                    <div className="truncate">{b.yaptiran_ad ?? "—"}</div>
                    {b.isleme_giren_ad && <div className="text-[10px] text-gray-400 truncate">İşleyen: {b.isleme_giren_ad}</div>}
                  </TableCell>
                  <TableCell className="px-2 text-right tabular-nums">{b.km != null ? b.km.toLocaleString("tr-TR") : "—"}</TableCell>
                  <TableCell className="px-2 truncate max-w-[120px]" title={b.servis_tamirci ?? ""}>{b.servis_tamirci ?? "—"}</TableCell>
                  <TableCell className="px-2 truncate max-w-[180px]" title={b.detay ?? ""}>{b.detay ?? "—"}</TableCell>
                  <TableCell className="px-2 text-right font-semibold">{formatSayi(b.tutar)}</TableCell>
                  <TableCell className="px-2 whitespace-nowrap text-emerald-700">
                    {b.odeme_yapildi
                      ? (b.odeyen_adi || "✓ Ödendi")
                      : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 text-center text-[10px]">
                    {b.sonraki_bakim_km != null && <div>{b.sonraki_bakim_km.toLocaleString("tr-TR")} {b.araclar?.sayac_tipi === "saat" ? "sa" : "km"}</div>}
                    {b.sonraki_bakim_tarihi && <div>{formatTarih(b.sonraki_bakim_tarihi)}</div>}
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    {(() => {
                      const faturalar = Array.isArray(b.fatura_urls) && b.fatura_urls.length > 0
                        ? b.fatura_urls
                        : (b.fatura_url ? [b.fatura_url] : []);
                      const fotolar = Array.isArray(b.is_foto_urls) ? b.is_foto_urls : [];
                      if (faturalar.length === 0 && fotolar.length === 0) return <span className="text-gray-300">—</span>;
                      return (
                        <div className="flex items-center justify-center flex-wrap gap-1">
                          {faturalar.map((u, i) => (
                            <button
                              type="button"
                              key={`fat-${i}`}
                              onClick={() => setLightboxUrl(u)}
                              className="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 text-[10px] font-semibold cursor-pointer"
                              title={`Fatura: ${dosyaAd(u)}`}
                            >
                              F{i + 1}
                            </button>
                          ))}
                          {fotolar.map((u, i) => (
                            <button
                              type="button"
                              key={`isf-${i}`}
                              onClick={() => setLightboxUrl(u)}
                              className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 text-[10px] font-semibold cursor-pointer"
                              title={`Foto: ${dosyaAd(u)}`}
                            >
                              {i + 1}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      {yDuzenle && (
                        <button type="button" onClick={() => dialogDuzenleAc(b)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                      )}
                      {ySil && (
                        <button type="button" onClick={() => setSilOnay(b.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Lightbox — fatura/foto önizleme */}
      {lightboxUrl && (
        <div
          ref={lightboxWheelRef}
          className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center animate-in fade-in duration-150"
          onClick={() => setLightboxUrl(null)}
        >
          {/* Üst kontroller */}
          <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
            {(resimMi(lightboxUrl) || pdfMi(lightboxUrl)) && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxZoom((z) => Math.max(0.25, z - 0.25)); }}
                  className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-white"
                  title="Küçült (- veya tekerleği aşağı çevir)"
                >−</button>
                <span className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-sm font-medium min-w-[60px] text-center">
                  {Math.round(lightboxZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxZoom((z) => Math.min(5, z + 0.25)); }}
                  className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-white"
                  title="Büyüt (+ veya tekerleği yukarı çevir)"
                >+</button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxZoom(1); }}
                  className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-xs hover:bg-white"
                  title="Orijinal boyut"
                >1:1</button>
              </>
            )}
            <a
              href={dosyaUrl(lightboxUrl)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-sm hover:bg-white inline-flex items-center gap-1"
              title="Yeni sekmede aç"
            >
              <ExternalLink size={14} /> Yeni sekme
            </a>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
              className="bg-red-500 text-white rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-red-600"
              title="Kapat (Esc)"
            >✕</button>
          </div>

          {/* Alt bilgi çubuğu */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/90 text-black text-xs px-4 py-1.5 rounded-full z-10 pointer-events-none">
            {dosyaAd(lightboxUrl)} — Tekerleği çevir: zoom · Esc: kapat
          </div>

          {/* İçerik */}
          <div
            className="max-w-[92vw] max-h-[92vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {resimMi(lightboxUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dosyaUrl(lightboxUrl)}
                alt=""
                style={{ transform: `scale(${lightboxZoom})`, transformOrigin: "center center", transition: "transform 120ms" }}
                className="max-w-[92vw] max-h-[92vh] object-contain select-none"
                draggable={false}
              />
            ) : pdfMi(lightboxUrl) ? (
              <div
                style={{
                  width: `${92 * lightboxZoom}vw`,
                  height: `${92 * lightboxZoom}vh`,
                  transition: "width 120ms, height 120ms",
                }}
              >
                <iframe
                  src={dosyaUrl(lightboxUrl)}
                  className="w-full h-full bg-white rounded-lg shadow-xl border-0"
                  title="PDF önizleme"
                />
              </div>
            ) : (
              <div className="bg-white p-8 rounded-lg shadow-xl text-center">
                <p className="text-gray-600 mb-3">Bu dosya tipi önizlenemiyor.</p>
                <a
                  href={dosyaUrl(lightboxUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700"
                >
                  <ExternalLink size={16} /> Yeni sekmede aç
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Silme onayı */}
      <Dialog open={!!silOnay} onOpenChange={(o) => !o && setSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Kaydı Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu bakım kaydını silmek istediğinize emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setSilOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={kayitSil}>Sil</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* FORM ORTAK BİLEŞENDE: ana ekrandaki "Yaklaşan Araç Bakımları" kutusu da aynı
          pencereyi açıyor. Kopya form tutulmuyor — burada düzeltilen orada da geçerli. */}
      <BakimFormDialog
        acik={dialogOpen}
        onKapat={() => {
          setDialogOpen(false);
          // Kasa defterinden gelinip pencere kapatılırsa (iptal/dışına tıklama) kasaya dön
          if (kasayaDon) { setKasayaDon(false); router.push("/dashboard/kasa-defteri"); }
        }}
        onKaydedildi={async () => {
          await loadAll();
          if (kasayaDon) { setKasayaDon(false); router.push("/dashboard/kasa-defteri"); }
        }}
        araclar={araclar}
        personeller={personeller}
        servisOnerileri={servisTamirciOnerileri}
        duzenle={duzenleKayit}
        acilis={formAcilis}
        yEkle={yEkle}
        yDuzenle={yDuzenle}
      />
    </div>
  );
}
