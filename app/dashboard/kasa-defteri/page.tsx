// Kasa Defteri — personel harcama takibi
// Nakit gelir/gider bakiyeyi etkiler, kart harcamaları sadece kayıt olarak görünür
"use client";

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
// Artık personel yerine kullanıcılar gösteriliyor
import { getSantiyelerBasic, getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import {
  getKasaHareketleri,
  insertKasaHareketi,
  updateKasaHareketi,
  deleteKasaHareketi,
  uploadSlip,
} from "@/lib/supabase/queries/kasa";
import { useAuth } from "@/hooks";
import type { KasaHareketi } from "@/lib/supabase/types";
type KasaKullanici = { id: string; ad_soyad: string; aktif?: boolean };
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Wallet, FileDown, FileSpreadsheet, Plus, Trash2, Search, Pencil,
  ArrowUpCircle, ArrowDownCircle, CreditCard, Banknote, ImageIcon,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { tarihIzinliMi } from "@/lib/utils/tarih-izin";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { filtreliSantiyeler, otomatikSantiyeId } from "@/lib/utils/santiye-filtre";

type SantiyeBasic = { id: string; is_adi: string; durum: string; gecici_kabul_tarihi?: string | null; kesin_kabul_tarihi?: string | null; tasfiye_tarihi?: string | null; devir_tarihi?: string | null };
const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

const AY_ADLARI = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

function otomatikGelirAciklama(tarih: string): string {
  const d = new Date(tarih + "T00:00:00");
  const ay = AY_ADLARI[d.getMonth()] ?? "";
  return `${ay} Ayı Şantiye Harcaması İçin Verilen`;
}

function formatSayi(n: number, digits = 2): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatTL(n: number): string { return formatSayi(n) + " TL"; }
function tr(s: string): string {
  return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
    .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
    .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
}

export default function KasamuDefPage() {
  return <Suspense fallback={<div className="text-center py-16 text-gray-500">Yükleniyor...</div>}><KasaDefContent /></Suspense>;
}

function KasaDefContent() {
  const searchParams = useSearchParams();
  const { kullanici, isYonetici } = useAuth();

  const [loading, setLoading] = useState(true);
  const [personeller, setPersoneller] = useState<KasaKullanici[]>([]);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [kategoriler, setKategoriler] = useState<string[]>([]);
  const [hareketler, setHareketler] = useState<KasaHareketi[]>([]);
  const [kullaniciMap, setKullaniciMap] = useState<Map<string, string>>(new Map());

  // Filtreler
  const bugun = new Date();
  const [filtreSantiye, setFiltreSantiye] = useState("");
  const [filtrePersonel, setFiltrePersonel] = useState(() => searchParams.get("personel") ?? "");
  const [filtreOdeme, setFiltreOdeme] = useState<"" | "nakit" | "kart">("");
  const [filtreBaslangic, setFiltreBaslangic] = useState(() => {
    const y = bugun.getFullYear(); const m = bugun.getMonth() + 1;
    return `${y}-${String(m).padStart(2,"0")}-01`;
  });
  const [filtreBitis, setFiltreBitis] = useState(() => {
    const y = bugun.getFullYear(); const m = bugun.getMonth() + 1;
    const son = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2,"0")}-${String(son).padStart(2,"0")}`;
  });
  const [arama, setArama] = useState("");

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [dPersonel, setDPersonel] = useState("");
  const [dSantiye, setDSantiye] = useState("");
  const [dTarih, setDTarih] = useState("");
  const [dTip, setDTip] = useState<"gelir" | "gider">("gider");
  const [dOdeme, setDOdeme] = useState<"nakit" | "kart">("nakit");
  const [dKategori, setDKategori] = useState("");
  const [dTutar, setDTutar] = useState("");
  const [dAciklama, setDAciklama] = useState("");
  const [dSlipFile, setDSlipFile] = useState<File | null>(null);
  const [dialogLoading, setDialogLoading] = useState(false);

  // Silme onayı
  const [silOnay, setSilOnay] = useState<string | null>(null);

  // Slip görüntüleme
  const [slipGoster, setSlipGoster] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sData, katData, hData, kResp] = await Promise.all([
        getSantiyelerAll(),
        getDegerler("kasa_harcama_kategori").catch(() => []),
        getKasaHareketleri().catch(() => []),
        fetch("/api/kullanicilar/adlar").then((r) => r.ok ? r.json() : []).catch(() => []),
      ]);
      const kullaniciListesi = ((kResp as { id: string; ad_soyad: string; aktif?: boolean }[]) ?? [])
        .map((k) => ({ id: k.id, ad_soyad: k.ad_soyad, aktif: k.aktif !== false }));
      setPersoneller(kullaniciListesi);
      setSantiyeler((sData as SantiyeBasic[]) ?? []);
      setKategoriler(katData);
      setHareketler(hData);

      // Otomatik şantiye seçimi
      const otoId = otomatikSantiyeId(sData as SantiyeBasic[], kullanici);
      if (otoId) setFiltreSantiye(otoId);

      // Kullanıcı adları
      const map = new Map<string, string>();
      if (kullanici) map.set(kullanici.id, kullanici.ad_soyad);
      try {
        const res = await fetch("/api/kullanicilar/adlar");
        if (res.ok) {
          for (const k of (await res.json()) as { id: string; ad_soyad: string }[]) {
            map.set(k.id, k.ad_soyad);
          }
        }
      } catch { /* sessiz */ }
      setKullaniciMap(map);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("kasa_hareketi tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 10000 });
      }
    } finally {
      setLoading(false);
    }
  }, [kullanici]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Map'ler
  const personelMap = useMemo(() => {
    const m = new Map<string, KasaKullanici>();
    for (const p of personeller) m.set(p.id, p);
    return m;
  }, [personeller]);
  const santiyeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of santiyeler) m.set(s.id, s.is_adi);
    return m;
  }, [santiyeler]);

  // Kümülatif bakiye (personel bazlı, sadece nakit)
  const bakiyeMap = useMemo(() => {
    const result = new Map<string, number>();
    const sorted = [...hareketler].sort((a, b) => `${a.tarih}${a.created_at}`.localeCompare(`${b.tarih}${b.created_at}`));
    const cum = new Map<string, number>();
    for (const h of sorted) {
      if (h.odeme_yontemi === "nakit") {
        const prev = cum.get(h.personel_id) ?? 0;
        const yeni = h.tip === "gelir" ? prev + h.tutar : prev - h.tutar;
        cum.set(h.personel_id, yeni);
      }
      result.set(`${h.personel_id}|${h.id}`, cum.get(h.personel_id) ?? 0);
    }
    return result;
  }, [hareketler]);

  // Filtrelenmiş satırlar — şantiye veya personel seçilmeden boş göster
  const filtrelenmis = useMemo(() => {
    // Yönetici: şantiye veya personel seçilmeden veri gösterme
    if (isYonetici && !filtreSantiye && !filtrePersonel) return [];

    const q = arama.trim().toLowerCase();
    return hareketler.filter((h) => {
      // Kısıtlı kullanıcı
      if (!isYonetici && kullanici) {
        // Kısıtlı kullanıcı sadece kendi personel_id'si olan kayıtları görür
        if (h.personel_id !== kullanici.id) return false;
        if (!tarihIzinliMi(kullanici, h.tarih)) return false;
      }
      // Tarih
      if (isYonetici && (h.tarih < filtreBaslangic || h.tarih > filtreBitis)) return false;
      // Şantiye
      if (filtreSantiye && h.santiye_id !== filtreSantiye) return false;
      // Personel
      if (filtrePersonel && h.personel_id !== filtrePersonel) return false;
      // Ödeme
      if (filtreOdeme && h.odeme_yontemi !== filtreOdeme) return false;
      // Arama
      if (q) {
        const text = [
          personelMap.get(h.personel_id)?.ad_soyad,
          santiyeMap.get(h.santiye_id),
          h.kategori, h.aciklama,
          String(h.tutar),
          formatSayi(h.tutar),
          h.tarih ? h.tarih.split("-").reverse().join(".") : null,
          h.tip === "gelir" ? "gelir" : "gider",
          h.odeme_yontemi,
          h.created_by ? kullaniciMap.get(h.created_by) : null,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => `${b.tarih}${b.created_at}`.localeCompare(`${a.tarih}${a.created_at}`));
  }, [hareketler, filtreSantiye, filtrePersonel, filtreOdeme, filtreBaslangic, filtreBitis, arama, isYonetici, kullanici, personelMap, santiyeMap, kullaniciMap]);

  // Özet
  const ozet = useMemo(() => {
    let toplamGelir = 0, toplamGiderNakit = 0, toplamGiderKart = 0;
    for (const h of filtrelenmis) {
      if (h.tip === "gelir") toplamGelir += h.tutar;
      else if (h.odeme_yontemi === "nakit") toplamGiderNakit += h.tutar;
      else toplamGiderKart += h.tutar;
    }
    return { toplamGelir, toplamGiderNakit, toplamGiderKart, nakitBakiye: toplamGelir - toplamGiderNakit };
  }, [filtrelenmis]);

  // Devreden bakiye — dönem başlangıcından önceki nakit hareketlerin toplamı
  const devredenBakiye = useMemo(() => {
    let bakiye = 0;
    for (const h of hareketler) {
      if (h.odeme_yontemi !== "nakit") continue;
      if (h.tarih >= filtreBaslangic) continue;
      // Şantiye filtresi
      if (filtreSantiye && h.santiye_id !== filtreSantiye) continue;
      // Personel filtresi
      if (filtrePersonel && h.personel_id !== filtrePersonel) continue;
      bakiye += h.tip === "gelir" ? h.tutar : -h.tutar;
    }
    return bakiye;
  }, [hareketler, filtreBaslangic, filtreSantiye, filtrePersonel]);

  // Dialog açma
  function dialogAc() {
    setEditId(null);
    // Kısıtlı kullanıcı ise otomatik olarak kendisi seçili
    setDPersonel(!isYonetici && kullanici ? kullanici.id : (filtrePersonel || ""));
    setDSantiye(filtreSantiye || "");
    const bugunStr = new Date().toISOString().slice(0, 10);
    setDTarih(bugunStr);
    setDTip("gider"); setDOdeme("nakit");
    setDKategori(""); setDTutar(""); setDAciklama(""); setDSlipFile(null);
    setDialogOpen(true);
  }
  function dialogDuzenleAc(h: KasaHareketi) {
    setEditId(h.id);
    setDPersonel(h.personel_id); setDSantiye(h.santiye_id);
    setDTarih(h.tarih); setDTip(h.tip); setDOdeme(h.odeme_yontemi);
    setDKategori(h.kategori ?? ""); setDTutar(String(h.tutar));
    setDAciklama(h.aciklama ?? ""); setDSlipFile(null);
    setDialogOpen(true);
  }

  async function kaydet() {
    if (!dPersonel) { toast.error("Kullanıcı seçin."); return; }
    if (!dSantiye) { toast.error("Şantiye seçin."); return; }
    if (!dTarih) { toast.error("Tarih girin."); return; }
    if (!tarihIzinliMi(kullanici, dTarih)) {
      toast.error(`Bu tarihe işlem yapamazsınız. Geriye dönük en fazla ${kullanici?.geriye_donus_gun ?? 0} gün.`);
      return;
    }
    const tutar = parseParaInput(dTutar);
    // Gelir: negatif tutar girilebilir (devir/eksi bakiye için)
    // Gider: sadece pozitif tutar
    if (tutar === 0) { toast.error("Geçerli tutar girin."); return; }
    if (dTip === "gider" && tutar < 0) { toast.error("Gider tutarı negatif olamaz."); return; }

    // Gider ise tüm alanlar zorunlu
    if (dTip === "gider") {
      if (!dKategori) { toast.error("Kategori seçin."); return; }
      if (!dAciklama.trim()) { toast.error("Açıklama girin."); return; }
    }

    // Gelir ise: ödeme otomatik nakit, kategori ve açıklama otomatik
    const finalOdeme = dTip === "gelir" ? "nakit" : dOdeme;
    const finalKategori = dTip === "gelir" ? "Tahsilat" : (dKategori || null);
    const finalAciklama = dTip === "gelir"
      ? (dAciklama.trim() ? `${otomatikGelirAciklama(dTarih)} — ${dAciklama.trim()}` : otomatikGelirAciklama(dTarih))
      : (dAciklama.trim() || null);

    setDialogLoading(true);
    try {
      let slipUrl: string | null = null;
      if (editId) {
        await updateKasaHareketi(editId, {
          personel_id: dPersonel, santiye_id: dSantiye, tarih: dTarih,
          tip: dTip, odeme_yontemi: finalOdeme, kategori: finalKategori,
          tutar, aciklama: finalAciklama, slip_url: null,
        });
        if (dSlipFile) {
          slipUrl = await uploadSlip(dSlipFile, editId);
          await updateKasaHareketi(editId, {
            personel_id: dPersonel, santiye_id: dSantiye, tarih: dTarih,
            tip: dTip, odeme_yontemi: finalOdeme, kategori: finalKategori,
            tutar, aciklama: finalAciklama, slip_url: slipUrl,
          });
        }
      } else {
        const result = await insertKasaHareketi({
          personel_id: dPersonel, santiye_id: dSantiye, tarih: dTarih,
          tip: dTip, odeme_yontemi: finalOdeme, kategori: finalKategori,
          tutar, aciklama: finalAciklama, slip_url: null,
          created_by: kullanici?.id ?? null,
        });
        if (dSlipFile && result.id) {
          slipUrl = await uploadSlip(dSlipFile, result.id);
          await updateKasaHareketi(result.id, {
            personel_id: dPersonel, santiye_id: dSantiye, tarih: dTarih,
            tip: dTip, odeme_yontemi: finalOdeme, kategori: finalKategori,
            tutar, aciklama: finalAciklama, slip_url: slipUrl,
          });
        }
      }
      await loadAll();
      toast.success(editId ? "İşlem güncellendi." : "İşlem eklendi.");
      setDialogOpen(false);
    } catch (err) {
      console.error("Kasa kaydetme hatası:", err);
      // Supabase hatası veya diğer hata objelerinden mesajı çek
      let msg = "Bilinmeyen hata";
      if (err instanceof Error) msg = err.message;
      else if (typeof err === "string") msg = err;
      else if (err && typeof err === "object") {
        const e = err as { message?: string; details?: string; hint?: string; code?: string };
        msg = e.message || e.details || e.hint || e.code || JSON.stringify(err);
      }
      if (msg.includes("does not exist")) {
        toast.error("kasa_hareketi tablosu yok. SQL çalıştırın.", { duration: 8000 });
      } else if (msg.includes("foreign key") || msg.includes("violates")) {
        toast.error("Seçilen kullanıcı/şantiye geçersiz. Muhtemelen kullanıcı silinmiş veya şantiye pasif.", { duration: 8000 });
      } else {
        toast.error(`Hata: ${msg}`, { duration: 6000 });
      }
    } finally { setDialogLoading(false); }
  }

  async function silOnayla() {
    if (!silOnay) return;
    try {
      await deleteKasaHareketi(silOnay);
      await loadAll();
      toast.success("İşlem silindi.");
      setSilOnay(null);
    } catch (err) {
      toast.error(`Silme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Export
  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Kasa Defteri", 14, 12);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    const pdfPersonel = filtrePersonel ? tr(personelMap.get(filtrePersonel)?.ad_soyad ?? "") : "Tum Kullanicilar";
    const pdfSantiye = filtreSantiye ? tr(santiyeMap.get(filtreSantiye) ?? "") : "Tum Santiyeler";
    doc.text(`${pdfPersonel} | ${pdfSantiye} | ${filtreBaslangic} - ${filtreBitis}`, 14, 17);
    let pdfStartY = 22;
    // Devreden bakiye varsa PDF'e yaz
    if (devredenBakiye !== 0) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text(`Onceki Donem Devreden Bakiye (Nakit): ${tr(formatTL(devredenBakiye))}`, 14, 22);
      doc.setFont("helvetica", "normal");
      pdfStartY = 27;
    }
    // Kişi bazlı gruplama + her kişinin altında toplam
    const kisiGrup = new Map<string, KasaHareketi[]>();
    for (const h of filtrelenmis) {
      const ad = personelMap.get(h.personel_id)?.ad_soyad ?? "Bilinmiyor";
      if (!kisiGrup.has(ad)) kisiGrup.set(ad, []);
      kisiGrup.get(ad)!.push(h);
    }

    const pdfBody: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = [];
    for (const [kisiAd, kayitlar] of Array.from(kisiGrup.entries()).sort(([a], [b]) => a.localeCompare(b, "tr"))) {
      let kisiGelir = 0, kisiGider = 0, sonBakiye: number | null = null;
      for (const h of kayitlar) {
        const isAvans = (h.kategori ?? "").toLowerCase().includes("avans");
        // Avans ise sarı arka plan + koyu renk
        const rowStyle = isAvans
          ? { fillColor: [254, 243, 199] as unknown as string, fontStyle: "bold" as const, textColor: [146, 64, 14] as unknown as string }
          : undefined;
        const wrap = (v: string) => rowStyle ? { content: v, styles: rowStyle } : v;
        pdfBody.push([
          wrap(h.tarih ? h.tarih.split("-").reverse().join(".") : "—"),
          wrap(tr(kisiAd)),
          wrap(tr(santiyeMap.get(h.santiye_id) ?? "—")),
          wrap((isAvans ? "[AVANS] " : "") + tr(h.aciklama ?? "—")),
          wrap(h.tip === "gelir" ? "Gelir" : "Gider"),
          wrap(h.odeme_yontemi === "nakit" ? "Nakit" : "Kart"),
          wrap(tr(h.kategori ?? "—")),
          wrap(h.tip === "gelir" ? "+" + formatSayi(h.tutar) : ""),
          wrap(h.tip === "gider" ? "-" + formatSayi(h.tutar) : ""),
          wrap(h.odeme_yontemi === "nakit" ? formatSayi(bakiyeMap.get(`${h.personel_id}|${h.id}`) ?? 0) : "-"),
        ]);
        if (h.tip === "gelir") kisiGelir += h.tutar;
        else kisiGider += h.tutar;
        // En güncel kümülatif bakiyeyi al (liste newest-first, ilk bulunan en güncel)
        if (sonBakiye === null && h.odeme_yontemi === "nakit") {
          sonBakiye = bakiyeMap.get(`${h.personel_id}|${h.id}`) ?? 0;
        }
      }
      // Kişi toplam satırı — bakiye: kümülatif son bakiye
      pdfBody.push([
        { content: "TOPLAM", colSpan: 7, styles: { halign: "right" as const, fontStyle: "bold" as const, fillColor: [230, 240, 250] as unknown as string } },
        { content: "+" + formatSayi(kisiGelir), styles: { fontStyle: "bold" as const, fillColor: [230, 240, 250] as unknown as string } },
        { content: "-" + formatSayi(kisiGider), styles: { fontStyle: "bold" as const, fillColor: [230, 240, 250] as unknown as string } },
        { content: formatSayi(sonBakiye ?? 0), styles: { fontStyle: "bold" as const, fillColor: [230, 240, 250] as unknown as string } },
      ]);
    }

    autoTable(doc, {
      startY: pdfStartY,
      head: [["Tarih", "Kullanici", "Santiye", "Aciklama", "Tip", "Odeme", "Kategori",
        { content: "Gelir", styles: { halign: "right" as const } },
        { content: "Gider", styles: { halign: "right" as const } },
        { content: "Bakiye", styles: { halign: "right" as const } },
      ]],
      body: pdfBody as string[][],
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      columnStyles: {
        7: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
      },
    });

    // Şantiye Bakiye Özet tablosu
    const santiyeOzet = new Map<string, { devreden: number; gelir: number; gider: number }>();
    // Devreden bakiye: dönem başlangıcından önceki nakit hareketler
    for (const h of hareketler) {
      if (h.odeme_yontemi !== "nakit") continue;
      const santiyeAdi = tr(santiyeMap.get(h.santiye_id) ?? "Diger");
      if (!santiyeOzet.has(santiyeAdi)) santiyeOzet.set(santiyeAdi, { devreden: 0, gelir: 0, gider: 0 });
      const item = santiyeOzet.get(santiyeAdi)!;
      if (h.tarih < filtreBaslangic) {
        // Devreden
        item.devreden += h.tip === "gelir" ? h.tutar : -h.tutar;
      } else if (h.tarih <= filtreBitis) {
        // Dönem
        if (h.tip === "gelir") item.gelir += h.tutar;
        else item.gider += h.tutar;
      }
    }

    const ozetSatirlar = Array.from(santiyeOzet.entries())
      .filter(([, v]) => v.devreden !== 0 || v.gelir !== 0 || v.gider !== 0)
      .sort(([a], [b]) => a.localeCompare(b, "tr"));

    if (ozetSatirlar.length > 0) {
      const ozetY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text("Santiye Bakiye Ozet", 14, ozetY);

      let genelDevreden = 0, genelGelir = 0, genelGider = 0;
      const ozetBody = ozetSatirlar.map(([santiye, v]) => {
        const sonBakiye = v.devreden + v.gelir - v.gider;
        genelDevreden += v.devreden;
        genelGelir += v.gelir;
        genelGider += v.gider;
        return [
          santiye,
          formatSayi(v.devreden),
          "+" + formatSayi(v.gelir),
          "-" + formatSayi(v.gider),
          formatSayi(sonBakiye),
        ];
      });
      const genelSon = genelDevreden + genelGelir - genelGider;

      autoTable(doc, {
        startY: ozetY + 3,
        head: [[
          "Santiye",
          { content: "Devreden", styles: { halign: "right" as const } },
          { content: "Donem Gelir", styles: { halign: "right" as const } },
          { content: "Donem Gider", styles: { halign: "right" as const } },
          { content: "Son Bakiye", styles: { halign: "right" as const } },
        ]],
        body: ozetBody,
        foot: [[
          { content: "GENEL TOPLAM", styles: { halign: "right" as const } },
          { content: formatSayi(genelDevreden), styles: { halign: "right" as const } },
          { content: "+" + formatSayi(genelGelir), styles: { halign: "right" as const } },
          { content: "-" + formatSayi(genelGider), styles: { halign: "right" as const } },
          { content: formatSayi(genelSon), styles: { halign: "right" as const } },
        ]],
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 58, 95], textColor: 255 },
        footStyles: { fillColor: [15, 37, 64], textColor: 255, fontStyle: "bold" },
        columnStyles: {
          1: { halign: "right" },
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right", fontStyle: "bold" },
        },
      });
    }

    // İmza alanları
    const lastY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? doc.internal.pageSize.getHeight() - 60;
    const pageH = doc.internal.pageSize.getHeight();
    const pageW = doc.internal.pageSize.getWidth();
    let imzaY = lastY + 20;
    // Sayfa taşarsa yeni sayfa aç
    if (imzaY + 35 > pageH) {
      doc.addPage();
      imzaY = 30;
    }
    const boxW = 80;
    const boxH = 25;
    const leftX = pageW / 2 - boxW - 15;
    const rightX = pageW / 2 + 15;

    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Harcama Yapan", leftX + boxW / 2, imzaY, { align: "center" });
    doc.text("Harcama Yetkilisi", rightX + boxW / 2, imzaY, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.rect(leftX, imzaY + 3, boxW, boxH);
    doc.rect(rightX, imzaY + 3, boxW, boxH);

    doc.save("kasa-defteri.pdf");
  }
  function exportExcel() {
    const headers = ["Tarih", "Kullanıcı", "Şantiye", "Açıklama", "Tip", "Ödeme", "Kategori", "Gelir (+)", "Gider (−)", "Bakiye"];
    const data = filtrelenmis.map((h) => [
      h.tarih ? h.tarih.split("-").reverse().join(".") : "—",
      personelMap.get(h.personel_id)?.ad_soyad ?? "",
      santiyeMap.get(h.santiye_id) ?? "",
      h.aciklama ?? "",
      h.tip === "gelir" ? "Gelir" : "Gider",
      h.odeme_yontemi === "nakit" ? "Nakit" : "Kart",
      h.kategori ?? "",
      h.tip === "gelir" ? h.tutar : "",
      h.tip === "gider" ? h.tutar : "",
      h.odeme_yontemi === "nakit" ? (bakiyeMap.get(`${h.personel_id}|${h.id}`) ?? 0) : "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Kasa");
    XLSX.writeFile(wb, "kasa-defteri.xlsx");
  }

  const gosterilenSantiyeler = filtreliSantiyeler(santiyeler, kullanici);
  // Filtre için: sadece kasa hareketi olan şantiyeler
  const filtreSantiyeleri = (() => {
    const islemliIds = new Set<string>();
    for (const h of hareketler) islemliIds.add(h.santiye_id);
    return gosterilenSantiyeler.filter((s) => islemliIds.has(s.id));
  })();

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Wallet size={24} /> Kasa Defteri
        </h1>
        {isYonetici && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
              <FileDown size={14} className="mr-1" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
              <FileSpreadsheet size={14} className="mr-1" /> Excel
            </Button>
          </div>
        )}
      </div>

      {/* Filtre barı */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 space-y-3">
        {isYonetici && (
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Şantiye</Label>
              <SantiyeSelect santiyeler={filtreSantiyeleri} value={filtreSantiye} onChange={setFiltreSantiye} showAll className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Kullanıcı</Label>
              <select value={filtrePersonel} onChange={(e) => setFiltrePersonel(e.target.value)} className={selectClass + " w-full"}>
                <option value="">Tümü</option>
                {personeller.filter((p) => p.aktif !== false).map((p) => <option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Ödeme</Label>
              <select value={filtreOdeme} onChange={(e) => setFiltreOdeme(e.target.value as "" | "nakit" | "kart")} className={selectClass + " w-full"}>
                <option value="">Tümü</option>
                <option value="nakit">Nakit</option>
                <option value="kart">Kart</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Başlangıç</Label>
              <input type="date" value={filtreBaslangic} onChange={(e) => setFiltreBaslangic(e.target.value)} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Bitiş</Label>
              <input type="date" value={filtreBitis} onChange={(e) => setFiltreBitis(e.target.value)} className={selectClass + " w-full"} />
            </div>
            <div className="flex gap-1 items-end">
              {[{ l: "Bu Ay", a: 1 }, { l: "3 Ay", a: 3 }, { l: "6 Ay", a: 6 }, { l: "1 Yıl", a: 12 }].map((b) => (
                <button key={b.l} type="button" onClick={() => {
                  const bitis = new Date();
                  const baslangic = new Date();
                  baslangic.setMonth(baslangic.getMonth() - b.a);
                  if (b.a <= 1) baslangic.setDate(1);
                  setFiltreBaslangic(baslangic.toISOString().slice(0, 10));
                  setFiltreBitis(bitis.toISOString().slice(0, 10));
                }}
                  className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
                  {b.l}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Arama</Label>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Kullanıcı, şantiye, açıklama..." className={selectClass + " w-full pl-8"} />
              </div>
            </div>
          </div>
        )}
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={dialogAc}>
          <Plus size={14} className="mr-1" /> İşlem Ekle
        </Button>
      </div>

      {/* Özet kartları */}
      {isYonetici && (
        <div className={`grid gap-3 mb-4 ${filtreOdeme === "kart" ? "grid-cols-1 md:grid-cols-1 max-w-xs" : "grid-cols-2 md:grid-cols-3"}`}>
          {filtreOdeme !== "kart" && (
            <>
              <div className="bg-white rounded-lg border p-3">
                <div className="text-[10px] text-gray-500 uppercase font-semibold">Nakit Bakiye</div>
                <div className={`text-xl font-bold ${ozet.nakitBakiye < 0 ? "text-red-600" : "text-[#1E3A5F]"}`}>{formatTL(ozet.nakitBakiye)}</div>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <div className="text-[10px] text-gray-500 uppercase font-semibold">Toplam Gelir</div>
                <div className="text-xl font-bold text-emerald-700">{formatTL(ozet.toplamGelir)}</div>
              </div>
              <div className="bg-white rounded-lg border p-3">
                <div className="text-[10px] text-gray-500 uppercase font-semibold">Gider (Nakit)</div>
                <div className="text-xl font-bold text-red-600">{formatTL(ozet.toplamGiderNakit)}</div>
              </div>
            </>
          )}
          {filtreOdeme === "kart" && (
            <div className="bg-white rounded-lg border p-3">
              <div className="text-[10px] text-gray-500 uppercase font-semibold">Toplam Gider (Kart)</div>
              <div className="text-xl font-bold text-purple-700">{formatTL(ozet.toplamGiderKart)}</div>
              <div className="text-[10px] text-gray-400">Bakiyeyi etkilemez</div>
            </div>
          )}
        </div>
      )}

      {/* Kısıtlı kullanıcı notu */}
      {!isYonetici && kullanici && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4 text-xs text-amber-800">
          Sadece kendi girdiğiniz kayıtları görebilirsiniz{kullanici.geriye_donus_gun != null ? ` (son ${kullanici.geriye_donus_gun} gün)` : ""}.
        </div>
      )}

      {/* Tablo */}
      {loading ? (
        <div className="text-center py-16 bg-white rounded-lg border text-gray-500">Yükleniyor...</div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Wallet size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{!filtreSantiye && !filtrePersonel ? "Şantiye veya kullanıcı seçin." : "Kayıt bulunamadı."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">Tarih</TableHead>
                <TableHead className="text-white text-[11px] px-2 min-w-[150px]">Açıklama</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Tip</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Ödeme</TableHead>
                <TableHead className="text-white text-[11px] px-2">Kategori</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[90px] bg-emerald-800">Gelir</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[90px] bg-red-800">Gider</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[90px] bg-[#0f2540]">Bakiye</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Slip</TableHead>
                {isYonetici && <TableHead className="text-white text-[11px] px-2 text-center w-[70px]">İşlem</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((h) => {
                const isAvans = (h.kategori ?? "").toLowerCase().includes("avans");
                const rowBorder = isAvans
                  ? "border-l-4 border-l-amber-500"
                  : h.tip === "gelir" ? "border-l-4 border-l-emerald-400" : h.odeme_yontemi === "kart" ? "border-l-4 border-l-purple-400" : "border-l-4 border-l-red-400";
                const rowBg = isAvans ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50";
                const bakiye = bakiyeMap.get(`${h.personel_id}|${h.id}`);
                return (
                  <TableRow key={h.id} className={`${rowBg} ${rowBorder}`}>
                    <TableCell className="px-2 whitespace-nowrap">{h.tarih ? h.tarih.split("-").reverse().join(".") : "—"}</TableCell>
                    <TableCell className="px-2 text-gray-700 truncate max-w-[150px]" title={h.aciklama ?? ""}>
                      {isAvans && <span className="inline-block text-[9px] font-bold bg-amber-500 text-white rounded px-1 mr-1">AVANS</span>}
                      {h.aciklama ?? "—"}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      {h.tip === "gelir"
                        ? <span className="inline-flex items-center gap-0.5 text-emerald-700"><ArrowUpCircle size={12} /> Gelir</span>
                        : <span className="inline-flex items-center gap-0.5 text-red-600"><ArrowDownCircle size={12} /> Gider</span>}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      {h.odeme_yontemi === "nakit"
                        ? <span className="inline-flex items-center gap-0.5 text-gray-700"><Banknote size={12} /> Nakit</span>
                        : <span className="inline-flex items-center gap-0.5 text-purple-700"><CreditCard size={12} /> Kart</span>}
                    </TableCell>
                    <TableCell className={`px-2 ${isAvans ? "text-amber-700 font-bold" : "text-gray-600"}`}>{h.kategori ?? "—"}</TableCell>
                    <TableCell className="px-2 text-right font-semibold text-emerald-700 bg-emerald-50">
                      {h.tip === "gelir" ? `+${formatSayi(h.tutar)}` : ""}
                    </TableCell>
                    <TableCell className="px-2 text-right font-semibold bg-red-50">
                      {h.tip === "gider" ? (
                        <span className={h.odeme_yontemi === "kart" ? "text-purple-700" : "text-red-600"}>
                          −{formatSayi(h.tutar)}
                        </span>
                      ) : ""}
                    </TableCell>
                    <TableCell className="px-2 text-right bg-blue-50 font-bold text-[#1E3A5F]">
                      {h.odeme_yontemi === "nakit" ? (
                        <span className={bakiye != null && bakiye < 0 ? "text-red-600" : ""}>{bakiye != null ? formatSayi(bakiye) : "—"}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      {h.slip_url ? (
                        <button type="button" onClick={() => setSlipGoster(h.slip_url)} className="text-blue-600 hover:text-blue-800" title="Slip görüntüle">
                          <ImageIcon size={14} />
                        </button>
                      ) : "—"}
                    </TableCell>
                    {isYonetici && (
                      <TableCell className="px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => dialogDuzenleAc(h)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={12} /></button>
                          <button type="button" onClick={() => setSilOnay(h.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={12} /></button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Devreden Bakiye + Bakiye Toplamı */}
      {filtrelenmis.length > 0 && (
        <div className="mt-3 space-y-2">
          {devredenBakiye !== 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 flex items-center justify-between">
              <span className="text-amber-800 font-semibold text-sm">Önceki Dönem Devreden Bakiye (Nakit)</span>
              <span className={`text-lg font-bold ${devredenBakiye < 0 ? "text-red-600" : "text-[#1E3A5F]"}`}>{formatTL(devredenBakiye)}</span>
            </div>
          )}
          <div className="bg-[#64748B] rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-white font-semibold text-sm">Dönem Toplamı</span>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-[10px] text-white/60">Gelir</div>
                <div className="text-emerald-300 font-bold">+{formatSayi(ozet.toplamGelir)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-white/60">Gider (Nakit)</div>
                <div className="text-red-300 font-bold">−{formatSayi(ozet.toplamGiderNakit)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-white/60">Gider (Kart)</div>
                <div className="text-purple-300 font-bold">−{formatSayi(ozet.toplamGiderKart)}</div>
              </div>
              <div className="text-right border-l border-white/30 pl-6">
                <div className="text-[10px] text-white/60">Güncel Nakit Bakiye</div>
                <div className={`text-lg font-bold ${(devredenBakiye + ozet.nakitBakiye) < 0 ? "text-red-300" : "text-white"}`}>
                  {formatTL(devredenBakiye + ozet.nakitBakiye)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* İşlem Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "İşlemi Düzenle" : "Yeni İşlem Ekle"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Kullanıcı <span className="text-red-500">*</span></Label>
              <select value={dPersonel} onChange={(e) => setDPersonel(e.target.value)} className={selectClass + " w-full"} disabled={dialogLoading || !isYonetici}>
                <option value="">Kullanıcı seçiniz</option>
                {(!isYonetici && kullanici
                  ? personeller.filter((p) => p.id === kullanici.id)
                  : personeller.filter((p) => p.aktif !== false)
                ).map((p) => <option key={p.id} value={p.id}>{p.ad_soyad}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Şantiye <span className="text-red-500">*</span></Label>
              <SantiyeSelect santiyeler={gosterilenSantiyeler} value={dSantiye} onChange={setDSantiye} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tarih <span className="text-red-500">*</span></Label>
              <input type="date" value={dTarih} onChange={(e) => setDTarih(e.target.value)} className={selectClass + " w-full"} disabled={dialogLoading} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tip <span className="text-red-500">*</span></Label>
              <select value={dTip} onChange={(e) => setDTip(e.target.value as "gelir" | "gider")} className={selectClass + " w-full"} disabled={dialogLoading}>
                <option value="gelir">Gelir</option>
                <option value="gider">Gider</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tutar (TL) <span className="text-red-500">*</span></Label>
              <input type="text" inputMode="decimal" value={dTutar} onChange={(e) => setDTutar(formatParaInput(e.target.value))} placeholder="0,00" className={selectClass + " w-full"} disabled={dialogLoading} />
            </div>
            {dTip === "gelir" && (
              <>
                <div className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                  Gelir kaydı: Nakit olarak işlenir. Açıklama otomatik oluşur: &quot;{otomatikGelirAciklama(dTarih || new Date().toISOString().slice(0,10))}&quot;
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Not / Açıklama</Label>
                  <textarea value={dAciklama} onChange={(e) => setDAciklama(e.target.value)} placeholder="Opsiyonel not ekleyebilirsiniz..." rows={2}
                    className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50" disabled={dialogLoading} />
                </div>
              </>
            )}
            {dTip === "gider" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Ödeme Yöntemi <span className="text-red-500">*</span></Label>
                    <select value={dOdeme} onChange={(e) => setDOdeme(e.target.value as "nakit" | "kart")} className={selectClass + " w-full"} disabled={dialogLoading}>
                      <option value="nakit">Nakit</option>
                      <option value="kart">Kredi Kartı</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Kategori <span className="text-red-500">*</span></Label>
                    <select value={dKategori} onChange={(e) => setDKategori(e.target.value)} className={selectClass + " w-full"} disabled={dialogLoading}>
                      <option value="">Seçiniz</option>
                      {kategoriler.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Açıklama <span className="text-red-500">*</span></Label>
                  <textarea value={dAciklama} onChange={(e) => setDAciklama(e.target.value)} placeholder="Harcama detayı..." rows={2}
                    className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50" disabled={dialogLoading} />
                </div>
                {dOdeme === "kart" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Slip Fotoğrafı</Label>
                    <input type="file" accept="image/*" onChange={(e) => setDSlipFile(e.target.files?.[0] ?? null)} disabled={dialogLoading}
                      className="w-full text-sm text-gray-500 file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[#64748B] file:text-white hover:file:bg-[#2a4f7a]" />
                  </div>
                )}
                {dOdeme === "kart" && (
                  <div className="text-[10px] text-purple-600 bg-purple-50 px-2 py-1 rounded">
                    Kart ile yapılan harcamalar nakit bakiyeyi etkilemez.
                  </div>
                )}
              </>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={dialogLoading}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={kaydet} disabled={dialogLoading}>
                {dialogLoading ? "Kaydediliyor..." : editId ? "Güncelle" : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Silme Onay */}
      <Dialog open={!!silOnay} onOpenChange={(o) => !o && setSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>İşlemi Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu işlem kalıcı olarak silinecek. Emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setSilOnay(null)}>İptal</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={silOnayla}><Trash2 size={14} className="mr-1" /> Sil</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Slip Görüntüleme */}
      <Dialog open={!!slipGoster} onOpenChange={(o) => !o && setSlipGoster(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Slip Görüntüle</DialogTitle></DialogHeader>
          {slipGoster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slipGoster} alt="Slip" className="w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
