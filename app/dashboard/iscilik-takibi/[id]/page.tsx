// İşçilik Takibi Detay Sayfası - İş bilgileri + aylık prim veri girişi
"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { getIscilikTakibi, upsertIscilikTakibi } from "@/lib/supabase/queries/iscilik-takibi";
import { updateSantiye } from "@/lib/supabase/queries/santiyeler";
import { getAylikVeriler, createAylikVeri, updateAylikVeri, deleteAylikVeri } from "@/lib/supabase/queries/iscilik-aylik";
import { getManuelGunler, getGunlukUcretler, getAtamaGecmisiTumu, gunHesaplaAyBazli, type GunlukUcret } from "@/lib/supabase/queries/bordro";
import { getTumPersonelBrutUcretler, brutUcretForAy } from "@/lib/supabase/queries/personel-brut-ucret";
import type { IscilikTakibiWithSantiye, IscilikAylik, PersonelAtamaManuelGun, PersonelAtamaGecmisi, PersonelBrutUcret } from "@/lib/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Plus, Trash2, FileDown, FileSpreadsheet } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { useAuth } from "@/hooks";

type EditingCell = { id: string; field: string } | null;

function formatPara(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatTarih(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}

export default function IscilikDetayPage() {
  const params = useParams();
  const takipId = params.id as string;
  const { hasPermission } = useAuth();
  const yEkle = hasPermission("iscilik-takibi", "ekle");
  const yDuzenle = hasPermission("iscilik-takibi", "duzenle");
  const ySil = hasPermission("iscilik-takibi", "sil");
  const router = useRouter();

  const [takip, setTakip] = useState<IscilikTakibiWithSantiye | null>(null);
  const [ayliklar, setAyliklar] = useState<IscilikAylik[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [headerEditValue, setHeaderEditValue] = useState("");
  // Bordro tahmini için gerekli veriler (yatan prim altındaki silik gri rakamla aynı mantık)
  const [manuelGunler, setManuelGunler] = useState<PersonelAtamaManuelGun[]>([]);
  const [gunlukUcretler, setGunlukUcretler] = useState<GunlukUcret[]>([]);
  const [atamalar, setAtamalar] = useState<PersonelAtamaGecmisi[]>([]);
  const [brutUcretGecmisi, setBrutUcretGecmisi] = useState<PersonelBrutUcret[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [allTakip, aylikData, mGunler, ucretler, atamaData, brutData] = await Promise.all([
        getIscilikTakibi(),
        getAylikVeriler(takipId),
        getManuelGunler().catch(() => [] as PersonelAtamaManuelGun[]),
        getGunlukUcretler().catch(() => [] as GunlukUcret[]),
        getAtamaGecmisiTumu().catch(() => [] as PersonelAtamaGecmisi[]),
        getTumPersonelBrutUcretler().catch(() => [] as PersonelBrutUcret[]),
      ]);
      setManuelGunler(mGunler);
      setGunlukUcretler(ucretler);
      setAtamalar(atamaData);
      setBrutUcretGecmisi(brutData);
      const found = (allTakip as IscilikTakibiWithSantiye[])?.find((t) => t.id === takipId);
      const aylik = aylikData ?? [];
      setTakip(found ?? null);
      setAyliklar(aylik);

      // Yatan prim ve toplam son veri tutarını doğru hesapla ve kaydet
      if (found && aylik.length > 0) {
        const dogruYatan = aylik.reduce((t, a) => t + (a.yuklenici_tutar ?? 0) + (a.alt_yuklenici_tutar ?? 0), 0);
        // En son girilen ay = en büyük sıra numaralı satır
        const sonAy = [...aylik].sort((a, b) => b.sira_no - a.sira_no)[0];
        const dogruSonVeri = sonAy ? (sonAy.alt_yuklenici_tutar ?? 0) + (sonAy.yuklenici_tutar ?? 0) : 0;
        if (found.yatan_prim !== dogruYatan || found.toplam_son_veri_tutari !== dogruSonVeri) {
          await upsertIscilikTakibi(found.santiye_id, { yatan_prim: dogruYatan, toplam_son_veri_tutari: dogruSonVeri });
          setTakip((p) => p ? { ...p, yatan_prim: dogruYatan, toplam_son_veri_tutari: dogruSonVeri } : p);
        }
      }
    } catch {
      toast.error("Veriler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [takipId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if ((editing || editingHeader) && inputRef.current) inputRef.current.focus(); }, [editing, editingHeader]);

  // Bordro tahmini — YALNIZCA en yeni ay satırının ait olduğu ay için (kümülatif DEĞİL).
  // "Yeni Ay Ekle" ile eklenen ayın tahmini yatacak tutarı: o aya ait
  // (manuel gün + otomatik atama günü) × günlük/brüt ücret.
  const bordroToplam = useMemo(() => {
    if (!takip?.santiye_id || ayliklar.length === 0) return 0;
    const santiyeId = takip.santiye_id;

    const ayYilNum = (s: string): number => {
      if (!s) return 0;
      const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
      if (mm) return parseInt(mm[2]) * 100 + parseInt(mm[1]);
      const iso = s.match(/^(\d{4})-(\d{2})/);
      if (iso) return parseInt(iso[1]) * 100 + parseInt(iso[2]);
      return 0;
    };

    // Hedef ay = en yeni (en büyük) ay satırı — eklenen ay
    let hedefNum = 0;
    for (const a of ayliklar) {
      const n = ayYilNum(a.ait_oldugu_ay);
      if (n > hedefNum) hedefNum = n;
    }
    if (hedefNum === 0) return 0;
    const yil = Math.floor(hedefNum / 100);
    const ay = hedefNum % 100;
    const ayStr = `${yil}-${String(ay).padStart(2, "0")}`;

    const santiyeAtamalari = atamalar.filter((a) => a.santiye_id === santiyeId);
    const dahilEdilen = new Set<string>();
    const personelUcret = (personelId: string, aStr: string, y: number): number => {
      const brut = brutUcretForAy(brutUcretGecmisi, personelId, aStr);
      if (brut > 0) return brut;
      return gunlukUcretler.find((u) => u.yil === y)?.ucret ?? 0;
    };

    let toplam = 0;
    // 1) Manuel girişler — SADECE hedef ay
    for (const m of manuelGunler) {
      if (m.santiye_id !== santiyeId) continue;
      if (ayYilNum(m.ay) !== hedefNum) continue;
      const ucret = personelUcret(m.personel_id, m.ay, yil);
      if (ucret > 0) {
        toplam += m.gun * ucret;
        dahilEdilen.add(`${m.personel_id}|${ayStr}`);
      }
    }
    // 2) Doğal hesap (atama tarihlerinden) — SADECE hedef ay
    const ayHesap = gunHesaplaAyBazli(santiyeAtamalari, ayStr);
    for (const [pId, sMap] of ayHesap) {
      const gun = sMap.get(santiyeId) ?? 0;
      if (gun <= 0) continue;
      if (dahilEdilen.has(`${pId}|${ayStr}`)) continue;
      const ucret = personelUcret(pId, ayStr, yil);
      if (ucret > 0) toplam += gun * ucret;
    }
    return toplam;
  }, [takip?.santiye_id, ayliklar, manuelGunler, gunlukUcretler, atamalar, brutUcretGecmisi]);

  // En son ait_oldugu_ay (yüklenici tutarı boş olan satırda bordro placeholder göstermek için)
  const enYeniAyId = useMemo(() => {
    if (ayliklar.length === 0) return null;
    const ayYilNum = (s: string): number => {
      const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
      if (mm) return parseInt(mm[2]) * 100 + parseInt(mm[1]);
      return 0;
    };
    let enBuyukNum = 0;
    let enBuyukId: string | null = null;
    for (const a of ayliklar) {
      const n = ayYilNum(a.ait_oldugu_ay);
      if (n > enBuyukNum) { enBuyukNum = n; enBuyukId = a.id; }
    }
    return enBuyukId;
  }, [ayliklar]);

  if (loading) {
    return <div className="space-y-4">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>;
  }
  if (!takip) {
    return <div><p className="text-gray-500">Kayıt bulunamadı.</p></div>;
  }

  const sozlesmeBedeli = takip.santiyeler?.sozlesme_bedeli ?? 0;
  const kesifArtisi = takip.kesif_artisi ?? 0;
  const fiyatFarki = takip.fiyat_farki ?? 0;
  const iscilikOrani = takip.iscilik_orani ?? 0;
  // Yatacak Toplam Prim = (Sözleşme Bedeli + Keşif Artışı + Fiyat Farkı) × İşçilik Oranı / 100
  const yatacakToplamPrim = (sozlesmeBedeli + kesifArtisi + fiyatFarki) * iscilikOrani / 100;
  // Yatan = Yüklenici toplamı + Alt Yüklenici toplamı
  const toplamYuklenici = ayliklar.reduce((t, a) => t + (a.yuklenici_tutar ?? 0), 0);
  const toplamAltYuklenici = ayliklar.reduce((t, a) => t + (a.alt_yuklenici_tutar ?? 0), 0);
  const toplamYatan = toplamYuklenici + toplamAltYuklenici;
  // Kalan = Yatacak Toplam Prim - Yatan
  const kalanPrim = yatacakToplamPrim - toplamYatan;

  function exportDetayPDF() {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    if (!takip) return;
    doc.text(tr(takip.santiyeler?.is_adi ?? ""), 14, 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Sozlesme Bedeli: ${formatPara(sozlesmeBedeli)}  |  Iscilik Orani: %${iscilikOrani}  |  Yatacak Toplam Prim: ${formatPara(yatacakToplamPrim)}`, 14, 22);
    doc.text(`Yatan: ${formatPara(toplamYatan)}  |  Kalan: ${formatPara(kalanPrim)}`, 14, 27);
    autoTable(doc, {
      startY: 33,
      head: [["S.No", "Ait Oldugu Ay", "Alt Yuklenici Tutar", "Yuklenici Tutar"]],
      body: ayliklar.map((a, i) => [String(i + 1), a.ait_oldugu_ay, formatPara(a.alt_yuklenici_tutar), formatPara(a.yuklenici_tutar)]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save(`iscilik-detay-${takip?.sicil_no ?? "rapor"}.pdf`);
  }

  function exportDetayExcel() {
    const headers = ["S.No", "Ait Olduğu Ay", "Alt Yüklenici Tutarı", "Yüklenici Tutarı"];
    const data = ayliklar.map((a, i) => [i + 1, a.ait_oldugu_ay, a.alt_yuklenici_tutar ?? 0, a.yuklenici_tutar ?? 0]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Aylik Veriler");
    XLSX.writeFile(wb, `iscilik-detay-${takip?.sicil_no ?? "rapor"}.xlsx`);
  }

  // Üst kart düzenleme
  async function saveHeaderEdit() {
    if (!editingHeader || !takip) return;
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    // Metin alanları (sicil_no) için raw string, para alanları için parse et
    const metinAlanlari = new Set(["sicil_no"]);
    let value: string | number | null;
    if (metinAlanlari.has(editingHeader)) {
      value = headerEditValue.trim() || null;
    } else {
      const cleaned = headerEditValue.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
      value = cleaned ? parseFloat(cleaned) : null;
    }
    try {
      await upsertIscilikTakibi(takip.santiye_id, { [editingHeader]: value });
      setTakip((p) => p ? { ...p, [editingHeader]: value } as typeof p : p);
    } catch (err) {
      console.error("Header güncelleme hatası:", err);
      toast.error(`Güncelleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
    setEditingHeader(null);
  }

  function headerField(label: string, field: string, value: number | null, editable = true) {
    const isEd = editingHeader === field;
    // Yetki: yDuzenle yoksa düzenleme tamamen kapalı
    const duzenlenebilir = editable && yDuzenle;
    return (
      <div className="flex items-center justify-between py-1 border-b border-gray-100">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        {isEd ? (
          <Input ref={inputRef} value={headerEditValue}
            onChange={(e) => setHeaderEditValue(e.target.value)}
            onBlur={saveHeaderEdit}
            onKeyDown={(e) => { if (e.key === "Enter") saveHeaderEdit(); if (e.key === "Escape") setEditingHeader(null); }}
            className="h-6 text-xs w-32 text-right" />
        ) : (
          <span className={`text-xs font-semibold ${duzenlenebilir ? "cursor-pointer hover:text-[#F97316]" : ""}`}
            onClick={() => {
              if (!duzenlenebilir) return;
              setEditingHeader(field);
              setHeaderEditValue(value != null ? formatPara(value) : "");
            }}>
            {value != null ? formatPara(value) : "—"}
          </span>
        )}
      </div>
    );
  }

  // Aylık satır düzenleme + toplam yatanı otomatik güncelle
  async function saveAylikEdit() {
    if (!editing || !takip) return;
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    let value: string | number | null = editValue || null;
    if (editing.field !== "ait_oldugu_ay") {
      const cleaned = editValue.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
      value = cleaned ? parseFloat(cleaned) : 0;
    }
    try {
      await updateAylikVeri(editing.id, { [editing.field]: value });
      const yeniAyliklar = ayliklar.map((a) => a.id === editing.id ? { ...a, [editing.field]: value } : a);
      setAyliklar(yeniAyliklar);

      // Tutar değiştiyse toplam yatanı + tarihleri + toplam son veri tutarını güncelle
      if (editing.field === "yuklenici_tutar" || editing.field === "alt_yuklenici_tutar") {
        const yeniToplamYatan = yeniAyliklar.reduce((t, a) => t + (a.yuklenici_tutar ?? 0) + (a.alt_yuklenici_tutar ?? 0), 0);
        // Toplam son veri tutarı = en son girilen ayın (en büyük sıra no) yüklenici + alt yüklenici toplamı
        const sonAy = [...yeniAyliklar].sort((a, b) => b.sira_no - a.sira_no)[0];
        const toplamSonVeri = sonAy ? (sonAy.alt_yuklenici_tutar ?? 0) + (sonAy.yuklenici_tutar ?? 0) : 0;

        // Artık bu tarihler stored değil, ana sayfada aylıklardan dinamik hesaplanıyor
        // Sadece toplam bilgileri güncelle
        const updates: Record<string, unknown> = {
          yatan_prim: yeniToplamYatan,
          toplam_son_veri_tutari: toplamSonVeri,
        };

        await upsertIscilikTakibi(takip.santiye_id, updates);
        setTakip((p) => p ? { ...p, ...updates } as typeof p : p);
      }
    } catch (err) {
      console.error("İşçilik güncelleme hatası:", err);
      toast.error(`Güncelleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
    setEditing(null);
  }

  // Yeni ay ekle — KISIT: yalnız bu ayın BİR ÖNCESİNE kadar eklenebilir.
  // Bu ay 05 ise max 04 eklenir. 06 ise max 05.
  async function handleYeniAy() {
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    const sonAy = ayliklar.length > 0 ? ayliklar[ayliklar.length - 1].ait_oldugu_ay : null;
    // Bu ay - 1 hesapla
    const now = new Date();
    const buAy = now.getMonth() + 1; // 1-12
    const buYil = now.getFullYear();
    let maxAy = buAy - 1;
    let maxYil = buYil;
    if (maxAy === 0) { maxAy = 12; maxYil = buYil - 1; }
    const maxAyKey = `${String(maxAy).padStart(2, "0")}.${maxYil}`;
    const maxAyNum = maxYil * 100 + maxAy;
    // Hedef ay: son ay varsa son+1, yoksa direkt max (bu ay - 1)
    let yeniAy: string;
    if (sonAy) {
      const [ay, yil] = sonAy.split(".");
      let nextAy = parseInt(ay) + 1;
      let nextYil = parseInt(yil);
      if (nextAy > 12) { nextAy = 1; nextYil++; }
      yeniAy = `${String(nextAy).padStart(2, "0")}.${nextYil}`;
    } else {
      yeniAy = maxAyKey;
    }
    // KISIT: yeni ay maksimum "bu ay - 1" olabilir; gelecek/bu ay eklenemez
    const yeniAyNum = (() => {
      const [m, y] = yeniAy.split(".");
      return parseInt(y) * 100 + parseInt(m);
    })();
    if (yeniAyNum > maxAyNum) {
      toast.error(
        `Yeni ay yalnızca bir önceki aya kadar açılabilir. Şu an eklenebilecek son ay: ${maxAyKey}.`,
        { duration: toastSuresi() },
      );
      return;
    }

    try {
      const yeni = await createAylikVeri(takipId, ayliklar.length + 1, yeniAy);
      setAyliklar((p) => [...p, yeni]);
    } catch { toast.error("Satır eklenemedi."); }
  }

  // Satır sil
  async function handleSatirSil(id: string) {
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    try {
      await deleteAylikVeri(id);
      setAyliklar((p) => p.filter((a) => a.id !== id));
    } catch { toast.error("Silinemedi."); }
  }

  function tr(s: string): string {
    return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
      .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
      .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
  }

  return (
    <div>
      {/* Geri butonu + Export */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => router.push("/dashboard/iscilik-takibi")}>
          <ArrowLeft size={16} className="mr-1" /> İşçilik Takibi
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportDetayPDF} disabled={ayliklar.length === 0}>
            <FileDown size={16} className="mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportDetayExcel} disabled={ayliklar.length === 0}>
            <FileSpreadsheet size={16} className="mr-1" /> Excel
          </Button>
        </div>
      </div>

      {/* Üst Kart - İş Bilgileri */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          {/* İşin Adı */}
          <div className="border-b border-gray-200 pb-3 mb-3">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">İşin Adı</span>
            <h2 className="text-lg font-bold text-[#1E3A5F]">{takip.santiyeler?.is_adi ?? "—"}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0">
            {/* Sol */}
            <div>
              {/* Sicil Numarası — metin, düzenlenebilir */}
              <div className="flex items-center justify-between py-1 border-b border-gray-100">
                <span className="text-xs text-gray-500 font-medium">Sicil Numarası</span>
                {editingHeader === "sicil_no" ? (
                  <Input ref={inputRef} value={headerEditValue}
                    onChange={(e) => setHeaderEditValue(e.target.value)}
                    onBlur={saveHeaderEdit}
                    onKeyDown={(e) => { if (e.key === "Enter") saveHeaderEdit(); if (e.key === "Escape") setEditingHeader(null); }}
                    className="h-6 text-xs w-32 text-right" />
                ) : (
                  <span className={`text-xs font-semibold ${yDuzenle ? "cursor-pointer hover:text-[#F97316]" : ""}`}
                    onClick={() => {
                      if (!yDuzenle) return;
                      setEditingHeader("sicil_no");
                      setHeaderEditValue(takip.sicil_no ?? "");
                    }}>
                    {takip.sicil_no ?? "—"}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-100">
                <span className="text-xs text-gray-500 font-medium">Sözleşme Bedeli</span>
                <span className="text-xs font-semibold">{formatPara(sozlesmeBedeli)}</span>
              </div>
              {headerField("Keşif Artışı", "kesif_artisi", takip.kesif_artisi, true)}
              {headerField("Fiyat Farkı", "fiyat_farki", takip.fiyat_farki, true)}
              {headerField("İşçilik Oranı %", "iscilik_orani", takip.iscilik_orani, true)}
              <div className="flex items-center justify-between py-1 border-b border-gray-100 bg-[#F1F5F9] px-1 rounded">
                <span className="text-xs text-gray-500 font-medium">Yatacak Toplam Prim</span>
                <span className="text-xs font-bold text-[#1E3A5F]">{formatPara(yatacakToplamPrim)}</span>
              </div>
            </div>

            {/* Sağ */}
            <div>
              <div className="flex items-center justify-between py-1 border-b border-gray-100 bg-green-50 px-1 rounded">
                <span className="text-xs text-gray-500 font-medium">Yatan</span>
                <span className="text-xs font-bold text-green-700">{formatPara(toplamYatan)}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-100 bg-red-50 px-1 rounded">
                <span className="text-xs text-gray-500 font-medium">Kalan</span>
                <span className="text-xs font-bold text-red-700">{formatPara(kalanPrim)}</span>
              </div>
              {/* İş Yeri Teslim Tarihi - elle */}
              {(() => {
                const isEdBas = editingHeader === "baslangic_tarihi";
                return (
                  <div className="flex items-center justify-between py-1 border-b border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">İş Yeri Teslim Tarihi</span>
                    {isEdBas ? (
                      <Input ref={inputRef} type="date" value={headerEditValue}
                        onChange={(e) => setHeaderEditValue(e.target.value)}
                        onBlur={async () => {
                          if (!yDuzenle) { setEditingHeader(null); return; }
                          try {
                            const yeniDeger = headerEditValue || null;
                            await upsertIscilikTakibi(takip.santiye_id, { baslangic_tarihi: yeniDeger });
                            // SYNC: santiyeler tablosuna da yansıt (isyeri_teslim_tarihi)
                            try {
                              await updateSantiye(takip.santiye_id, { isyeri_teslim_tarihi: yeniDeger });
                            } catch (e) { console.warn("santiye sync hatası:", e); }
                            setTakip((p) => p ? { ...p, baslangic_tarihi: yeniDeger } : p);
                          } catch { toast.error("Güncelleme hatası."); }
                          setEditingHeader(null);
                        }}
                        onKeyDown={(e) => e.key === "Escape" && setEditingHeader(null)}
                        className="h-6 text-xs w-36" />
                    ) : (
                      <span className={`text-xs font-semibold ${yDuzenle ? "cursor-pointer hover:text-[#F97316]" : ""}`}
                        onClick={() => { if (!yDuzenle) return; setEditingHeader("baslangic_tarihi"); setHeaderEditValue(takip.baslangic_tarihi ?? ""); }}>
                        {takip.baslangic_tarihi ? formatTarih(takip.baslangic_tarihi) : "—"}
                      </span>
                    )}
                  </div>
                );
              })()}
              {/* Süre - + ile toplama */}
              {(() => {
                const isEdSure = editingHeader === "sure_text";
                const sureText = takip.sure_text ?? "";
                const sureToplam = sureText ? sureText.split("+").reduce((t, s) => t + (parseInt(s.trim()) || 0), 0) : 0;
                return (
                  <div className="flex items-center justify-between py-1 border-b border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Süre</span>
                    {isEdSure ? (
                      <Input ref={inputRef} value={headerEditValue} placeholder="100 + 200 + 300"
                        onChange={(e) => setHeaderEditValue(e.target.value)}
                        onBlur={async () => {
                          if (!yDuzenle) { setEditingHeader(null); return; }
                          try {
                            const yeniDeger = headerEditValue || null;
                            await upsertIscilikTakibi(takip.santiye_id, { sure_text: yeniDeger });
                            // SYNC: santiyeler tablosuna toplam gün sayısı olarak yansıt (is_suresi)
                            const toplamGun = yeniDeger
                              ? yeniDeger.split("+").reduce((t, s) => t + (parseInt(s.trim()) || 0), 0)
                              : null;
                            try {
                              await updateSantiye(takip.santiye_id, { is_suresi: toplamGun });
                            } catch (e) { console.warn("santiye sync hatası:", e); }
                            setTakip((p) => p ? { ...p, sure_text: yeniDeger } : p);
                          } catch { toast.error("Güncelleme hatası."); }
                          setEditingHeader(null);
                        }}
                        onKeyDown={(e) => e.key === "Escape" && setEditingHeader(null)}
                        className="h-6 text-xs w-40" />
                    ) : (
                      <span className={`text-xs font-semibold ${yDuzenle ? "cursor-pointer hover:text-[#F97316]" : ""}`}
                        onClick={() => { if (!yDuzenle) return; setEditingHeader("sure_text"); setHeaderEditValue(sureText); }}>
                        {sureText ? `${sureText} = ${sureToplam} gün` : "—"}
                      </span>
                    )}
                  </div>
                );
              })()}
              {/* Bitiş Tarihi = Başlangıç + Süre toplamı - 1 gün (başlangıç günü dahil) */}
              {(() => {
                const sureText = takip.sure_text ?? "";
                const sureToplam = sureText ? sureText.split("+").reduce((t, s) => t + (parseInt(s.trim()) || 0), 0) : 0;
                let bitisTarihi: string | null = null;
                if (takip.baslangic_tarihi && sureToplam > 0) {
                  const d = new Date(takip.baslangic_tarihi);
                  d.setDate(d.getDate() + sureToplam - 1);
                  bitisTarihi = d.toISOString().split("T")[0];
                }
                return (
                  <div className="flex items-center justify-between py-1 border-b border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Bitiş Tarihi</span>
                    <span className="text-xs font-semibold">{bitisTarihi ? formatTarih(bitisTarihi) : "—"}</span>
                  </div>
                );
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Aylık Tablo */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        {/* Yeni ay ekle butonu — tablonun üstünde (en son ay en üstte sıralama ile uyumlu) */}
        <div className="border-b p-2 flex justify-center">
          {yEkle && (
            <Button variant="outline" size="sm" onClick={handleYeniAy} className="text-[#F97316] border-[#F97316] hover:bg-[#F97316] hover:text-white">
              <Plus size={16} className="mr-1" /> Yeni Ay Ekle
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
              <TableHead className="text-white font-semibold text-center text-xs px-3 w-[50px]">S.No</TableHead>
              <TableHead className="text-white font-semibold text-center text-xs px-3 min-w-[100px]">Ait Olduğu Ay</TableHead>
              <TableHead className="text-white font-semibold text-center text-xs px-3 min-w-[180px]">Alt Yüklenici Prime Esas Kazanç Tutarı</TableHead>
              <TableHead className="text-white font-semibold text-center text-xs px-3 min-w-[180px]">Yüklenici Prime Esas Kazanç Tutarı</TableHead>
              <TableHead className="text-white font-semibold text-center text-xs px-3 w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Görüntüleme sırasını ters çevir: en son ay en üstte, ilk ay en altta.
                idx hesaplamasını orijinal sıraya göre yapıyoruz ki sıra numarası karışmasın. */}
            {[...ayliklar].reverse().map((a) => {
              const idx = ayliklar.findIndex((x) => x.id === a.id);
              return (
              <TableRow key={a.id} className="text-sm hover:bg-gray-50">
                <TableCell className="text-center px-3">{idx + 1}</TableCell>
                <TableCell className={`text-center px-3 ${yDuzenle ? "cursor-pointer hover:bg-blue-50" : ""}`}
                  onClick={() => { if (!yDuzenle) return; setEditing({ id: a.id, field: "ait_oldugu_ay" }); setEditValue(a.ait_oldugu_ay); }}>
                  {editing?.id === a.id && editing.field === "ait_oldugu_ay" ? (
                    <Input ref={inputRef} value={editValue} placeholder="MM.YYYY"
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={saveAylikEdit}
                      onKeyDown={(e) => { if (e.key === "Enter") saveAylikEdit(); if (e.key === "Escape") setEditing(null); }}
                      className="h-6 text-xs px-1 text-center w-24" />
                  ) : a.ait_oldugu_ay}
                </TableCell>

                {/* Alt Yüklenici */}
                <TableCell className={`text-right px-3 tabular-nums ${yDuzenle ? "cursor-pointer hover:bg-blue-50" : ""}`}
                  onClick={() => {
                    if (!yDuzenle) return;
                    setEditing({ id: a.id, field: "alt_yuklenici_tutar" });
                    setEditValue(a.alt_yuklenici_tutar ? formatPara(a.alt_yuklenici_tutar) : "");
                  }}>
                  {editing?.id === a.id && editing.field === "alt_yuklenici_tutar" ? (
                    <Input ref={inputRef} value={editValue} placeholder="0,00"
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={saveAylikEdit}
                      onKeyDown={(e) => { if (e.key === "Enter") saveAylikEdit(); if (e.key === "Escape") setEditing(null); }}
                      className="h-6 text-xs px-1 text-right min-w-[120px]" />
                  ) : a.alt_yuklenici_tutar ? formatPara(a.alt_yuklenici_tutar) : <span className="text-gray-300">0,00</span>}
                </TableCell>

                {/* Yüklenici */}
                <TableCell className={`text-right px-3 tabular-nums ${yDuzenle ? "cursor-pointer hover:bg-blue-50" : ""}`}
                  onClick={() => {
                    if (!yDuzenle) return;
                    setEditing({ id: a.id, field: "yuklenici_tutar" });
                    setEditValue(a.yuklenici_tutar ? formatPara(a.yuklenici_tutar) : "");
                  }}>
                  {editing?.id === a.id && editing.field === "yuklenici_tutar" ? (
                    <Input ref={inputRef} value={editValue}
                      placeholder={a.id === enYeniAyId && bordroToplam > 0 ? formatPara(bordroToplam) : "0,00"}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={saveAylikEdit}
                      onKeyDown={(e) => { if (e.key === "Enter") saveAylikEdit(); if (e.key === "Escape") setEditing(null); }}
                      className="h-6 text-xs px-1 text-right min-w-[120px]" />
                  ) : a.yuklenici_tutar ? formatPara(a.yuklenici_tutar) : (
                    a.id === enYeniAyId && bordroToplam > 0
                      ? <span className="text-gray-300" title="Bu ayın bordro tahmini (o aya ait manuel + otomatik atama günü × günlük/brüt ücret)">{formatPara(bordroToplam)}</span>
                      : <span className="text-gray-300">0,00</span>
                  )}
                </TableCell>

                {/* Sil */}
                <TableCell className="text-center px-1">
                  {ySil && (
                    <button onClick={() => handleSatirSil(a.id)} className="text-gray-300 hover:text-red-500 p-0.5">
                      <Trash2 size={12} />
                    </button>
                  )}
                </TableCell>
              </TableRow>
              );
            })}

            {ayliklar.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-400">
                  Henüz aylık veri eklenmemiş. Aşağıdaki + butonuna tıklayın.
                </TableCell>
              </TableRow>
            )}
            {/* Toplam satırı */}
            {ayliklar.length > 0 && (
              <TableRow className="bg-[#F1F5F9] font-bold text-sm">
                <TableCell className="text-center px-3" colSpan={2}>TOPLAM</TableCell>
                <TableCell className="text-right px-3 tabular-nums">
                  {formatPara(ayliklar.reduce((t, a) => t + (a.alt_yuklenici_tutar ?? 0), 0))}
                </TableCell>
                <TableCell className="text-right px-3 tabular-nums">
                  {formatPara(ayliklar.reduce((t, a) => t + (a.yuklenici_tutar ?? 0), 0))}
                </TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>

      </div>
    </div>
  );
}
