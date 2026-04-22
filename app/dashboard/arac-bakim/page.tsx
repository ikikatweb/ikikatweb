// Araç Bakım & Tamirat sayfası
"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  getAracBakimlar,
  insertAracBakim,
  updateAracBakim,
  deleteAracBakim,
  uploadBakimDosyalar,
} from "@/lib/supabase/queries/arac-bakim";
import { getAraclar } from "@/lib/supabase/queries/araclar";
import { getPersoneller } from "@/lib/supabase/queries/personel";
import { useAuth } from "@/hooks";
import type { AracBakimWithArac, AracBakimTipi, AracWithRelations } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Wrench, Plus, Pencil, Trash2, Search, FileDown, FileSpreadsheet, Download, ExternalLink } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import toast from "react-hot-toast";

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

// Bir yıl sonrasının tarihini ISO formatında döndür
function birYilSonra(tarih: string): string {
  const d = new Date(tarih + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
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
  const { kullanici } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bakimlar, setBakimlar] = useState<AracBakimWithArac[]>([]);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [personeller, setPersoneller] = useState<AdKayit[]>([]);

  // Filtreler
  const [arama, setArama] = useState("");
  const [filtreArac, setFiltreArac] = useState("");
  const [filtreTip, setFiltreTip] = useState<"" | AracBakimTipi>("");
  const [filtreBaslangic, setFiltreBaslangic] = useState("");
  const [filtreBitis, setFiltreBitis] = useState("");

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [dTip, setDTip] = useState<AracBakimTipi>("bakim");
  const [dAracId, setDAracId] = useState("");
  const [dTarih, setDTarih] = useState("");
  const [dYaptiranId, setDYaptiranId] = useState("");
  const [dServisTamirci, setDServisTamirci] = useState("");
  const [dTutar, setDTutar] = useState("");
  const [dKm, setDKm] = useState("");
  const [dDetay, setDDetay] = useState("");
  const [dSonrakiKm, setDSonrakiKm] = useState("");
  const [dSonrakiTarih, setDSonrakiTarih] = useState("");
  // Fatura dosyaları (mali belge)
  const [dFaturaYeni, setDFaturaYeni] = useState<File[]>([]);
  const [dFaturaMevcut, setDFaturaMevcut] = useState<string[]>([]);
  // İş fotoğraf/PDF'leri (yapılan işle ilgili)
  const [dIsFotoYeni, setDIsFotoYeni] = useState<File[]>([]);
  const [dIsFotoMevcut, setDIsFotoMevcut] = useState<string[]>([]);
  const [dialogLoading, setDialogLoading] = useState(false);

  // Silme onayı
  const [silOnay, setSilOnay] = useState<string | null>(null);

  // Dialog'daki araç seçici — açılır popover + arama
  const [dAracAra, setDAracAra] = useState("");
  const [dAracAcik, setDAracAcik] = useState(false);

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
        toast.error("arac_bakim tablosu Supabase'de yok. SQL migrasyonunu çalıştırın.", { duration: 8000 });
      } else {
        toast.error(`Yükleme hatası: ${msg}`, { duration: 8000 });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Seçili araç + sayaç tipi + güncel km
  const seciliArac = useMemo(() => araclar.find((x) => x.id === dAracId) ?? null, [dAracId, araclar]);
  const seciliAracSayacTipi = useMemo(() => (seciliArac?.sayac_tipi ?? "km") as "km" | "saat", [seciliArac]);
  const seciliAracGuncelKm = seciliArac?.guncel_gosterge ?? null;

  // Araç seçildiğinde mevcut km'yi araclar.guncel_gosterge'den otomatik doldur
  // (yalnızca yeni kayıt için — düzenlemede mevcut km'yi bozma)
  useEffect(() => {
    if (!editId && seciliArac && seciliAracGuncelKm != null) {
      setDKm(String(seciliAracGuncelKm));
    }
  }, [dAracId, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sonraki bakım km durumu: geçti / yaklaştı / normal (yalnızca bakım)
  const sonrakiKmDurum = useMemo(() => {
    if (dTip !== "bakim") return "normal" as const;
    const sonraki = dSonrakiKm ? parseInt(dSonrakiKm.replace(/\D/g, ""), 10) : null;
    const guncel = seciliAracGuncelKm;
    if (sonraki == null || guncel == null) return "normal" as const;
    if (guncel >= sonraki) return "gecti" as const;
    if (sonraki - guncel <= 500) return "yaklasti" as const;
    return "normal" as const;
  }, [dTip, dSonrakiKm, seciliAracGuncelKm]);

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

  // Bakım tarihi değiştiğinde otomatik: sonraki bakım tarihi = 1 yıl sonrası
  useEffect(() => {
    if (dTarih && !dSonrakiTarih) {
      setDSonrakiTarih(birYilSonra(dTarih));
    }
  }, [dTarih]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtrelenmiş liste
  const filtrelenmis = useMemo(() => {
    const q = arama.trim().toLowerCase();
    return bakimlar.filter((b) => {
      if (filtreArac && b.arac_id !== filtreArac) return false;
      if (filtreTip && (b.tip ?? "bakim") !== filtreTip) return false;
      if (filtreBaslangic && b.bakim_tarihi < filtreBaslangic) return false;
      if (filtreBitis && b.bakim_tarihi > filtreBitis) return false;
      if (q) {
        const text = [
          b.araclar?.plaka,
          b.araclar?.marka,
          b.araclar?.model,
          b.yaptiran_ad,
          b.servis_tamirci,
          b.detay,
          b.tutar != null ? String(b.tutar) : null,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [bakimlar, filtreArac, filtreTip, filtreBaslangic, filtreBitis, arama]);

  // Özet
  const ozet = useMemo(() => {
    const toplamTutar = filtrelenmis.reduce((s, b) => s + (b.tutar ?? 0), 0);
    return { sayi: filtrelenmis.length, toplamTutar };
  }, [filtrelenmis]);

  function dialogAc(tip: AracBakimTipi = "bakim") {
    setEditId(null);
    setDTip(tip);
    setDAracId("");
    setDTarih(new Date().toISOString().slice(0, 10));
    setDYaptiranId("");
    setDServisTamirci("");
    setDTutar(""); setDKm(""); setDDetay("");
    setDSonrakiKm(""); setDSonrakiTarih("");
    setDFaturaYeni([]); setDFaturaMevcut([]);
    setDIsFotoYeni([]); setDIsFotoMevcut([]);
    setDAracAra(""); setDAracAcik(false);
    setDialogOpen(true);
  }

  function dialogDuzenleAc(b: AracBakimWithArac) {
    setEditId(b.id);
    setDTip((b.tip ?? "bakim") as AracBakimTipi);
    setDAracId(b.arac_id);
    setDTarih(b.bakim_tarihi);
    setDYaptiranId(b.yaptiran_id ?? "");
    setDServisTamirci(b.servis_tamirci ?? "");
    setDTutar(b.tutar != null ? formatParaInput(b.tutar.toFixed(2).replace(".", ",")) : "");
    setDKm(b.km != null ? String(b.km) : "");
    setDDetay(b.detay ?? "");
    setDSonrakiKm(b.sonraki_bakim_km != null ? String(b.sonraki_bakim_km) : "");
    setDSonrakiTarih(b.sonraki_bakim_tarihi ?? "");
    setDFaturaYeni([]);
    const mevcutFatura: string[] = Array.isArray(b.fatura_urls) && b.fatura_urls.length > 0
      ? b.fatura_urls
      : (b.fatura_url ? [b.fatura_url] : []);
    setDFaturaMevcut(mevcutFatura);
    setDIsFotoYeni([]);
    setDIsFotoMevcut(Array.isArray(b.is_foto_urls) ? b.is_foto_urls : []);
    setDAracAra(""); setDAracAcik(false);
    setDialogOpen(true);
  }

  async function kaydet() {
    if (!dAracId) { toast.error("Araç seçin."); return; }
    if (!dTarih) { toast.error("Tarih girin."); return; }
    if (!dDetay.trim()) { toast.error("Yapılan işin detayı zorunludur."); return; }
    const tutar = dTutar ? parseParaInput(dTutar) : null;
    const km = dKm ? parseInt(dKm.replace(/\D/g, ""), 10) : null;
    // Tamirat ise sonraki bakım alanları kaydedilmez
    const sonrakiKm = dTip === "bakim" && dSonrakiKm ? parseInt(dSonrakiKm.replace(/\D/g, ""), 10) : null;
    const sonrakiTarih = dTip === "bakim" ? (dSonrakiTarih || null) : null;
    const etiket = dTip === "tamirat" ? "Tamirat" : "Bakım";

    setDialogLoading(true);
    try {
      if (editId) {
        await updateAracBakim(editId, {
          arac_id: dAracId,
          tip: dTip,
          bakim_tarihi: dTarih,
          yaptiran_id: dYaptiranId || null,
          yaptiran_adi: null,
          servis_tamirci: dServisTamirci.trim() || null,
          tutar,
          km,
          detay: dDetay.trim() || null,
          sonraki_bakim_km: sonrakiKm,
          sonraki_bakim_tarihi: sonrakiTarih,
        });
        // Fatura dosyaları
        const faturaYeniUrl = dFaturaYeni.length > 0
          ? await uploadBakimDosyalar(dFaturaYeni, editId, "fatura")
          : [];
        const tumFatura = [...dFaturaMevcut, ...faturaYeniUrl];
        // İş foto/PDF dosyaları
        const isFotoYeniUrl = dIsFotoYeni.length > 0
          ? await uploadBakimDosyalar(dIsFotoYeni, editId, "is-foto")
          : [];
        const tumIsFoto = [...dIsFotoMevcut, ...isFotoYeniUrl];
        await updateAracBakim(editId, {
          fatura_urls: tumFatura,
          fatura_url: tumFatura[0] ?? null,
          is_foto_urls: tumIsFoto,
        });
        toast.success(`${etiket} kaydı güncellendi.`);
      } else {
        const result = await insertAracBakim({
          arac_id: dAracId,
          tip: dTip,
          bakim_tarihi: dTarih,
          yaptiran_id: dYaptiranId || null,
          yaptiran_adi: null,
          servis_tamirci: dServisTamirci.trim() || null,
          tutar,
          km,
          detay: dDetay.trim() || null,
          sonraki_bakim_km: sonrakiKm,
          sonraki_bakim_tarihi: sonrakiTarih,
          fatura_url: null,
          fatura_urls: [],
          is_foto_urls: [],
          created_by: kullanici?.id ?? null,
        });
        if (result.id && (dFaturaYeni.length > 0 || dIsFotoYeni.length > 0)) {
          const faturaUrls = dFaturaYeni.length > 0
            ? await uploadBakimDosyalar(dFaturaYeni, result.id, "fatura")
            : [];
          const isFotoUrls = dIsFotoYeni.length > 0
            ? await uploadBakimDosyalar(dIsFotoYeni, result.id, "is-foto")
            : [];
          await updateAracBakim(result.id, {
            fatura_urls: faturaUrls,
            fatura_url: faturaUrls[0] ?? null,
            is_foto_urls: isFotoUrls,
          });
        }
        toast.success(`${etiket} kaydı eklendi.`);
      }
      await loadAll();
      setDialogOpen(false);
    } catch (err) {
      console.error("Bakım kaydet hatası:", err);
      toast.error(`Hata: ${hataMesaji(err)}`, { duration: 8000 });
    } finally {
      setDialogLoading(false);
    }
  }

  async function kayitSil() {
    if (!silOnay) return;
    try {
      await deleteAracBakim(silOnay);
      setSilOnay(null);
      await loadAll();
      toast.success("Silindi.");
    } catch (err) {
      console.error("Silme hatası:", err);
      toast.error(`Hata: ${hataMesaji(err)}`, { duration: 8000 });
    }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(
      filtreTip === "bakim" ? "Arac Bakim Listesi" :
      filtreTip === "tamirat" ? "Arac Tamirat Listesi" :
      "Arac Bakim & Tamirat Listesi",
      14, 15,
    );
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")} | Toplam: ${filtrelenmis.length} kayit | Toplam tutar: ${formatSayi(ozet.toplamTutar)} TL`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Tarih", "Tip", "Plaka", "Marka/Model", "Yaptiran", "Islemi Giren", "Km", "Servis/Tamirci", "Detay", "Tutar (TL)", "Bakim Yapilacak"]],
      body: filtrelenmis.map((b) => [
        tr(formatTarih(b.bakim_tarihi)),
        (b.tip ?? "bakim") === "tamirat" ? "Tamirat" : "Bakim",
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
    const headers = ["Tarih", "Tip", "Plaka", "Marka", "Model", "Yaptıran", "İşlemi Giren", "Km/Saat", "Servis/Tamirci", "Detay", "Tutar (TL)", "Bakım Yapılacak Km", "Bakım Yapılacak Tarih", "Fatura URL'leri", "İş Foto/PDF URL'leri"];
    const data = filtrelenmis.map((b) => {
      const faturaDosyalar = Array.isArray(b.fatura_urls) && b.fatura_urls.length > 0
        ? b.fatura_urls
        : (b.fatura_url ? [b.fatura_url] : []);
      const isFotoDosyalar = Array.isArray(b.is_foto_urls) ? b.is_foto_urls : [];
      return [
        formatTarih(b.bakim_tarihi),
        (b.tip ?? "bakim") === "tamirat" ? "Tamirat" : "Bakım",
        b.araclar?.plaka ?? "",
        b.araclar?.marka ?? "",
        b.araclar?.model ?? "",
        b.yaptiran_ad ?? "",
        b.isleme_giren_ad ?? "",
        b.km ?? "",
        b.servis_tamirci ?? "",
        b.detay ?? "",
        b.tutar ?? "",
        b.sonraki_bakim_km ?? "",
        formatTarih(b.sonraki_bakim_tarihi),
        faturaDosyalar.join(" | "),
        isFotoDosyalar.join(" | "),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 40 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 50 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Araç Bakım");
    XLSX.writeFile(wb, "arac-bakim-listesi.xlsx");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Wrench size={24} /> Araç Bakım & Tamirat
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={14} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={14} className="mr-1" /> Excel
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => dialogAc("bakim")}>
            <Plus size={14} className="mr-1" /> Yeni Bakım
          </Button>
          <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={() => dialogAc("tamirat")}>
            <Plus size={14} className="mr-1" /> Yeni Tamirat
          </Button>
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
        <div className="ml-auto text-xs text-gray-600">
          <div>Kayıt: <strong>{ozet.sayi}</strong></div>
          <div>Toplam: <strong className="text-[#1E3A5F]">{formatSayi(ozet.toplamTutar)} TL</strong></div>
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
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">Tarih</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Tip</TableHead>
                <TableHead className="text-white text-[11px] px-2">Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Marka/Model</TableHead>
                <TableHead className="text-white text-[11px] px-2">Yaptıran</TableHead>
                <TableHead className="text-white text-[11px] px-2">İşlemi Giren</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Km/Saat</TableHead>
                <TableHead className="text-white text-[11px] px-2">Servis/Tamirci</TableHead>
                <TableHead className="text-white text-[11px] px-2">Detay</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Tutar</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Bakım Yapılacak</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Fatura</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">İş Foto/PDF</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center w-[70px]">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((b) => (
                <TableRow key={b.id} className="text-xs hover:bg-gray-50">
                  <TableCell className="px-2 whitespace-nowrap">{formatTarih(b.bakim_tarihi)}</TableCell>
                  <TableCell className="px-2 text-center">
                    {(b.tip ?? "bakim") === "tamirat" ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">Tamirat</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">Bakım</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 font-bold text-[#1E3A5F] whitespace-nowrap">{b.araclar?.plaka ?? "—"}</TableCell>
                  <TableCell className="px-2 truncate max-w-[140px]">{[b.araclar?.marka, b.araclar?.model].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="px-2">{b.yaptiran_ad ?? "—"}</TableCell>
                  <TableCell className="px-2 text-gray-500 text-[11px]">{b.isleme_giren_ad ?? "—"}</TableCell>
                  <TableCell className="px-2 text-right tabular-nums">{b.km != null ? b.km.toLocaleString("tr-TR") : "—"}</TableCell>
                  <TableCell className="px-2 truncate max-w-[160px]" title={b.servis_tamirci ?? ""}>{b.servis_tamirci ?? "—"}</TableCell>
                  <TableCell className="px-2 truncate max-w-[220px]" title={b.detay ?? ""}>{b.detay ?? "—"}</TableCell>
                  <TableCell className="px-2 text-right font-semibold">{formatSayi(b.tutar)}</TableCell>
                  <TableCell className="px-2 text-center text-[10px]">
                    {b.sonraki_bakim_km != null && <div>{b.sonraki_bakim_km.toLocaleString("tr-TR")} km</div>}
                    {b.sonraki_bakim_tarihi && <div>{formatTarih(b.sonraki_bakim_tarihi)}</div>}
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    {(() => {
                      const dosyalar = Array.isArray(b.fatura_urls) && b.fatura_urls.length > 0
                        ? b.fatura_urls
                        : (b.fatura_url ? [b.fatura_url] : []);
                      if (dosyalar.length === 0) return <span className="text-gray-300">—</span>;
                      return (
                        <div className="flex items-center justify-center flex-wrap gap-1">
                          {dosyalar.map((u, i) => (
                            <button
                              type="button"
                              key={`fat-${i}`}
                              onClick={() => setLightboxUrl(u)}
                              className="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 text-[10px] font-semibold cursor-pointer"
                              title={dosyaAd(u)}
                            >
                              {i + 1}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    {(() => {
                      const dosyalar = Array.isArray(b.is_foto_urls) ? b.is_foto_urls : [];
                      if (dosyalar.length === 0) return <span className="text-gray-300">—</span>;
                      return (
                        <div className="flex items-center justify-center flex-wrap gap-1">
                          {dosyalar.map((u, i) => (
                            <button
                              type="button"
                              key={`isf-${i}`}
                              onClick={() => setLightboxUrl(u)}
                              className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 text-[10px] font-semibold cursor-pointer"
                              title={dosyaAd(u)}
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
                      <button type="button" onClick={() => dialogDuzenleAc(b)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                      <button type="button" onClick={() => setSilOnay(b.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
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
          className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center animate-in fade-in duration-150"
          onClick={() => setLightboxUrl(null)}
        >
          {/* Üst kontroller */}
          <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
            {resimMi(lightboxUrl) && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxZoom((z) => Math.max(0.25, z - 0.25)); }}
                  className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-white"
                  title="Küçült (-)"
                >−</button>
                <span className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-sm font-medium min-w-[60px] text-center">
                  {Math.round(lightboxZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxZoom((z) => Math.min(4, z + 0.25)); }}
                  className="bg-white/95 text-black rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-white"
                  title="Büyüt (+)"
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
              href={lightboxUrl}
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
            {dosyaAd(lightboxUrl)} — Kapatmak için boşluğa tıkla veya Esc
          </div>

          {/* İçerik */}
          <div
            className="max-w-[92vw] max-h-[92vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {resimMi(lightboxUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lightboxUrl}
                alt=""
                style={{ transform: `scale(${lightboxZoom})`, transformOrigin: "center center", transition: "transform 120ms" }}
                className="max-w-[92vw] max-h-[92vh] object-contain select-none"
                draggable={false}
              />
            ) : pdfMi(lightboxUrl) ? (
              <iframe
                src={lightboxUrl}
                className="w-[92vw] h-[92vh] bg-white rounded-lg shadow-xl border-0"
                title="PDF önizleme"
              />
            ) : (
              <div className="bg-white p-8 rounded-lg shadow-xl text-center">
                <p className="text-gray-600 mb-3">Bu dosya tipi önizlenemiyor.</p>
                <a
                  href={lightboxUrl}
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

      {/* Bakım ekle/düzenle dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editId
                ? (dTip === "tamirat" ? "Tamirat Kaydını Düzenle" : "Bakım Kaydını Düzenle")
                : (dTip === "tamirat" ? "Yeni Tamirat Kaydı" : "Yeni Bakım Kaydı")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Araç <span className="text-red-500">*</span></Label>
                {(() => {
                  const aktifAraclar = ozMalAraclar.filter((a) => (a.durum ?? "aktif") === "aktif");
                  const q = dAracAra.trim().toLowerCase();
                  const filtrelenmisAraclar = q
                    ? aktifAraclar.filter((a) => {
                        const t = [a.plaka, a.marka, a.model, a.cinsi].filter(Boolean).join(" ").toLowerCase();
                        return t.includes(q);
                      })
                    : aktifAraclar;
                  const seciliArac = aktifAraclar.find((a) => a.id === dAracId);
                  return (
                    <div className="relative">
                      {/* Kapalı durumda görünen buton — seçili aracı gösterir, tıklayınca açılır */}
                      <button
                        type="button"
                        onClick={() => setDAracAcik((v) => !v)}
                        className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 flex items-center justify-between gap-2 text-left"
                      >
                        <span className={seciliArac ? "text-gray-900 truncate" : "text-gray-400"}>
                          {seciliArac
                            ? `${seciliArac.plaka} ${[seciliArac.marka, seciliArac.model].filter(Boolean).join(" ")}`
                            : "Araç seçiniz veya arayın..."}
                        </span>
                        <span className="text-gray-400 text-xs flex-shrink-0">{dAracAcik ? "▲" : "▼"}</span>
                      </button>

                      {/* Açıldığında backdrop + popover */}
                      {dAracAcik && (
                        <>
                          {/* Dışarı tıklayınca kapat */}
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => { setDAracAcik(false); setDAracAra(""); }}
                          />
                          <div className="absolute left-0 right-0 top-full mt-1 z-[61] bg-white border border-input rounded-lg shadow-lg">
                            <div className="relative p-2 border-b">
                              <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                              <input
                                type="text"
                                autoFocus
                                value={dAracAra}
                                onChange={(e) => setDAracAra(e.target.value)}
                                placeholder="Plaka, marka veya cins ile ara..."
                                className="h-8 w-full rounded border border-gray-200 bg-white pl-7 pr-8 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                              />
                              {dAracAra && (
                                <button
                                  type="button"
                                  onClick={() => setDAracAra("")}
                                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs"
                                >✕</button>
                              )}
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                              {filtrelenmisAraclar.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-gray-400 text-center">Eşleşen araç yok</div>
                              ) : (
                                filtrelenmisAraclar.map((a) => (
                                  <button
                                    type="button"
                                    key={a.id}
                                    onClick={() => {
                                      setDAracId(a.id);
                                      setDAracAcik(false);
                                      setDAracAra("");
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-xs border-b last:border-b-0 hover:bg-blue-50 ${
                                      dAracId === a.id ? "bg-blue-100 font-semibold text-blue-900" : ""
                                    }`}
                                  >
                                    <span className="font-bold text-[#1E3A5F]">{a.plaka}</span>
                                    {" "}
                                    <span className="text-gray-600">{[a.marka, a.model].filter(Boolean).join(" ")}</span>
                                    {a.cinsi && <span className="text-gray-400 text-[10px] ml-1">({a.cinsi})</span>}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{dTip === "tamirat" ? "Tamirat" : "Bakım"} Tarihi <span className="text-red-500">*</span></Label>
                <input type="date" value={dTarih} onChange={(e) => setDTarih(e.target.value)} className={selectClass + " w-full"} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Yaptıran (Personel)</Label>
                <select value={dYaptiranId} onChange={(e) => setDYaptiranId(e.target.value)} className={selectClass + " w-full"}>
                  <option value="">Seçiniz</option>
                  {personeller
                    .filter((p) => (p.durum ?? "aktif") === "aktif")
                    .slice()
                    .sort((a, b) => (a.ad_soyad ?? "").localeCompare(b.ad_soyad ?? "", "tr"))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.ad_soyad}</option>
                    ))}
                </select>
                <p className="text-[9px] text-gray-400">
                  İşi fiilen yaptıran personel. Kaydı giren kullanıcı: <strong>{kullanici?.ad_soyad ?? "—"}</strong>
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tutar (TL)</Label>
                <input
                  type="text" inputMode="decimal"
                  value={dTutar}
                  onChange={(e) => setDTutar(formatParaInput(e.target.value))}
                  placeholder="0,00"
                  className={selectClass + " w-full"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Mevcut Km / Saat</Label>
                <input
                  type="text" inputMode="numeric"
                  value={dKm}
                  onChange={(e) => setDKm(e.target.value.replace(/\D/g, ""))}
                  placeholder="Örn: 120000"
                  className={selectClass + " w-full"}
                />
                <p className="text-[9px] text-gray-400">
                  Bu araç: {seciliAracSayacTipi === "saat" ? "Saat" : "Km"}
                  {seciliAracGuncelKm != null && (
                    <> — araç güncel: <strong>{seciliAracGuncelKm.toLocaleString("tr-TR")}</strong></>
                  )}
                </p>
              </div>
              {dTip === "bakim" && (
                <div className="space-y-1">
                  <Label className="text-xs">Bakım Yapılacak Km / Saat</Label>
                  <input
                    type="text" inputMode="numeric"
                    value={dSonrakiKm}
                    onChange={(e) => setDSonrakiKm(e.target.value.replace(/\D/g, ""))}
                    placeholder="Örn: 130000"
                    className={
                      "h-9 rounded-lg border px-3 text-sm outline-none focus:ring-2 w-full " +
                      (sonrakiKmDurum === "gecti"
                        ? "border-red-500 bg-red-50 text-red-700 font-semibold focus:ring-red-300"
                        : sonrakiKmDurum === "yaklasti"
                        ? "border-amber-500 bg-amber-50 text-amber-800 focus:ring-amber-300"
                        : "border-input bg-white focus:border-ring focus:ring-ring/50")
                    }
                  />
                  {sonrakiKmDurum === "gecti" && seciliAracGuncelKm != null && (
                    <p className="text-[10px] text-red-600 font-semibold">
                      ⚠ Bakım tarihi GEÇTİ — araç {(seciliAracGuncelKm - parseInt(dSonrakiKm.replace(/\D/g, ""), 10)).toLocaleString("tr-TR")} {seciliAracSayacTipi === "saat" ? "saat" : "km"} daha gitmiş
                    </p>
                  )}
                  {sonrakiKmDurum === "yaklasti" && seciliAracGuncelKm != null && (
                    <p className="text-[10px] text-amber-700 font-semibold">
                      ⚠ Bakıma yaklaştı — sadece {(parseInt(dSonrakiKm.replace(/\D/g, ""), 10) - seciliAracGuncelKm).toLocaleString("tr-TR")} {seciliAracSayacTipi === "saat" ? "saat" : "km"} kaldı
                    </p>
                  )}
                </div>
              )}
            </div>

            {dTip === "bakim" && (
              <div className="space-y-1">
                <Label className="text-xs">Bakım Yapılacak Tarih</Label>
                <input type="date" value={dSonrakiTarih} onChange={(e) => setDSonrakiTarih(e.target.value)} className={selectClass + " w-full"} />
                <p className="text-[9px] text-gray-400">
                  Bakım tarihi seçildiğinde otomatik olarak 1 yıl sonrası atanır.
                  Km dolmadıysa bu tarihte bakım yapılacaktır.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Servis / Tamirci</Label>
              <input
                type="text"
                list="servis-tamirci-oneri"
                value={dServisTamirci}
                onChange={(e) => setDServisTamirci(e.target.value)}
                placeholder="Örn: Oto Yunus, Özkan Lastik, Kamil Usta..."
                className={selectClass + " w-full"}
              />
              <datalist id="servis-tamirci-oneri">
                {servisTamirciOnerileri.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <p className="text-[9px] text-gray-400">Bakım/tamiratı yaptıran dış servis veya tamirci.</p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Yapılan İşin Detayı <span className="text-red-500">*</span></Label>
              <Textarea
                value={dDetay}
                onChange={(e) => setDDetay(e.target.value)}
                placeholder="Yağ değişimi, balata, lastik rotasyonu, fren kontrolü..."
                rows={3}
                className="text-sm"
              />
            </div>

            {/* FATURA dosyaları */}
            <div className="space-y-1 bg-blue-50/30 border border-blue-200 rounded-lg p-2">
              <Label className="text-xs font-semibold text-blue-800">📄 Fatura / Makbuz (PDF, JPG, PNG)</Label>
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                onChange={(e) => {
                  const liste = e.target.files ? Array.from(e.target.files) : [];
                  setDFaturaYeni((prev) => [...prev, ...liste]);
                  e.target.value = "";
                }}
                className="w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-blue-600 file:text-white"
              />

              {dFaturaMevcut.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-gray-500 font-semibold">Mevcut ({dFaturaMevcut.length})</p>
                  {dFaturaMevcut.map((u, i) => (
                    <div key={`fat-mev-${i}`} className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded px-2 py-1">
                      <a href={u} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 truncate">
                        <Download size={11} /> {dosyaAd(u)}
                      </a>
                      <button type="button" onClick={() => setDFaturaMevcut((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {dFaturaYeni.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-emerald-700 font-semibold">Kaydedince yüklenecek ({dFaturaYeni.length})</p>
                  {dFaturaYeni.map((f, i) => (
                    <div key={`fat-yeni-${i}`} className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                      <span className="text-[11px] text-emerald-800 truncate">+ {f.name} <span className="text-gray-500">({(f.size / 1024).toFixed(0)} KB)</span></span>
                      <button type="button" onClick={() => setDFaturaYeni((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* YAPILAN İŞ — foto / PDF */}
            <div className="space-y-1 bg-amber-50/30 border border-amber-200 rounded-lg p-2">
              <Label className="text-xs font-semibold text-amber-800">🔧 Yapılan İşle İlgili Foto / PDF (parça, hasar, rapor vb.)</Label>
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                onChange={(e) => {
                  const liste = e.target.files ? Array.from(e.target.files) : [];
                  setDIsFotoYeni((prev) => [...prev, ...liste]);
                  e.target.value = "";
                }}
                className="w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-amber-600 file:text-white"
              />

              {dIsFotoMevcut.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-gray-500 font-semibold">Mevcut ({dIsFotoMevcut.length})</p>
                  {dIsFotoMevcut.map((u, i) => (
                    <div key={`isf-mev-${i}`} className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded px-2 py-1">
                      <a href={u} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-700 hover:underline flex items-center gap-1 truncate">
                        <Download size={11} /> {dosyaAd(u)}
                      </a>
                      <button type="button" onClick={() => setDIsFotoMevcut((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {dIsFotoYeni.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-emerald-700 font-semibold">Kaydedince yüklenecek ({dIsFotoYeni.length})</p>
                  {dIsFotoYeni.map((f, i) => (
                    <div key={`isf-yeni-${i}`} className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                      <span className="text-[11px] text-emerald-800 truncate">+ {f.name} <span className="text-gray-500">({(f.size / 1024).toFixed(0)} KB)</span></span>
                      <button type="button" onClick={() => setDIsFotoYeni((arr) => arr.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 text-[10px] px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={dialogLoading}>İptal</Button>
              <Button
                className={dTip === "tamirat" ? "bg-orange-600 hover:bg-orange-700 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
                onClick={kaydet}
                disabled={dialogLoading}
              >
                {dialogLoading ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
