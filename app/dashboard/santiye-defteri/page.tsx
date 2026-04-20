// Şantiye Defteri — günlük kayıt takibi
"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks";
import { getSantiyelerBasic, getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import {
  getDefterler,
  getDefterByTarih,
  getNextSayfaNo,
  insertDefter,
  updateDefter,
  getKayitlar,
  insertKayit,
  updateKayit,
  deleteKayit,
  deleteDefter,
} from "@/lib/supabase/queries/santiye-defteri";
import type { SantiyeDefteri, SantiyeDefterKayit } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  NotebookPen, ChevronLeft, ChevronRight, FileDown, Plus,
  Pencil, Trash2, Sun, Cloud, CloudRain, Snowflake, Eye, Search, FileSpreadsheet,
} from "lucide-react";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { tarihIzinliMi } from "@/lib/utils/tarih-izin";
import { filtreliSantiyeler, otomatikSantiyeId } from "@/lib/utils/santiye-filtre";

type SantiyeBasic = { id: string; is_adi: string; durum: string; gecici_kabul_tarihi?: string | null; kesin_kabul_tarihi?: string | null; tasfiye_tarihi?: string | null; devir_tarihi?: string | null };
const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

const GUN_ADLARI = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const HAVA_SECENEKLERI = ["Güneşli", "Parçalı Bulutlu", "Bulutlu", "Yağmurlu", "Karlı", "Sisli", "Fırtınalı"];
const HAVA_ICONLARI: Record<string, typeof Sun> = {
  "Güneşli": Sun, "Parçalı Bulutlu": Cloud, "Bulutlu": Cloud,
  "Yağmurlu": CloudRain, "Karlı": Snowflake, "Sisli": Cloud, "Fırtınalı": CloudRain,
};

function formatTarihGun(tarih: string): string {
  const d = new Date(tarih + "T00:00:00");
  const gun = GUN_ADLARI[d.getDay()];
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${gun}`;
}

function tr(s: string): string {
  return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
    .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
    .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
}

// İlk harf büyük + nokta sonrası ilk harf büyük
function basHarfBuyuk(text: string): string {
  if (!text) return text;
  // İlk harfi büyüt
  let result = text.charAt(0).toUpperCase() + text.slice(1);
  // Nokta + boşluk sonrası ilk harfi büyüt
  result = result.replace(/\.\s+([a-züöşçığ])/gi, (match, letter) => {
    return match.slice(0, -1) + (letter as string).toUpperCase();
  });
  return result;
}

export default function SantiyeDefPage() {
  const { kullanici, isYonetici } = useAuth();

  const [loading, setLoading] = useState(true);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [filtreSantiye, setFiltreSantiye] = useState("");
  const [seciliTarih, setSeciliTarih] = useState(() => new Date().toISOString().slice(0, 10));

  const [defterListesi, setDefterListesi] = useState<(SantiyeDefteri & { kayitlar: SantiyeDefterKayit[] })[]>([]);
  const [defter, setDefter] = useState<SantiyeDefteri | null>(null);
  const [kayitlar, setKayitlar] = useState<SantiyeDefterKayit[]>([]);
  const [kullaniciMap, setKullaniciMap] = useState<Map<string, string>>(new Map());
  const [defterDialogOpen, setDefterDialogOpen] = useState(false);

  // Filtreler — ay bazlı liste
  const [filtreAy, setFiltreAy] = useState(() => {
    const b = new Date(); return `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}`;
  });
  const [defterArama, setDefterArama] = useState("");

  const [havaDurumu, setHavaDurumu] = useState("");
  const [sicaklik, setSicaklik] = useState("");

  const [yeniIcerik, setYeniIcerik] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editIcerik, setEditIcerik] = useState("");
  const [silOnay, setSilOnay] = useState<string | null>(null);
  const [silDefterOnay, setSilDefterOnay] = useState<string | null>(null);

  const loadSantiyeler = useCallback(async () => {
    try {
      const sData = await getSantiyelerAll();
      setSantiyeler((sData as SantiyeBasic[]) ?? []);
      const otoId = otomatikSantiyeId(sData as SantiyeBasic[], kullanici);
      if (otoId) setFiltreSantiye(otoId);
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
    } finally {
      setLoading(false);
    }
  }, [kullanici]);

  useEffect(() => { loadSantiyeler(); }, [loadSantiyeler]);

  const loadDefter = useCallback(async () => {
    if (!filtreSantiye) { setDefter(null); setKayitlar([]); return; }
    try {
      const d = await getDefterByTarih(filtreSantiye, seciliTarih);
      setDefter(d);
      if (d) {
        setHavaDurumu(d.hava_durumu ?? "");
        setSicaklik(d.sicaklik ?? "");
        const k = await getKayitlar(d.id);
        setKayitlar(k);
      } else {
        setHavaDurumu(""); setSicaklik(""); setKayitlar([]);
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist")) {
        toast.error("santiye_defteri tablosu yok. SQL çalıştırın.", { duration: 8000 });
      }
    }
  }, [filtreSantiye, seciliTarih]);

  useEffect(() => { loadDefter(); }, [loadDefter]);

  // Ay bazlı defter listesini yükle
  const loadDefterListesi = useCallback(async () => {
    if (!filtreSantiye || !filtreAy) { setDefterListesi([]); return; }
    try {
      const [y, m] = filtreAy.split("-").map(Number);
      const baslangic = `${y}-${String(m).padStart(2, "0")}-01`;
      const son = new Date(y, m, 0).getDate();
      const bitis = `${y}-${String(m).padStart(2, "0")}-${String(son).padStart(2, "0")}`;
      const defterler = await getDefterler(filtreSantiye, baslangic, bitis);
      // Her defter için kayıtları da yükle
      const listWithKayitlar = await Promise.all(
        defterler.map(async (d) => {
          const k = await getKayitlar(d.id).catch(() => []);
          return { ...d, kayitlar: k };
        })
      );
      setDefterListesi(listWithKayitlar);
    } catch { /* sessiz */ }
  }, [filtreSantiye, filtreAy]);

  useEffect(() => { loadDefterListesi(); }, [loadDefterListesi]);

  // Dialog'da defter aç
  function defterAc(tarih: string) {
    setSeciliTarih(tarih);
    setDefterDialogOpen(true);
  }

  function gunDegistir(delta: number) {
    const d = new Date(seciliTarih + "T00:00:00");
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    setSeciliTarih(`${y}-${m}-${day}`);
  }

  async function havaDurumuKaydet() {
    if (!filtreSantiye) return;
    try {
      if (defter) {
        await updateDefter(defter.id, { hava_durumu: havaDurumu || null, sicaklik: sicaklik || null });
        toast.success("Hava durumu güncellendi.");
      } else {
        const sayfaNo = await getNextSayfaNo(filtreSantiye);
        const yeniDefter = await insertDefter({
          santiye_id: filtreSantiye, tarih: seciliTarih, sayfa_no: sayfaNo,
          hava_durumu: havaDurumu || null, sicaklik: sicaklik || null,
          created_by: kullanici?.id ?? null,
        });
        setDefter(yeniDefter);
        toast.success("Defter oluşturuldu.");
      }
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function kayitEkle() {
    if (!yeniIcerik.trim()) { toast.error("İçerik girin."); return; }
    if (!filtreSantiye) { toast.error("Şantiye seçin."); return; }
    if (!tarihIzinliMi(kullanici, seciliTarih)) { toast.error("Bu tarihe kayıt yapamazsınız."); return; }
    setSaving(true);
    try {
      let defterId = defter?.id;
      if (!defterId) {
        const sayfaNo = await getNextSayfaNo(filtreSantiye);
        const yeniDefter = await insertDefter({
          santiye_id: filtreSantiye, tarih: seciliTarih, sayfa_no: sayfaNo,
          hava_durumu: havaDurumu || null, sicaklik: sicaklik || null,
          created_by: kullanici?.id ?? null,
        });
        defterId = yeniDefter.id;
        setDefter(yeniDefter);
      } else {
        // Hava durumunu otomatik kaydet
        await updateDefter(defterId, { hava_durumu: havaDurumu || null, sicaklik: sicaklik || null });
      }
      await insertKayit({ defter_id: defterId, yazan_id: kullanici?.id ?? "", icerik: basHarfBuyuk(yeniIcerik.trim()), sira: kayitlar.length + 1 });
      setYeniIcerik("");
      await loadDefter(); await loadDefterListesi();
      setDefterDialogOpen(false);
      toast.success("Kayıt eklendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setSaving(false); }
  }

  async function kayitDuzenle() {
    if (!editId || !editIcerik.trim()) return;
    try {
      await updateKayit(editId, editIcerik.trim());
      setEditId(null);
      await loadDefter(); await loadDefterListesi();
      toast.success("Kayıt güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function kayitSil() {
    if (!silOnay) return;
    try {
      await deleteKayit(silOnay);
      setSilOnay(null);
      await loadDefter(); await loadDefterListesi();
      toast.success("Kayıt silindi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function defterSil() {
    if (!silDefterOnay) return;
    try {
      await deleteDefter(silDefterOnay);
      setSilDefterOnay(null);
      setDefter(null); setKayitlar([]);
      await loadDefterListesi();
      toast.success("Defter silindi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Belirli bir defterin PDF'ini oluştur (liste satırından)
  function exportPDFForDefter(d: SantiyeDefteri & { kayitlar: SantiyeDefterKayit[] }) {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const mx = 15;
    const contentW = pw - mx * 2;

    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(tr("SANTIYE GUNLUK DEFTERI"), pw / 2, 18, { align: "center" });
    doc.setLineWidth(0.5); doc.line(mx, 22, pw - mx, 22);

    const infoY = 25;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.rect(mx, infoY, contentW, 8);
    doc.line(mx + 40, infoY, mx + 40, infoY + 8);
    doc.line(mx + contentW * 0.65, infoY, mx + contentW * 0.65, infoY + 8);
    doc.text(tr("TARIH ve GUN"), mx + 3, infoY + 5.5);
    doc.setFont("helvetica", "normal");
    doc.text(tr(formatTarihGun(d.tarih)), mx + 43, infoY + 5.5);
    doc.setFont("helvetica", "bold");
    doc.text(`SAYFA NO : ${d.sayfa_no}`, mx + contentW * 0.65 + 3, infoY + 5.5);

    doc.rect(mx, infoY + 8, contentW, 8);
    doc.line(mx + 40, infoY + 8, mx + 40, infoY + 16);
    doc.text("HAVA DURUMU", mx + 3, infoY + 13.5);
    doc.setFont("helvetica", "normal");
    const havaStr = [d.sicaklik, d.hava_durumu].filter(Boolean).join("/");
    doc.text(tr(havaStr || "-"), mx + 43, infoY + 13.5);

    const icerikY = infoY + 19;
    const icerikH = ph - icerikY - 35;
    doc.rect(mx, icerikY, contentW, icerikH);
    const satirH = 6;
    const satirSayisi = Math.floor(icerikH / satirH);
    for (let i = 1; i < satirSayisi; i++) {
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
      doc.line(mx + 2, icerikY + i * satirH, pw - mx - 2, icerikY + i * satirH);
    }
    doc.setDrawColor(0, 0, 0);

    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    let cl = 0;
    for (const kayit of d.kayitlar) {
      const yazanAd = kullaniciMap.get(kayit.yazan_id) ?? "";
      const lines = doc.splitTextToSize(`• ${tr(kayit.icerik)}`, contentW - 8) as string[];
      for (const line of lines) {
        if (cl >= satirSayisi - 1) break;
        doc.text(line, mx + 4, icerikY + (cl + 1) * satirH - 1.5); cl++;
      }
      if (cl < satirSayisi - 1 && yazanAd) {
        doc.setFont("helvetica", "italic");
        doc.text(`- ${tr(yazanAd)}`, pw - mx - 4, icerikY + (cl + 1) * satirH - 1.5, { align: "right" });
        doc.setFont("helvetica", "normal"); cl++;
      }
    }

    const imzaY = ph - 30; doc.setLineWidth(0.5);
    const bw = contentW / 3;
    doc.rect(mx, imzaY, bw, 20); doc.rect(mx + bw, imzaY, bw, 20); doc.rect(mx + bw * 2, imzaY, bw, 20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text(tr("SANTIYE SEFI"), mx + bw / 2, imzaY + 4, { align: "center" });
    doc.text(tr("MUTEAHHIT"), mx + bw + bw / 2, imzaY + 4, { align: "center" });
    doc.text(tr("KONTROL MUHENDISI"), mx + bw * 2 + bw / 2, imzaY + 4, { align: "center" });

    doc.save(`santiye-defteri-${d.tarih}.pdf`);
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const mx = 15;
    const contentW = pw - mx * 2;

    // Başlık
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(tr("SANTIYE GUNLUK DEFTERI"), pw / 2, 18, { align: "center" });
    doc.setLineWidth(0.5);
    doc.line(mx, 22, pw - mx, 22);

    // Üst bilgi — Satır 1
    const infoY = 25;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.rect(mx, infoY, contentW, 8);
    doc.line(mx + 40, infoY, mx + 40, infoY + 8);
    doc.line(mx + contentW * 0.65, infoY, mx + contentW * 0.65, infoY + 8);
    doc.text(tr("TARIH ve GUN"), mx + 3, infoY + 5.5);
    doc.setFont("helvetica", "normal");
    doc.text(tr(formatTarihGun(seciliTarih)), mx + 43, infoY + 5.5);
    doc.setFont("helvetica", "bold");
    doc.text(`SAYFA NO : ${defter?.sayfa_no ?? "-"}`, mx + contentW * 0.65 + 3, infoY + 5.5);

    // Satır 2
    doc.rect(mx, infoY + 8, contentW, 8);
    doc.line(mx + 40, infoY + 8, mx + 40, infoY + 16);
    doc.text("HAVA DURUMU", mx + 3, infoY + 13.5);
    doc.setFont("helvetica", "normal");
    const havaStr = [sicaklik ? `${sicaklik}` : "", havaDurumu].filter(Boolean).join("/");
    doc.text(tr(havaStr || "-"), mx + 43, infoY + 13.5);

    // İçerik alanı
    const icerikY = infoY + 19;
    const icerikH = ph - icerikY - 35;
    doc.rect(mx, icerikY, contentW, icerikH);

    // Çizgiler
    const satirH = 6;
    const satirSayisi = Math.floor(icerikH / satirH);
    for (let i = 1; i < satirSayisi; i++) {
      const ly = icerikY + i * satirH;
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
      doc.line(mx + 2, ly, pw - mx - 2, ly);
    }
    doc.setDrawColor(0, 0, 0);

    // Kayıtları yaz
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    let cl = 0;
    for (const kayit of kayitlar) {
      const yazanAd = kullaniciMap.get(kayit.yazan_id) ?? "";
      const lines = doc.splitTextToSize(`• ${tr(kayit.icerik)}`, contentW - 8) as string[];
      for (const line of lines) {
        if (cl >= satirSayisi - 1) break;
        doc.text(line, mx + 4, icerikY + (cl + 1) * satirH - 1.5);
        cl++;
      }
      if (cl < satirSayisi - 1 && yazanAd) {
        doc.setFont("helvetica", "italic");
        doc.text(`- ${tr(yazanAd)}`, pw - mx - 4, icerikY + (cl + 1) * satirH - 1.5, { align: "right" });
        doc.setFont("helvetica", "normal");
        cl++;
      }
    }

    // İmza kutuları
    const imzaY = ph - 30;
    doc.setLineWidth(0.5);
    const bw = contentW / 3;
    doc.rect(mx, imzaY, bw, 20);
    doc.rect(mx + bw, imzaY, bw, 20);
    doc.rect(mx + bw * 2, imzaY, bw, 20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text(tr("SANTIYE SEFI"), mx + bw / 2, imzaY + 4, { align: "center" });
    doc.text(tr("MUTEAHHIT"), mx + bw + bw / 2, imzaY + 4, { align: "center" });
    doc.text(tr("KONTROL MUHENDISI"), mx + bw * 2 + bw / 2, imzaY + 4, { align: "center" });

    doc.save(`santiye-defteri-${seciliTarih}.pdf`);
  }

  const gosterilenSantiyeler = filtreliSantiyeler(santiyeler, kullanici);
  const tarihIzinli = tarihIzinliMi(kullanici, seciliTarih);
  const HavaIcon = HAVA_ICONLARI[havaDurumu] ?? Sun;

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  function hizliAy(ayOnce: number) {
    const d = new Date();
    d.setMonth(d.getMonth() - ayOnce + 1);
    setFiltreAy(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const filtrelenmisDefterler = defterArama.trim()
    ? defterListesi.filter((d) => {
        const q = defterArama.trim().toLowerCase();
        const kayitText = d.kayitlar.map((k) => k.icerik).join(" ").toLowerCase();
        const tarihText = formatTarihGun(d.tarih).toLowerCase();
        return kayitText.includes(q) || tarihText.includes(q);
      })
    : defterListesi;

  function exportExcel() {
    const headers = ["Tarih", "Sayfa No", "Hava", "Sıcaklık", "Yazan", "İçerik"];
    const data: (string | number)[][] = [];
    for (const d of filtrelenmisDefterler) {
      for (const k of d.kayitlar) {
        data.push([
          formatTarihGun(d.tarih), d.sayfa_no ?? "", d.hava_durumu ?? "", d.sicaklik ?? "",
          kullaniciMap.get(k.yazan_id) ?? "", k.icerik,
        ]);
      }
      if (d.kayitlar.length === 0) {
        data.push([formatTarihGun(d.tarih), d.sayfa_no ?? "", d.hava_durumu ?? "", d.sicaklik ?? "", "", ""]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [{ wch: 25 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 20 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Santiye Defteri");
    XLSX.writeFile(wb, `santiye-defteri-${filtreAy}.xlsx`);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <NotebookPen size={24} /> Şantiye Defteri
          </h1>
          <p className="text-xs font-bold text-red-700 mt-1 leading-relaxed">
            {"ÖNEMLİ NOT : Şantiye Defteri Günlük Çıktı Alınacak. Talimatla Yapılan İşler, Tutanaksız Yapılan İşler, Döküm Sahasının Belirlenmesi Gibi Önemli Konular Mutlaka Şantiye Defterine Yazılacak ve Kontrol Mühendisine O Gün İmzalatılacak."}
          </p>
        </div>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => {
          setSeciliTarih(new Date().toISOString().slice(0, 10));
          setDefterDialogOpen(true);
        }} disabled={!filtreSantiye}>
          <Plus size={14} className="mr-1" /> Yeni Şantiye Defteri Ekle
        </Button>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Şantiye</Label>
          <SantiyeSelect santiyeler={gosterilenSantiyeler} value={filtreSantiye} onChange={setFiltreSantiye} placeholder="Şantiye seçin" className={selectClass + " w-full min-w-[200px]"} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Ay</Label>
          <input type="month" value={filtreAy} onChange={(e) => setFiltreAy(e.target.value)} className={selectClass} />
        </div>
        <div className="flex gap-1 items-end">
          {[{ l: "Bu Ay", a: 0 }, { l: "3 Ay", a: 2 }, { l: "6 Ay", a: 5 }, { l: "1 Yıl", a: 11 }].map((b) => (
            <button key={b.l} type="button" onClick={() => hizliAy(b.a)}
              className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
              {b.l}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Arama</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={defterArama} onChange={(e) => setDefterArama(e.target.value)}
              placeholder="Kayıt içeriğinde ara..." className={selectClass + " pl-8 w-48"} />
          </div>
        </div>
        <div className="flex gap-1 items-end ml-auto">
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs" disabled={filtrelenmisDefterler.length === 0}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {/* Defter Listesi */}
      {!filtreSantiye ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <NotebookPen size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Şantiye seçin.</p>
        </div>
      ) : filtrelenmisDefterler.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <NotebookPen size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{defterArama.trim() ? "Arama sonucu bulunamadı." : "Bu ayda kayıt bulunmuyor."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          {filtrelenmisDefterler.map((d) => {
            // Yazanlar — benzersiz isimler
            const yazanIds = [...new Set(d.kayitlar.map((k) => k.yazan_id))];
            const yazanlar = yazanIds.map((id) => kullaniciMap.get(id) ?? "").filter(Boolean);
            // Kısa metin — ilk kaydın ilk 80 karakteri
            const kisaMetin = d.kayitlar.length > 0
              ? d.kayitlar[0].icerik.substring(0, 80) + (d.kayitlar[0].icerik.length > 80 ? "..." : "")
              : "Kayıt yok";
            return (
              <div key={d.id} className="border-b last:border-b-0 hover:bg-gray-50 cursor-pointer px-4 py-3 flex items-center gap-4"
                onClick={() => defterAc(d.tarih)}>
                <div className="text-center min-w-[60px]">
                  <div className="text-lg font-bold text-[#1E3A5F]">{new Date(d.tarih + "T00:00:00").getDate()}</div>
                  <div className="text-[10px] text-gray-400">{GUN_ADLARI[new Date(d.tarih + "T00:00:00").getDay()]}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{kisaMetin}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-400">Sayfa: {d.sayfa_no}</span>
                    {d.hava_durumu && <span className="text-[10px] text-gray-400">{d.sicaklik ? `${d.sicaklik}/` : ""}{d.hava_durumu}</span>}
                    <span className="text-[10px] text-gray-400">{d.kayitlar.length} kayıt</span>
                  </div>
                </div>
                <div className="text-right min-w-[80px]">
                  <p className="text-[10px] text-gray-300 italic">{yazanlar.join(", ")}</p>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => defterAc(d.tarih)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50" title="Ön İzleme">
                    <Eye size={14} />
                  </button>
                  <button type="button" onClick={() => exportPDFForDefter(d)} className="p-1.5 text-gray-400 hover:text-[#1E3A5F] rounded hover:bg-gray-100" title="PDF İndir">
                    <FileDown size={14} />
                  </button>
                  <button type="button" onClick={() => setSilDefterOnay(d.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50" title="Sil">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Defter Dialog — tam sayfa görünümü */}
      <Dialog open={defterDialogOpen} onOpenChange={(o) => { if (!o) setDefterDialogOpen(false); }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto !p-0">
          <div className="bg-white rounded-lg">
            {/* Başlık */}
            <div className="bg-[#64748B] text-white text-center py-2 rounded-t-lg relative">
              <h2 className="font-bold text-sm tracking-wider">ŞANTİYE GÜNLÜK DEFTERİ</h2>
              <div className="absolute right-2 top-1.5 flex gap-1">
                {defter && (
                  <button type="button" onClick={exportPDF} className="text-white/70 hover:text-white p-1" title="PDF"><FileDown size={16} /></button>
                )}
              </div>
            </div>

            {/* Tarih gezinme */}
            <div className="flex items-center justify-center gap-2 py-2 border-b bg-gray-50">
              <button type="button" onClick={() => gunDegistir(-1)} className="p-1 rounded hover:bg-gray-200"><ChevronLeft size={18} /></button>
              <input type="date" value={seciliTarih} onChange={(e) => setSeciliTarih(e.target.value)} className="text-sm font-semibold bg-transparent border-0 outline-none text-center" />
              <button type="button" onClick={() => gunDegistir(1)} className="p-1 rounded hover:bg-gray-200"><ChevronRight size={18} /></button>
            </div>

            {/* Üst bilgi */}
            <div className="border-b">
              <div className="grid grid-cols-3 text-xs border-b">
                <div className="border-r px-3 py-2"><span className="font-bold text-gray-600">TARİH ve GÜN</span></div>
                <div className="border-r px-3 py-2 font-semibold">{formatTarihGun(seciliTarih)}</div>
                <div className="px-3 py-2 font-bold text-gray-600">SAYFA NO : <span className="text-[#1E3A5F]">{defter?.sayfa_no ?? "—"}</span></div>
              </div>
              <div className="grid grid-cols-3 text-xs">
                <div className="border-r px-3 py-2"><span className="font-bold text-gray-600">HAVA DURUMU</span></div>
                <div className="col-span-2 px-3 py-1 flex items-center gap-2">
                  <input type="text" value={sicaklik} onChange={(e) => setSicaklik(e.target.value)}
                    placeholder="°C" className="w-14 h-7 text-xs border rounded px-2 text-center" />
                  <select value={havaDurumu} onChange={(e) => setHavaDurumu(e.target.value)} className="h-7 text-xs border rounded px-2">
                    <option value="">Seçiniz</option>
                    {HAVA_SECENEKLERI.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {havaDurumu && <HavaIcon size={16} className="text-gray-500" />}
                </div>
              </div>
            </div>

            {/* İçerik */}
            <div className="min-h-[420px] px-5 py-4">
              {kayitlar.length === 0 && !defter ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Bu güne ait defter yok. Aşağıdan kayıt ekleyerek başlayın.
                </div>
              ) : kayitlar.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">Henüz kayıt girilmemiş.</div>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    // Ardışık aynı kullanıcı kayıtlarını grupla
                    type KayitGrup = { yazan_id: string; kayitlar: typeof kayitlar };
                    const gruplar: KayitGrup[] = [];
                    for (const k of kayitlar) {
                      const son = gruplar[gruplar.length - 1];
                      if (son && son.yazan_id === k.yazan_id) {
                        son.kayitlar.push(k);
                      } else {
                        gruplar.push({ yazan_id: k.yazan_id, kayitlar: [k] });
                      }
                    }
                    return gruplar.map((g, gIdx) => {
                      const yazanAd = kullaniciMap.get(g.yazan_id) ?? "Bilinmeyen";
                      const isOwn = g.yazan_id === kullanici?.id;
                      // Grup içinde düzenlenen kayıt var mı?
                      const editKayitIdx = g.kayitlar.findIndex((k) => k.id === editId);
                      return (
                        <div key={`grup-${gIdx}`} className="group">
                          {editKayitIdx >= 0 ? (
                            <div className="space-y-2">
                              <textarea value={editIcerik} onChange={(e) => setEditIcerik(e.target.value)}
                                rows={3} className="w-full text-sm border rounded-lg px-3 py-2 outline-none focus:border-[#1E3A5F]" />
                              <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="outline" onClick={() => setEditId(null)}>İptal</Button>
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={kayitDuzenle}>Güncelle</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 relative">
                              <p className="text-sm text-gray-800 leading-relaxed pr-12">
                                <span className="text-gray-400 mr-1">•</span>
                                {g.kayitlar.map((k) => k.icerik).join(" ")}
                                <span className="text-[10px] text-gray-300 italic ml-2">— {yazanAd}</span>
                              </p>
                              {isOwn && tarihIzinli && (
                                <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button type="button" onClick={() => {
                                    // En son kaydı düzenle, içeriği birleştirilmiş olarak yükle
                                    const sonKayit = g.kayitlar[g.kayitlar.length - 1];
                                    setEditId(sonKayit.id);
                                    setEditIcerik(g.kayitlar.map((k) => k.icerik).join(" "));
                                  }}
                                    className="p-1 text-gray-300 hover:text-blue-600"><Pencil size={12} /></button>
                                  <button type="button" onClick={() => setSilOnay(g.kayitlar[g.kayitlar.length - 1].id)}
                                    className="p-1 text-gray-300 hover:text-red-600"><Trash2 size={12} /></button>
                                </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  });
                  })()}
                </div>
              )}

              {/* Yeni kayıt ekleme */}
              {tarihIzinli && (
                <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold mt-1.5">+</span>
                    <div className="flex-1">
                      <textarea value={yeniIcerik} onChange={(e) => setYeniIcerik(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && yeniIcerik.trim()) { e.preventDefault(); kayitEkle(); } }}
                        placeholder="Yapılan işi yazın, Enter ile kaydedin..."
                        rows={2} className="w-full text-sm border border-dashed border-gray-300 rounded px-3 py-2 outline-none focus:border-[#1E3A5F] resize-none" />
                    </div>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white mt-1" onClick={kayitEkle} disabled={saving || !yeniIcerik.trim()}>
                      {saving ? "..." : "Kaydet"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Çizgili boş satırlar */}
              <div className="mt-3">
                {Array.from({ length: Math.max(0, 5 - kayitlar.length) }).map((_, i) => (
                  <div key={i} className="border-b border-gray-200 h-6" />
                ))}
              </div>
            </div>

            {/* İmza alanı */}
            <div className="border-t grid grid-cols-3 text-xs font-bold text-gray-600 text-center">
              <div className="border-r py-2 h-14">ŞANTİYE ŞEFİ</div>
              <div className="border-r py-2 h-14">MÜTEAHHİT</div>
              <div className="py-2 h-14">KONTROL MÜHENDİSİ</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Silme Onayı */}
      <Dialog open={!!silOnay} onOpenChange={(o) => !o && setSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Kaydı Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu kaydı silmek istediğinize emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setSilOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={kayitSil}>Sil</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Defter Silme Onayı */}
      <Dialog open={!!silDefterOnay} onOpenChange={(o) => !o && setSilDefterOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Defteri Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu defteri ve tüm kayıtlarını silmek istediğinize emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setSilDefterOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={defterSil}>Sil</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
