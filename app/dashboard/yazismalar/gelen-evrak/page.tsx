// Gelen Evrak sayfası - Liste, filtre, yazdır, kopyala, düzenle, sil
"use client";

import { useEffect, useState, useCallback } from "react";
import { getGelenEvraklar, softDeleteGelenEvrak } from "@/lib/supabase/queries/gelen-evrak";
import { trAramaNormalize } from "@/lib/utils/isim";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { useAuth } from "@/hooks";
import type { GelenEvrakWithRelations, Firma } from "@/lib/supabase/types";
import GelenEvrakForm from "@/components/shared/gelen-evrak-form";
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
import { Plus, Mail, Pencil, Trash2, FileDown, FileSpreadsheet, Eye, FileText } from "lucide-react";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
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

// Uzun metni N karakterden sonra "..." ile kısalt. Tabloda satırın taşmasını önler.
function kisalt(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "..." : s;
}

const selectClass = "h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function GelenEvrakPage() {
  const { kullanici, isYonetici, hasPermission, loading: authLoading } = useAuth();
  const yEkle = hasPermission("yazismalar-gelen-evrak", "ekle");
  const yDuzenle = hasPermission("yazismalar-gelen-evrak", "duzenle");
  const ySil = hasPermission("yazismalar-gelen-evrak", "sil");
  const [evraklar, setEvraklar] = useState<GelenEvrakWithRelations[]>([]);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editEvrak, setEditEvrak] = useState<GelenEvrakWithRelations | undefined>();
  const [silDialog, setSilDialog] = useState<string | null>(null);
  const [silmeNedeni, setSilmeNedeni] = useState("");
  // Ek görüntüleme dialog — bir evraka ait tüm PDF eklerini listeler
  const [ekDialog, setEkDialog] = useState<GelenEvrakWithRelations | null>(null);

  // Bir evraka ait EK PDF'lerini toplar (sadece `ekler` alanındaki URL satırları).
  // NOT: `pdf_url` (Üst Yazı) bu listeye dahil DEĞİLDİR — o ayrı sütunda gösterilir.
  function ekUrlleri(e: GelenEvrakWithRelations): { url: string; isim: string }[] {
    const liste: { url: string; isim: string }[] = [];
    if (e.ekler) {
      const satirlar = e.ekler.split("\n").map((s) => s.trim()).filter(Boolean);
      let sayac = 1;
      for (const satir of satirlar) {
        if (/^https?:\/\//i.test(satir)) {
          let isim = `Ek ${sayac}`;
          try {
            const path = new URL(satir).pathname;
            const raw = decodeURIComponent(path.split("/").pop() ?? "");
            // Timestamp prefix'i temizle: "123456789-dosya.pdf" → "dosya.pdf"
            isim = raw.replace(/^\d+-/, "") || isim;
          } catch { /* kullanma — varsayılan isim kalır */ }
          liste.push({ url: satir, isim });
          sayac++;
        }
      }
    }
    return liste;
  }

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
  // Muhatap filtresi — aranabilir + seçilebilir dropdown için ek state'ler
  const [fMuhatapArama, setFMuhatapArama] = useState("");
  const [fMuhatapDropdownAcik, setFMuhatapDropdownAcik] = useState(false);

  const loadData = useCallback(async () => {
    // KRİTİK: Auth bilgisi yüklenmeden veri çekme. Aksi halde santiye_admin/kısıtlı
    // kullanıcılar için filtre uygulanmadan TÜM evraklar gelir (sonra doğru filtre
    // uygulanınca azalır → kısa süreli güvenlik açığı görünümü).
    if (authLoading || !kullanici) return;
    try {
      // Kısıtlı: kendi yazdıklarını + atandığı şantiyelerin evraklarını
      // Şantiye admin: atandığı şantiyelerin tüm evraklarını
      // Yönetici: hepsi
      // santiyesiz_veri_gor: true → şantiye atanmamış (NULL) evrakları da görür.
      const olusturan = (kullanici.rol === "kisitli") ? kullanici.id : undefined;
      const santiyeFilter = (!isYonetici && kullanici.santiye_ids) ? kullanici.santiye_ids : undefined;
      const santiyesizDahil = !!kullanici.santiyesiz_veri_gor;
      const [eData, fData] = await Promise.all([
        getGelenEvraklar(olusturan, santiyeFilter, santiyesizDahil),
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
      setEvraklar(((eData as GelenEvrakWithRelations[]) ?? []).filter((e) =>
        izinliFirmaIds ? (!e.firma_id || izinliFirmaIds.has(e.firma_id)) : true,
      ));
      setFirmalar(filtreliFirmalar);
    } catch { toast.error("Veriler yüklenirken hata oluştu."); }
    finally { setLoading(false); }
  }, [authLoading, isYonetici, kullanici?.id, kullanici?.rol, kullanici?.santiye_ids, kullanici?.firma_ids, kullanici?.santiyesiz_veri_gor]);

  useEffect(() => { loadData(); }, [loadData]);

  // NOT: Antet/kaşe ön belleği için DOM'a hidden <img> mount ediliyor (aşağıda).
  // new Image() byte cache'liyor ama decode bitmeden print snapshot alınıyordu.

  // Listede kayıtlı olan benzersiz muhataplar (filtre dropdown'u için)
  const kayitliMuhataplar = Array.from(
    new Set(
      evraklar
        .map((e) => (e.muhatap ?? "").trim())
        .filter((m) => m.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, "tr"));

  // Listede kayıtlı olan benzersiz firma id'leri (filtre dropdown'u için)
  const kayitliFirmaIds = new Set(
    evraklar.map((e) => e.firma_id).filter((id): id is string => !!id),
  );

  // Filtreleme
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
        e.konu,
        e.muhatap,
        e.firmalar?.firma_adi,
        e.kullanicilar?.ad_soyad,
        e.icerik,
        e.ilgi,
        formatTarih(e.evrak_tarihi),
      ].filter(Boolean).join(" "));
      if (!text.includes(q)) return false;
    }
    return true;
  });

  function handleAdd() { setEditEvrak(undefined); setFormOpen(true); }
  function handleEdit(e: GelenEvrakWithRelations) { setEditEvrak(e); setFormOpen(true); }

  async function handleSil() {
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    if (!silDialog || !silmeNedeni.trim()) { toast.error("Silme nedeni zorunludur."); return; }
    try {
      await softDeleteGelenEvrak(silDialog, silmeNedeni, kullanici?.id ?? null);
      setEvraklar((p) => p.filter((e) => e.id !== silDialog));
      toast.success("Evrak silindi.");
    } catch { toast.error("Silme hatası."); }
    finally { setSilDialog(null); setSilmeNedeni(""); }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Gelen Evrak Listesi", 14, 15);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length}`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Tarih", "Sayi No", "Firma", "Konu", "Muhatap", "Olusturan"]],
      body: filtrelenmis.map((e) => [
        tr(formatTarih(e.evrak_tarihi)), tr(e.evrak_sayi_no),
        tr(e.firmalar?.firma_adi ?? ""), tr(e.konu), tr(e.muhatap ?? ""),
        tr(e.kullanicilar?.ad_soyad ?? ""),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("gelen-evrak-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["Tarih", "Sayı No", "Firma", "Konu", "Muhatap", "Oluşturan", "Oluşturma Tarihi"];
    const data = filtrelenmis.map((e) => [
      formatTarih(e.evrak_tarihi), e.evrak_sayi_no,
      e.firmalar?.firma_adi ?? "", e.konu, e.muhatap ?? "",
      e.kullanicilar?.ad_soyad ?? "", formatTarihSaat(e.olusturma_tarihi),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gelen Evrak");
    XLSX.writeFile(wb, "gelen-evrak-listesi.xlsx");
  }

  return (
    <div>
      {/* Başlık */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">Gelen Evrak</h1>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {yEkle && (
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleAdd}>
              <Plus size={16} className="mr-1" /> Yeni Gelen Evrak
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
          placeholder="Genel arama: sayı no, konu, muhatap, firma, oluşturan, ilgi, içerik..."
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
          <select value={fFirma} onChange={(e) => setFFirma(e.target.value)} className={selectClass + " h-8 text-xs w-full min-w-0"}>
            <option value="">Tümü</option>
            {/* Sadece gelen evrak kaydı olan firmaları göster */}
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
              Liste sadece gelen evraklarda kullanılmış muhatapları içerir. */}
          <div className="relative">
            <input
              type="text"
              value={fMuhatapArama || (fMuhatap ? tekSatirMuhatap(fMuhatap) : "")}
              onChange={(e) => {
                setFMuhatapArama(e.target.value);
                setFMuhatapDropdownAcik(true);
                // Kullanıcı yazmaya başladıysa önceki seçimi temizle
                if (fMuhatap) setFMuhatap("");
              }}
              onFocus={() => setFMuhatapDropdownAcik(true)}
              onBlur={() => setTimeout(() => setFMuhatapDropdownAcik(false), 150)}
              placeholder="Ara veya seç..."
              className="h-8 text-xs w-full min-w-0 rounded-lg border border-input bg-white px-2 pr-7 outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
            />
            {/* X — seçimi/aramayı temizle */}
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
          <Mail size={48} className="mx-auto text-gray-300 mb-4" />
          {evraklar.length === 0 ? (
            // Hiç evrak yok — filtre kaynaklı değil
            <div>
              <p className="text-gray-500 mb-2">Görüntülenebilir gelen evrak yok.</p>
              {!isYonetici && (
                <div className="text-[11px] text-gray-400 max-w-md mx-auto space-y-1">
                  <p>Eğer evrakların görünmesini bekliyorsanız:</p>
                  <ul className="text-left list-disc pl-4 inline-block">
                    {kullanici?.rol === "kisitli" && (
                      <li>Kısıtlı kullanıcısınız: <strong>SADECE kendi yazdığınız evraklar</strong> görünür.</li>
                    )}
                    {(!kullanici?.santiye_ids || kullanici.santiye_ids.length === 0) && (
                      <li>Atanmış bir şantiyeniz yok — yöneticiden şantiye ataması isteyin.</li>
                    )}
                    {kullanici?.santiye_ids && kullanici.santiye_ids.length > 0 && (
                      <li>Atanmış {kullanici.santiye_ids.length} şantiyenizdeki evraklar görünür. Evrakların doğru şantiyeye kayıtlı olduğundan emin olun.</li>
                    )}
                    {!kullanici?.santiyesiz_veri_gor && (
                      <li>Şantiye atanmamış (genel) evrakları görmek için yöneticiden &quot;Şantiyesiz verileri görsün&quot; yetkisi isteyin.</li>
                    )}
                    {kullanici?.firma_ids && kullanici.firma_ids.length > 0 && (
                      <li>{kullanici.firma_ids.length} firmaya kapsamlı erişiminiz var. Diğer firmaların evrakları gizlidir.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            // Filtre yüzünden boş
            <p className="text-gray-500">Filtre sonucu eşleşen evrak yok. Filtreyi temizleyin veya değiştirin.</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[75vh]">
          {/* min-w-[1100px] — tablo dar ekranlarda (mobile/tablet) bu genişliğe sıkışmaz,
              container'dan geniş olur → overflow-auto sayesinde yatay kaydırma çalışır.
              Tüm sütunlara (Belge Tarihi, Sayı No, Firma, Konu, Muhatap, Üst Yazı, Ek, Oluşturan, İşlemler) erişim sağlar. */}
          <Table noWrapper className="min-w-[1100px]">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-xs px-2">Belge Tarihi</TableHead>
                <TableHead className="text-white text-xs px-2">Sayı No</TableHead>
                <TableHead className="text-white text-xs px-2">Firma</TableHead>
                <TableHead className="text-white text-xs px-2">Konu</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">Muhatap</TableHead>
                <TableHead className="text-white text-xs px-2 text-center w-[90px]">Üst Yazı</TableHead>
                <TableHead className="text-white text-xs px-2 text-center w-[60px]">Ek</TableHead>
                <TableHead className="text-white text-xs px-2">Oluşturan</TableHead>
                <TableHead className="text-white text-xs px-2 text-center">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((e) => (
                <TableRow key={e.id} className="text-xs hover:bg-gray-50">
                  <TableCell className="px-2 whitespace-nowrap">{formatTarih(e.evrak_tarihi)}</TableCell>
                  {/* Sayı No: JS ile 35 karakterden sonra "..." eklenir.
                      CSS truncate KULLANMA — yoksa JS'in eklediği "..." CSS tarafından kesiliyor. */}
                  <TableCell className="px-2 whitespace-nowrap font-medium" title={e.evrak_sayi_no}>
                    {kisalt(e.evrak_sayi_no, 35)}
                  </TableCell>
                  <TableCell className="px-2 max-w-[120px] truncate" title={e.firmalar?.firma_adi ?? ""}>{e.firmalar?.firma_adi ?? "—"}</TableCell>
                  {/* Konu: 60 karakter / 200px sınır — taşmaz, scrollbar çıkmaz. */}
                  <TableCell className="px-2 max-w-[200px] truncate" title={e.konu}>
                    {kisalt(e.konu, 60)}
                  </TableCell>
                  {/* Muhatap: tek satır (tekSatirMuhatap) + 40 char kısaltma + max-w truncate (taşma koruması) */}
                  <TableCell className="px-2 max-w-[200px] truncate leading-snug" title={e.muhatap ?? ""}>
                    {e.muhatap ? kisalt(tekSatirMuhatap(e.muhatap), 40) : "—"}
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    {e.pdf_url ? (
                      <a
                        href={e.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center p-1 text-gray-500 hover:text-[#1E3A5F]"
                        title="Üst yazıyı görüntüle"
                      >
                        <Eye size={16} />
                      </a>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    {(() => {
                      const urls = ekUrlleri(e);
                      if (urls.length === 0) {
                        return <span className="text-gray-300 text-xs">—</span>;
                      }
                      if (urls.length === 1) {
                        return (
                          <a
                            href={urls[0].url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center p-1 text-gray-500 hover:text-[#1E3A5F]"
                            title={`Eki görüntüle: ${urls[0].isim}`}
                          >
                            <Eye size={16} />
                          </a>
                        );
                      }
                      // Birden fazla ek → dialog ile listele
                      return (
                        <button
                          type="button"
                          onClick={() => setEkDialog(e)}
                          className="relative inline-flex items-center justify-center p-1 text-gray-500 hover:text-[#1E3A5F]"
                          title={`${urls.length} ek dosya — görüntüle`}
                        >
                          <Eye size={16} />
                          <span className="absolute -top-1 -right-1 bg-[#F97316] text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] px-0.5 flex items-center justify-center leading-none">
                            {urls.length}
                          </span>
                        </button>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="px-2">
                    <div>
                      <div className="font-medium">{e.kullanicilar?.ad_soyad ?? "—"}</div>
                      <div className="text-[10px] text-gray-400">{formatTarihSaat(e.olusturma_tarihi)}</div>
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      {yDuzenle && (
                        <button onClick={() => handleEdit(e)} className="p-1 text-gray-400 hover:text-[#F97316]" title="Düzenle"><Pencil size={14} /></button>
                      )}
                      {ySil && (
                        <button onClick={() => { setSilDialog(e.id); setSilmeNedeni(""); }} className="p-1 text-gray-400 hover:text-red-500" title="Sil"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Evrak Form Dialog — boşluğa tıklayınca kapanmaz */}
      <Dialog open={formOpen} onOpenChange={setFormOpen} disablePointerDismissal>
        <DialogContent className="!w-[95vw] md:!w-[50vw] !max-w-none max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editEvrak?.id ? "Evrak Düzenle" : "Yeni Gelen Evrak"}</DialogTitle>
          </DialogHeader>
          {(() => {
            const cogaltKey = (editEvrak as unknown as { _cogaltKey?: number } | null)?._cogaltKey;
            const formKey = editEvrak?.id
              ? `edit-${editEvrak.id}`
              : cogaltKey
              ? `cogalt-${cogaltKey}`
              : "yeni";
            return (
              <GelenEvrakForm
                key={formKey}
                evrak={editEvrak ?? undefined}
                onSuccess={() => { setFormOpen(false); loadData(); }}
                onCancel={() => setFormOpen(false)}
              />
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Ek Dosyalar Dialog — birden fazla PDF varsa tıklanınca liste görünür */}
      <Dialog open={!!ekDialog} onOpenChange={() => setEkDialog(null)}>
        <DialogContent className="max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Eklenen Belgeler</DialogTitle>
          </DialogHeader>
          {ekDialog && (() => {
            const urls = ekUrlleri(ekDialog);
            return (
              <div className="space-y-1.5 py-2 min-w-0">
                {/* Konu — çok uzun konular dialog'u taşırmasın: 60 karakterde kısalt + break-words güvenliği */}
                <p className="text-xs text-gray-500 mb-2 break-words" title={ekDialog.konu}>
                  <span className="font-semibold">{kisalt(ekDialog.konu, 60)}</span> · {urls.length} dosya
                </p>
                {urls.map((item, i) => (
                  <a
                    key={i}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-300 text-sm text-[#1E3A5F] transition-colors min-w-0"
                  >
                    <FileText size={14} className="flex-shrink-0 text-red-600" />
                    {/* Dosya adı 20 karakter sonra kısaltılır + truncate koruması */}
                    <span className="truncate flex-1 min-w-0" title={item.isim}>
                      {kisalt(item.isim, 20)}
                    </span>
                    <Eye size={14} className="flex-shrink-0 text-gray-400" />
                  </a>
                ))}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEkDialog(null)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Silme Nedeni Dialog */}
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

    </div>
  );
}
