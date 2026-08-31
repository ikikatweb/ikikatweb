// Araç Bakım → Araç Listesi
// Her aracın bakım durumunu TEK satırda gösterir: son bakım, mevcut km/saat, sıradaki bakım.
// Sıralama: FİRMA (firmalar.sira_no) → firma içinde CİNS (Tanımlamalar > arac_cinsi sırası) → plaka.
// Kapsam: ÖZ MAL araçlar — bakım kaydı yalnız bu araçlara giriliyor (bkz. arac-bakim/page.tsx).
"use client";

import { useEffect, useState, useMemo, useCallback, Fragment } from "react";
import { getAraclar } from "@/lib/supabase/queries/araclar";
import { getAracBakimlar } from "@/lib/supabase/queries/arac-bakim";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import { useAuth, useOturumFiltresi } from "@/hooks";
import type { AracBakimWithArac, AracWithRelations, Tanimlama } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListChecks, Search, FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { trAramaNormalize } from "@/lib/utils/isim";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

// Yaklaşan bakım eşikleri — cron/yaklasan-bildirim ile BİREBİR aynı olsun ki liste ile bildirim çelişmesin.
const ESIK_KM = 500;      // normal araç: son 500 km
const ESIK_SAAT = 50;     // iş makinesi: son 50 saat
const ESIK_GUN = 30;      // tarih bazlı: son 30 gün

function formatTarih(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}

function formatGosterge(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

// PDF (jsPDF helvetica) Türkçe karakterleri basamaz → sadeleştir.
function tr(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I").replace(/—/g, "-");
}

type Satir = {
  arac: AracWithRelations;
  birim: "km" | "sa";
  aracAdi: string;
  firmaAdi: string;
  sonBakimTarihi: string | null;
  sonBakimGosterge: number | null;
  sonrakiKm: number | null;
  sonrakiTarih: string | null;
  kalanGosterge: number | null;   // sonraki km/saat − mevcut  (negatif = geçti)
  kalanGun: number | null;        // sonraki tarih − bugün      (negatif = geçti)
  durum: "gecti" | "yaklasti" | "normal" | "yok";
};

export default function AracBakimListesiPage() {
  // Yetki Ayarları'da "Araç Bakım > Araç Listesi" satırı bu anahtarı yönetir (salt-okunur sayfa → görüntüle yeter).
  const { hasPermission } = useAuth();
  const yGoruntule = hasPermission("arac-bakim-arac-listesi", "goruntule");

  const [loading, setLoading] = useState(true);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [bakimlar, setBakimlar] = useState<AracBakimWithArac[]>([]);
  const [cinsSiralama, setCinsSiralama] = useState<Map<string, number>>(new Map());
  // Filtreler oturum-içi: F5'te korunur, sayfadan çıkıp dönünce sıfırlanır.
  const [arama, setArama] = useOturumFiltresi("bakim-arac-listesi:arama", "");
  const [durumFiltre, setDurumFiltre] = useOturumFiltresi<"tumu" | "aktif" | "pasif">("bakim-arac-listesi:durum", "aktif");
  const [bakimDurumFiltre, setBakimDurumFiltre] = useOturumFiltresi<"tumu" | "gecti" | "yaklasti" | "yok">("bakim-arac-listesi:bakim-durum", "tumu");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aData, bData, cinsData] = await Promise.all([
        getAraclar(),
        getAracBakimlar().catch(() => [] as AracBakimWithArac[]),
        getTanimlamalar("arac_cinsi").catch(() => [] as Tanimlama[]),
      ]);
      setAraclar((aData as AracWithRelations[]) ?? []);
      setBakimlar(bData ?? []);
      const sMap = new Map<string, number>();
      ((cinsData as Tanimlama[]) ?? []).forEach((t, i) => sMap.set(t.deger, i));
      setCinsSiralama(sMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Araç → SON BAKIM kaydı. Yalnız tip="bakim" (periyodik bakım) sayılır; tamirat/yedek parça
  // "son bakım" değildir — yaklaşan bakım bildirimi de aynı kuralı kullanır.
  const sonBakimMap = useMemo(() => {
    const m = new Map<string, AracBakimWithArac>();
    for (const b of bakimlar) {
      if (b.tip !== "bakim") continue;
      const mevcut = m.get(b.arac_id);
      if (!mevcut || (b.bakim_tarihi ?? "") > (mevcut.bakim_tarihi ?? "")) m.set(b.arac_id, b);
    }
    return m;
  }, [bakimlar]);

  const bugunMs = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }, []);

  const satirlar = useMemo<Satir[]>(() => {
    return araclar
      .filter((a) => a.tip === "ozmal")
      .map((a) => {
        const b = sonBakimMap.get(a.id);
        const saatMi = a.sayac_tipi === "saat";
        const birim: "km" | "sa" = saatMi ? "sa" : "km";
        const sonrakiKm = b?.sonraki_bakim_km ?? null;
        const sonrakiTarih = b?.sonraki_bakim_tarihi ?? null;
        const kalanGosterge = sonrakiKm != null && a.guncel_gosterge != null ? sonrakiKm - a.guncel_gosterge : null;
        const kalanGun = sonrakiTarih
          ? Math.ceil((new Date(sonrakiTarih + "T00:00:00").getTime() - bugunMs) / 86400000)
          : null;
        const esik = saatMi ? ESIK_SAAT : ESIK_KM;
        let durum: Satir["durum"] = "yok";
        if (sonrakiKm != null || sonrakiTarih != null) {
          const gecti = (kalanGosterge != null && kalanGosterge < 0) || (kalanGun != null && kalanGun < 0);
          const yaklasti = (kalanGosterge != null && kalanGosterge <= esik) || (kalanGun != null && kalanGun <= ESIK_GUN);
          durum = gecti ? "gecti" : yaklasti ? "yaklasti" : "normal";
        }
        return {
          arac: a,
          birim,
          aracAdi: [a.marka, a.model].filter(Boolean).join(" ") || "—",
          firmaAdi: a.firmalar?.firma_adi ?? "Firma atanmamış",
          sonBakimTarihi: b?.bakim_tarihi ?? null,
          sonBakimGosterge: b?.km ?? null,
          sonrakiKm, sonrakiTarih, kalanGosterge, kalanGun, durum,
        };
      });
  }, [araclar, sonBakimMap, bugunMs]);

  // FİRMA (sira_no) → CİNS (tanımlama sırası) → PLAKA. Sıra numarası olmayan firma/cins en sona.
  const filtrelenmis = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    return satirlar
      .filter((s) => {
        if (durumFiltre === "aktif" && s.arac.durum !== "aktif") return false;
        if (durumFiltre === "pasif" && s.arac.durum === "aktif") return false;
        if (bakimDurumFiltre === "gecti" && s.durum !== "gecti") return false;
        if (bakimDurumFiltre === "yaklasti" && s.durum !== "yaklasti") return false;
        if (bakimDurumFiltre === "yok" && s.durum !== "yok") return false;
        if (q) {
          const metin = trAramaNormalize([s.arac.plaka, s.aracAdi, s.arac.cinsi ?? "", s.firmaAdi].join(" "));
          if (!metin.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const fa = a.arac.firmalar?.sira_no ?? 9999, fb = b.arac.firmalar?.sira_no ?? 9999;
        if (fa !== fb) return fa - fb;
        const fad = a.firmaAdi.localeCompare(b.firmaAdi, "tr");   // aynı sıra no → ada göre
        if (fad !== 0) return fad;
        const ca = cinsSiralama.get(a.arac.cinsi ?? "") ?? 999, cb = cinsSiralama.get(b.arac.cinsi ?? "") ?? 999;
        if (ca !== cb) return ca - cb;
        return (a.arac.plaka ?? "").localeCompare(b.arac.plaka ?? "", "tr");
      });
  }, [satirlar, arama, durumFiltre, bakimDurumFiltre, cinsSiralama]);

  // Firma değişiminde araya başlık satırı koy → uzun listede hangi firmada olduğun kaybolmasın.
  const firmaBaslikIdx = useMemo(() => {
    const s = new Set<number>();
    let onceki: string | null = null;
    filtrelenmis.forEach((r, i) => { if (r.firmaAdi !== onceki) { s.add(i); onceki = r.firmaAdi; } });
    return s;
  }, [filtrelenmis]);

  const durumRozet = (s: Satir) => {
    if (s.durum === "yok") return <span className="text-gray-400">—</span>;
    const cls = s.durum === "gecti" ? "bg-red-100 text-red-700 border-red-200"
      : s.durum === "yaklasti" ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";
    const parcalar: string[] = [];
    if (s.sonrakiKm != null) parcalar.push(`${formatGosterge(s.sonrakiKm)} ${s.birim}`);
    if (s.sonrakiTarih) parcalar.push(formatTarih(s.sonrakiTarih));
    const notlar: string[] = [];
    if (s.kalanGosterge != null) notlar.push(s.kalanGosterge < 0 ? `${formatGosterge(-s.kalanGosterge)} ${s.birim} geçti` : `${formatGosterge(s.kalanGosterge)} ${s.birim} kaldı`);
    if (s.kalanGun != null) notlar.push(s.kalanGun < 0 ? `${-s.kalanGun} gün geçti` : `${s.kalanGun} gün kaldı`);
    return (
      <div className={`inline-block text-center px-1.5 py-1 rounded border text-[11px] ${cls}`}>
        {parcalar.join(" · ")}
        {notlar.length > 0 && <span className="block text-[9px] opacity-80">{notlar.join(" · ")}</span>}
      </div>
    );
  };

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Arac Bakim Listesi", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length} arac`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["No", "Firma", "Cinsi", "Plaka", "Arac Adi", "Son Bakim", "Mevcut Km/Saat", "Siradaki Bakim"]],
      body: filtrelenmis.map((s, i) => [
        String(i + 1), tr(s.firmaAdi), tr(s.arac.cinsi ?? "-"), s.arac.plaka, tr(s.aracAdi),
        tr(`${formatTarih(s.sonBakimTarihi)}${s.sonBakimGosterge != null ? ` (${formatGosterge(s.sonBakimGosterge)} ${s.birim})` : ""}`),
        tr(`${formatGosterge(s.arac.guncel_gosterge)} ${s.birim}`),
        tr([s.sonrakiKm != null ? `${formatGosterge(s.sonrakiKm)} ${s.birim}` : null, s.sonrakiTarih ? formatTarih(s.sonrakiTarih) : null].filter(Boolean).join(" / ") || "-"),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("arac-bakim-listesi.pdf");
  }

  function exportExcel() {
    const headers = ["No", "Firma", "Cinsi", "Plaka", "Araç Adı", "Son Bakım", "Son Bakım Km/Saat", "Mevcut Km/Saat", "Sıradaki Bakım Km/Saat", "Sıradaki Bakım Tarihi", "Durum"];
    const durumAd = { gecti: "Geçti", yaklasti: "Yaklaştı", normal: "Normal", yok: "Kayıt yok" } as const;
    const data = filtrelenmis.map((s, i) => [
      i + 1, s.firmaAdi, s.arac.cinsi ?? "", s.arac.plaka, s.aracAdi,
      formatTarih(s.sonBakimTarihi), s.sonBakimGosterge ?? "", s.arac.guncel_gosterge ?? "",
      s.sonrakiKm ?? "", s.sonrakiTarih ? formatTarih(s.sonrakiTarih) : "", durumAd[s.durum],
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arac Bakim Listesi");
    XLSX.writeFile(wb, "arac-bakim-listesi.xlsx");
  }

  if (!yGoruntule) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <ListChecks size={24} /> Araç Listesi
        </h1>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Arama</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Plaka, araç, cins, firma..." className="pl-8 h-9 w-52" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Araç Durumu</Label>
          <select value={durumFiltre} onChange={(e) => setDurumFiltre(e.target.value as typeof durumFiltre)} className={selectClass}>
            <option value="aktif">Aktif</option>
            <option value="pasif">Pasif</option>
            <option value="tumu">Tümü</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Bakım Durumu</Label>
          <select value={bakimDurumFiltre} onChange={(e) => setBakimDurumFiltre(e.target.value as typeof bakimDurumFiltre)} className={selectClass}>
            <option value="tumu">Tümü</option>
            <option value="gecti">Bakım zamanı geçti</option>
            <option value="yaklasti">Bakımı yaklaştı</option>
            <option value="yok">Sıradaki bakım girilmemiş</option>
          </select>
        </div>
        <div className="flex gap-1 items-end ml-auto">
          <span className="text-xs text-gray-400 mr-2">{filtrelenmis.length} öz mal araç</span>
          <Button variant="outline" size="sm" onClick={exportPDF} className="h-9 gap-1 text-xs">
            <FileDown size={14} /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs">
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <ListChecks size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Bu filtrelerle araç bulunamadı.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2 w-10">No</TableHead>
                <TableHead
                  style={{ position: "sticky", left: 0, zIndex: 21, backgroundColor: "#64748B" }}
                  className="text-white text-[11px] px-2 shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                >Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Araç Adı</TableHead>
                <TableHead className="text-white text-[11px] px-2">Cinsi</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center min-w-[120px]">Son Bakım</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right min-w-[110px]">Mevcut Km/Saat</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center min-w-[150px]">Sıradaki Bakım</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((s, i) => (
                <Fragment key={s.arac.id}>
                  {firmaBaslikIdx.has(i) && (
                    <TableRow className="bg-[#EEF2F7] hover:bg-[#EEF2F7]">
                      <TableCell colSpan={7} className="px-2 py-1.5 font-semibold text-[#1E3A5F] text-[11px]">
                        {s.firmaAdi}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className="hover:bg-gray-50">
                    <TableCell className="px-2 text-center text-gray-400">{i + 1}</TableCell>
                    <TableCell
                      style={{ position: "sticky", left: 0, backgroundColor: "white" }}
                      className="px-2 font-bold text-[#1E3A5F] shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                    >{s.arac.plaka}</TableCell>
                    <TableCell className="px-2">{s.aracAdi}</TableCell>
                    <TableCell className="px-2 text-gray-500">{s.arac.cinsi ?? "—"}</TableCell>
                    <TableCell className="px-2 text-center">
                      {s.sonBakimTarihi ? (
                        <>
                          {formatTarih(s.sonBakimTarihi)}
                          {s.sonBakimGosterge != null && (
                            <span className="block text-[9px] text-gray-400">{formatGosterge(s.sonBakimGosterge)} {s.birim}</span>
                          )}
                        </>
                      ) : <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">
                      {s.arac.guncel_gosterge != null
                        ? <>{formatGosterge(s.arac.guncel_gosterge)} <span className="text-gray-400">{s.birim}</span></>
                        : <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="px-2 text-center">{durumRozet(s)}</TableCell>
                  </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
