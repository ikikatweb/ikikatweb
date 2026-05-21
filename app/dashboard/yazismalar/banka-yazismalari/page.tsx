// Banka Yazışmaları sayfası - Liste, filtre, yazdır, çoğalt, düzenle, sil
"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal, flushSync } from "react-dom";
import { getBankaYazismalari, softDeleteBankaYazisma, createBankaYazisma, getBankaYazismaSayiNo } from "@/lib/supabase/queries/banka-yazismalari";
import { trAramaNormalize } from "@/lib/utils/isim";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { useAuth } from "@/hooks";
import type { BankaYazismaWithRelations, Firma } from "@/lib/supabase/types";
import BankaYazismaForm from "@/components/shared/banka-yazisma-form";
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
import { Plus, Landmark, Printer, Copy, Pencil, Trash2, FileDown, FileSpreadsheet, Download, Zap } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import BankaYazismaOnIzleme from "@/components/shared/banka-yazisma-onizleme";
import HizliTalimatDialog from "@/components/shared/hizli-talimat-dialog";
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

export default function BankaYazismalariPage() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  const yEkle = hasPermission("yazismalar-banka-yazismalari", "ekle");
  const yDuzenle = hasPermission("yazismalar-banka-yazismalari", "duzenle");
  const ySil = hasPermission("yazismalar-banka-yazismalari", "sil");
  const [yazismalar, setYazismalar] = useState<BankaYazismaWithRelations[]>([]);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [loading, setLoading] = useState(true);

  // Form dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editYazisma, setEditYazisma] = useState<BankaYazismaWithRelations | undefined>();

  // Hızlı talimat dialog
  const [hizliTalimatOpen, setHizliTalimatOpen] = useState(false);

  // Silme dialog'u
  const [silDialog, setSilDialog] = useState<BankaYazismaWithRelations | null>(null);
  const [silmeNedeni, setSilmeNedeni] = useState("");

  // Yazdırma için seçili yazışma
  const [printRef, setPrintRef] = useState<BankaYazismaWithRelations | null>(null);

  // Filtreler — URL'den ?ara=... ile başlat (bildirimden tıklanarak gelindiğinde)
  const [fArama, setFArama] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ara") ?? ""
      : ""
  );
  const [fBaslangic, setFBaslangic] = useState("");
  const [fBitis, setFBitis] = useState("");
  const [fFirma, setFFirma] = useState("");
  const [fMuhatap, setFMuhatap] = useState("");
  // Muhatap filtresi — aranabilir + seçilebilir dropdown state'leri
  const [fMuhatapArama, setFMuhatapArama] = useState("");
  const [fMuhatapDropdownAcik, setFMuhatapDropdownAcik] = useState(false);
  const [fOlusturan, setFOlusturan] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [yData, fData] = await Promise.all([
        getBankaYazismalari(isYonetici ? undefined : kullanici?.id),
        getFirmalar(),
      ]);
      // Firma kapsamı: kullanıcının firma_ids'i tanımlıysa sadece o firmalar görünür.
      // (Rol fark etmez. firma_ids null/boş ise tümüne erişir.)
      const izinliFirmaIds = (kullanici?.firma_ids && kullanici.firma_ids.length > 0)
        ? new Set(kullanici.firma_ids)
        : null;
      const filtreliFirmalar = izinliFirmaIds
        ? (fData ?? []).filter((f) => izinliFirmaIds.has(f.id))
        : (fData ?? []);
      // KISITLI KULLANICI: kendi yazdığı yazıyı FIRMA filtresinden bağımsız görür
      // (firma ataması sonradan değişse veya o firma izinli listede olmasa bile).
      const benimId = kullanici?.id;
      setYazismalar(((yData as BankaYazismaWithRelations[]) ?? []).filter((y) =>
        izinliFirmaIds
          ? (!y.firma_id || izinliFirmaIds.has(y.firma_id) || y.olusturan_id === benimId)
          : true,
      ));
      setFirmalar(filtreliFirmalar);
    } catch { toast.error("Veriler yüklenirken hata oluştu."); }
    finally { setLoading(false); }
  }, [isYonetici, kullanici?.id, kullanici?.firma_ids]);

  useEffect(() => { loadData(); }, [loadData]);

  // NOT: Antet/kaşe ön belleği için DOM'a hidden <img> mount ediliyor (aşağıda).
  // new Image() byte cache'liyor ama decode bitmeden print snapshot alınıyordu.

  // Oluşturan kullanıcı listesini çıkar
  const olusturanlar = Array.from(
    new Map(yazismalar.filter((y) => y.kullanicilar?.ad_soyad).map((y) => [y.olusturan_id, y.kullanicilar!.ad_soyad])).entries()
  ).map(([id, ad]) => ({ id, ad }));

  // Firma id → renk map'i (Firma sütunu kaldırıldı, renk şeridi için kullanılır)
  const firmaRenkMap = new Map<string, string>();
  for (const f of firmalar) {
    if (f.renk) firmaRenkMap.set(f.id, f.renk);
  }

  // Listede en az 1 banka yazışması olan firma id'leri (filtre dropdown'u için)
  const kayitliFirmaIds = new Set(
    yazismalar.map((y) => y.firma_id).filter((id): id is string => !!id),
  );

  // Listede kayıtlı olan benzersiz muhataplar (filtre dropdown'u için)
  const kayitliMuhataplar = Array.from(
    new Set(
      yazismalar
        .map((y) => (y.muhatap ?? "").trim())
        .filter((m) => m.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, "tr"));

  const filtrelenmis = yazismalar.filter((y) => {
    if (fBaslangic && y.evrak_tarihi < fBaslangic) return false;
    if (fBitis && y.evrak_tarihi > fBitis) return false;
    if (fFirma && y.firma_id !== fFirma) return false;
    // Muhatap filtresi artık tam eşleşme (dropdown'dan seçilen değer)
    if (fMuhatap && (y.muhatap ?? "") !== fMuhatap) return false;
    if (fOlusturan && y.olusturan_id !== fOlusturan) return false;
    if (fArama.trim()) {
      const q = trAramaNormalize(fArama);
      const text = trAramaNormalize([
        y.evrak_sayi_no,
        y.konu,
        y.muhatap,
        y.firmalar?.firma_adi,
        y.kullanicilar?.ad_soyad,
        y.metin,
        formatTarih(y.evrak_tarihi),
      ].filter(Boolean).join(" "));
      if (!text.includes(q)) return false;
    }
    return true;
  });

  function handleAdd() { setEditYazisma(undefined); setFormOpen(true); }
  function handleEdit(y: BankaYazismaWithRelations) { setEditYazisma(y); setFormOpen(true); }

  async function handleCogalt(y: BankaYazismaWithRelations) {
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    // Çoğalt: form açmadan, mevcut yazışmanın bir kopyasını otomatik kayıt eder.
    // Yeni sayı no üretilir; oluşturma tarihi anlık.
    try {
      const yeniSayiNo = await getBankaYazismaSayiNo(y.firma_id, y.muhatap_id ?? null).catch(() => "");
      const payload = {
        evrak_tarihi: new Date().toISOString().slice(0, 10),
        tarih_gosterim: null,
        firma_id: y.firma_id,
        evrak_sayi_no: yeniSayiNo,
        konu: y.konu,
        muhatap: y.muhatap ?? null,
        muhatap_id: y.muhatap_id ?? null,
        ilgi_listesi: y.ilgi_listesi ?? [],
        metin: y.metin ?? null,
        ekler: y.ekler ?? [],
        kase_dahil: y.kase_dahil ?? false,
        pdf_url: null,
        olusturan_id: kullanici?.id ?? "",
        olusturma_tarihi: new Date().toISOString(),
        silindi: false,
        silme_nedeni: null,
      };
      await createBankaYazisma(payload);
      await loadData();
      toast.success("Yazışma çoğaltıldı (yeni kayıt oluşturuldu).");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu";
      toast.error(`Çoğaltma hatası: ${msg}`);
    }
  }

  async function handleSil() {
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    if (!silDialog || !silmeNedeni.trim()) { toast.error("Silme nedeni zorunludur."); return; }
    try {
      await softDeleteBankaYazisma(silDialog.id, silmeNedeni, kullanici?.id ?? null);
      setYazismalar((p) => p.filter((y) => y.id !== silDialog.id));
      toast.success("Yazışma silindi.");
    } catch { toast.error("Silme hatası."); }
    finally { setSilDialog(null); setSilmeNedeni(""); }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Banka Yazismalari Listesi", 14, 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length}`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Tarih", "Sayi No", "Firma", "Konu", "Muhatap", "Olusturan"]],
      body: filtrelenmis.map((y) => [
        tr(formatTarih(y.evrak_tarihi)), tr(y.evrak_sayi_no),
        tr(y.firmalar?.firma_adi ?? ""), tr(y.konu),
        tr((y.muhatap ?? "").replace(/\n/g, " ")),
        tr(y.kullanicilar?.ad_soyad ?? ""),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("banka-yazismalari-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Tarih", "Sayı No", "Firma", "Konu", "Muhatap", "Oluşturan", "Oluşturma Tarihi"];
    const data = filtrelenmis.map((y) => [
      formatTarih(y.evrak_tarihi), y.evrak_sayi_no,
      y.firmalar?.firma_adi ?? "", y.konu, (y.muhatap ?? "").replace(/\n/g, " "),
      y.kullanicilar?.ad_soyad ?? "", formatTarihSaat(y.olusturma_tarihi),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Banka Yazismalari");
    XLSX.writeFile(wb, "banka-yazismalari-listesi.xlsx");
  }

  function printYazisma(y: BankaYazismaWithRelations) {
    // iOS Safari user-gesture korunmalı — flushSync ile senkron render
    flushSync(() => {
      setPrintRef(y);
    });
    window.print();
    setTimeout(() => setPrintRef(null), 1000);
  }

  return (
    <div>
      {/* Başlık */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Banka Yazışmaları</h1>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {yEkle && (
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleAdd}>
              <Plus size={16} className="mr-1" /> Yeni Banka Yazışma Ekle
            </Button>
          )}
          <Button className="bg-[#64748B] hover:bg-[#2a4f7a] text-white" onClick={() => setHizliTalimatOpen(true)}>
            <Zap size={16} className="mr-1" /> Hızlı Talimat
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} disabled={filtrelenmis.length === 0}>
            <FileDown size={16} className="mr-1" /> Listeyi Yazdır (PDF)
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={16} className="mr-1" /> Excel İndir
          </Button>
        </div>
      </div>

      {/* Genel Arama */}
      <div className="mb-3">
        <Input
          value={fArama}
          onChange={(e) => setFArama(e.target.value)}
          placeholder="Genel arama: sayı no, konu, muhatap, firma, oluşturan, metin..."
          className="h-9"
        />
      </div>

      {/* Filtreler — mobilde tek sütun (alt alta), tarihler küçük max-genişlikte */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3 mb-4">
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
          <select value={fFirma} onChange={(e) => setFFirma(e.target.value)} className={selectClass + " h-8 text-xs w-full min-w-0"}>
            <option value="">Tümü</option>
            {/* Sadece banka yazışması olan firmaları göster */}
            {firmalar
              .filter((f) => kayitliFirmaIds.has(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>{f.firma_adi}</option>
              ))}
          </select>
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] text-gray-400">Muhatap</Label>
          {/* Aranabilir + seçilebilir dropdown — yazıp süzebilir veya tıklayıp seçebilir.
              Liste sadece banka yazışmalarında kullanılmış muhatapları içerir. */}
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
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-400">Oluşturan</Label>
          <select value={fOlusturan} onChange={(e) => setFOlusturan(e.target.value)} className={selectClass + " h-8 text-xs w-full"}>
            <option value="">Tümü</option>
            {olusturanlar.map((o) => (
              <option key={o.id} value={o.id}>{o.ad}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />)}</div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Landmark size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{yazismalar.length === 0 ? "Henüz banka yazışması eklenmemiş." : "Filtreye uygun kayıt bulunamadı."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          {/* border-separate border-spacing-0: Tailwind preflight tabloya border-collapse: collapse uyguluyor,
              bu position: sticky'nin <th> üzerinde çalışmasını engelliyor. border-separate sticky'i etkinleştirir. */}
          <Table noWrapper className="min-w-[1000px] border-separate border-spacing-0">
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
                <TableHead className="text-white text-xs px-2">Konu</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">Muhatap</TableHead>
                <TableHead className="text-white text-xs px-2">Oluşturan</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((y) => (
                <TableRow key={y.id} className="text-xs hover:bg-gray-50">
                  {/* Tarih hücresinin solunda firma rengi şeridi (Firma sütunu kaldırıldı).
                      sticky left-0 INLINE — header sticky'nin (z:100) altında kalsın (z:5). */}
                  <TableCell
                    className="px-2 whitespace-nowrap"
                    style={{ position: "sticky", left: 0, zIndex: 5, backgroundColor: "white" }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-1 self-stretch rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: firmaRenkMap.get(y.firma_id ?? "") ?? "#e5e7eb",
                          minHeight: "1.25rem",
                        }}
                        title={y.firmalar?.firma_adi ?? "Firma yok"}
                      />
                      <span>{formatTarih(y.evrak_tarihi)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 whitespace-nowrap font-mono text-[10px]">{y.evrak_sayi_no}</TableCell>
                  <TableCell className="px-2 max-w-[200px] truncate" title={y.konu}>{y.konu}</TableCell>
                  <TableCell className="px-2 leading-snug">
                    {y.muhatap ? tekSatirMuhatap(y.muhatap) : "—"}
                  </TableCell>
                  <TableCell className="px-2">
                    <div>
                      <div className="font-medium">{y.kullanicilar?.ad_soyad ?? "—"}</div>
                      <div className="text-[10px] text-gray-400">{formatTarihSaat(y.olusturma_tarihi)}</div>
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button onClick={() => printYazisma(y)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Yazdır"><Printer size={14} /></button>
                      {yEkle && (
                        <button onClick={() => handleCogalt(y)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Çoğalt"><Copy size={14} /></button>
                      )}
                      {y.pdf_url && (
                        <a href={y.pdf_url} target="_blank" rel="noopener noreferrer" className="p-1 text-gray-400 hover:text-green-600" title="PDF İndir"><Download size={14} /></a>
                      )}
                      {yDuzenle && (
                        <button onClick={() => handleEdit(y)} className="p-1 text-gray-400 hover:text-[#F97316]" title="Düzenle"><Pencil size={14} /></button>
                      )}
                      {ySil && (
                        <button onClick={() => { setSilDialog(y); setSilmeNedeni(""); }} className="p-1 text-gray-400 hover:text-red-500" title="Sil"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Form Dialog — boşluğa tıklayınca kapanmaz */}
      <Dialog open={formOpen} onOpenChange={setFormOpen} disablePointerDismissal>
        <DialogContent className="!w-[95vw] md:!w-[50vw] !max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editYazisma?.id ? "Banka Yazışma Düzenle" : "Yeni Banka Yazışması"}</DialogTitle>
          </DialogHeader>
          {(() => {
            const cogaltKey = (editYazisma as unknown as { _cogaltKey?: number } | null)?._cogaltKey;
            const formKey = editYazisma?.id
              ? `edit-${editYazisma.id}`
              : cogaltKey
              ? `cogalt-${cogaltKey}`
              : "yeni";
            return (
              <BankaYazismaForm
                key={formKey}
                yazisma={editYazisma ?? undefined}
                onSuccess={() => { setFormOpen(false); loadData(); }}
                onCancel={() => setFormOpen(false)}
              />
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Silme Nedeni Dialog */}
      <Dialog open={!!silDialog} onOpenChange={() => setSilDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yazışma Silme</DialogTitle>
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

      {/* Hızlı Talimat Dialog */}
      <HizliTalimatDialog
        open={hizliTalimatOpen}
        onOpenChange={setHizliTalimatOpen}
        onSuccess={loadData}
      />

      {/* GİZLİ PRE-RENDER: tüm firmaların antet/kaşe görselleri offscreen mount edilir.
          Tarayıcı bunları gerçekten decode edip cache'ler — print snapshot'ta anında çıksın. */}
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

      {/* Yazdırma için — Portal ile body'nin direkt çocuğu olarak render edilir
          (CSS body > .evrak-print-area kuralı bu sayede eşleşir) */}
      {printRef && typeof document !== "undefined" && createPortal(
        <div className="evrak-print-portal evrak-print-area">
          <BankaYazismaOnIzleme
            firma={printRef.firmalar ?? null}
            evrakTarihi={printRef.evrak_tarihi}
            evrakSayiNo={printRef.evrak_sayi_no}
            konu={printRef.konu}
            muhatap={printRef.muhatap}
            ilgiListesi={printRef.ilgi_listesi ?? []}
            metin={printRef.metin}
            ekler={printRef.ekler ?? []}
            kaseDahil={printRef.kase_dahil ?? false}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
