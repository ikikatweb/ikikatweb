// Arvento Araç Çalışma Raporu — günlük rapor (Plaka, Mesafe, Süre, Hız)
"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useAuth } from "@/hooks";
import { getArventoTarihler, getArventoRaporByTarih, getArventoOrtalamalar, getPlakaSantiyeMap, plakaNorm, type ArventoOrtalama, type PlakaSantiye } from "@/lib/supabase/queries/arvento";
import type { AracArventoRapor } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Satellite, Search, Upload, FileSpreadsheet, RefreshCw, Gauge, Route, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { trAramaNormalize } from "@/lib/utils/isim";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// saniye → "2sa 15dk" / "—"
function formatSure(sn: number | null): string {
  if (sn == null) return "—";
  if (sn === 0) return "0";
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  if (sa > 0) return `${sa}sa ${dk}dk`;
  return `${dk}dk`;
}

function formatKm(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

export default function ArventoRaporPage() {
  const { hasPermission } = useAuth();
  const yGor = hasPermission("araclar-arvento-raporu", "goruntule");
  const yEkle = hasPermission("araclar-arvento-raporu", "ekle");

  const [loading, setLoading] = useState(true);
  const [tarihler, setTarihler] = useState<string[]>([]);
  const [seciliTarih, setSeciliTarih] = useState<string>("");
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  const [ortalamalar, setOrtalamalar] = useState<Map<string, ArventoOrtalama>>(new Map());
  const [plakaSantiye, setPlakaSantiye] = useState<Map<string, PlakaSantiye>>(new Map());
  const [arama, setArama] = useState("");
  const [aktifSekme, setAktifSekme] = useState<"calisma" | "genel">("calisma");
  const [yukleniyor, setYukleniyor] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTarihler = useCallback(async () => {
    try {
      const t = await getArventoTarihler();
      setTarihler(t);
      setSeciliTarih((prev) => prev || t[0] || "");
    } catch { /* sessiz */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTarihler(); }, [loadTarihler]);

  const loadKayitlar = useCallback(async () => {
    if (!seciliTarih) { setKayitlar([]); return; }
    try {
      const [k, ort, ps] = await Promise.all([
        getArventoRaporByTarih(seciliTarih),
        getArventoOrtalamalar(),
        getPlakaSantiyeMap(seciliTarih),
      ]);
      setKayitlar(k);
      setOrtalamalar(ort);
      setPlakaSantiye(ps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("arac_arvento_rapor")) {
        toast.error("arac_arvento_rapor tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
      }
    }
  }, [seciliTarih]);

  useEffect(() => { loadKayitlar(); }, [loadKayitlar]);

  // Manuel Excel yükleme
  async function dosyaYukle(file: File) {
    setYukleniyor(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/arvento", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "İçe aktarılamadı");
      toast.success(data.mesaj ?? "İçe aktarıldı.", { duration: toastSuresi() });
      await loadTarihler();
      // İçe aktarılan ilk çalışma günü (yoksa ilk damper günü) seçili olsun
      const yeniTarih: string | undefined = data.calismaGunler?.[0]?.tarih ?? data.damperGunler?.[0]?.tarih;
      if (yeniTarih) setSeciliTarih(yeniTarih);
      await loadKayitlar();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`, { duration: toastSuresi() });
    } finally {
      setYukleniyor(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Mevcut tarihler arasında gün gün gezinme (sola = eski, sağa = yeni)
  const tarihlerAsc = useMemo(() => [...tarihler].sort(), [tarihler]);
  const tarihIdx = tarihlerAsc.indexOf(seciliTarih);
  function gunGez(delta: number) {
    const j = tarihIdx + delta;
    if (j >= 0 && j < tarihlerAsc.length) setSeciliTarih(tarihlerAsc[j]);
  }

  const filtrelenmis = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    if (!q) return kayitlar;
    return kayitlar.filter((k) =>
      trAramaNormalize([k.plaka, k.surucu, k.marka, k.model].filter(Boolean).join(" ")).includes(q),
    );
  }, [kayitlar, arama]);

  const ozet = useMemo(() => {
    const toplamKm = filtrelenmis.reduce((s, k) => s + (k.mesafe_km ?? 0), 0);
    const calisan = filtrelenmis.filter((k) => (k.hareket_sn ?? 0) > 0 || (k.mesafe_km ?? 0) > 0 || (k.damper_sayisi ?? 0) > 0).length;
    const toplamHareket = filtrelenmis.reduce((s, k) => s + (k.hareket_sn ?? 0), 0);
    const toplamDamper = filtrelenmis.reduce((s, k) => s + (k.damper_sayisi ?? 0), 0);
    return { sayi: filtrelenmis.length, calisan, toplamKm, toplamHareket, toplamDamper };
  }, [filtrelenmis]);

  // Şantiye bazlı gruplama (plaka → araç puantaj şantiyesi)
  const gruplar = useMemo(() => {
    const m = new Map<string, AracArventoRapor[]>();
    for (const k of filtrelenmis) {
      const ad = plakaSantiye.get(plakaNorm(k.plaka))?.santiyeAdi ?? "Eşleşmedi";
      if (!m.has(ad)) m.set(ad, []);
      m.get(ad)!.push(k);
    }
    const arr = Array.from(m.entries()).map(([ad, list]) => ({
      ad,
      kayitlar: [...list].sort((a, b) => (b.mesafe_km ?? 0) - (a.mesafe_km ?? 0)),
      toplamKm: list.reduce((s, k) => s + (k.mesafe_km ?? 0), 0),
      toplamDamper: list.reduce((s, k) => s + (k.damper_sayisi ?? 0), 0),
      calisan: list.filter((k) => (k.mesafe_km ?? 0) > 0 || (k.hareket_sn ?? 0) > 0 || (k.damper_sayisi ?? 0) > 0).length,
    }));
    const sona = (x: string) => (x === "Atanmamış" || x === "Eşleşmedi" ? 1 : 0);
    arr.sort((a, b) => sona(a.ad) - sona(b.ad) || b.toplamKm - a.toplamKm || a.ad.localeCompare(b.ad, "tr"));
    return arr;
  }, [filtrelenmis, plakaSantiye]);

  function exportExcel() {
    const headers = ["Şantiye", "Plaka", "Sürücü", "Marka", "Model", "Mesafe (km)", "Gen. Ort Km", "Damper", "Gen. Ort Damper", "Hareket Süresi", "Kontak Açık", "Rölanti", "Maks Hız (km/s)"];
    // Şantiye gruplarına göre sıralı dök
    const data = gruplar.flatMap((g) => g.kayitlar.map((k) => {
      const ort = ortalamalar.get(k.plaka);
      return [
        g.ad, k.plaka, k.surucu ?? "", k.marka ?? "", k.model ?? "",
        k.mesafe_km ?? "", ort ? Number(ort.ortKm.toFixed(1)) : "", k.damper_sayisi ?? 0, ort ? Number(ort.ortDamper.toFixed(1)) : "",
        formatSure(k.hareket_sn), formatSure(k.kontak_sn), formatSure(k.rolanti_sn), k.maks_hiz ?? "",
      ];
    }));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arvento");
    XLSX.writeFile(wb, `arvento-${seciliTarih}.xlsx`);
  }

  if (!yGor) {
    return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }
  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Satellite size={24} /> Arvento Araç Çalışma Raporu
          </h1>
          <p className="text-xs text-gray-500 mt-1">Her gece otomatik gelen rapordan araç bazlı mesafe ve çalışma süreleri.</p>
        </div>
        {yEkle && (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) dosyaYukle(f); }} />
            <Button size="sm" variant="outline" className="gap-1" disabled={yukleniyor}
              onClick={() => fileRef.current?.click()}>
              {yukleniyor ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
              Excel Yükle
            </Button>
          </div>
        )}
      </div>

      {/* Filtreler + özet */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Rapor Tarihi</Label>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => gunGez(-1)} disabled={tarihIdx <= 0}
              title="Önceki gün" className="h-9 w-8 flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            <select value={seciliTarih} onChange={(e) => setSeciliTarih(e.target.value)} className={selectClass + " min-w-[160px]"}>
              {tarihler.length === 0 && <option value="">Kayıt yok</option>}
              {tarihler.map((t) => <option key={t} value={t}>{formatTarih(t)}</option>)}
            </select>
            <button type="button" onClick={() => gunGez(1)} disabled={tarihIdx < 0 || tarihIdx >= tarihlerAsc.length - 1}
              title="Sonraki gün" className="h-9 w-8 flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Ara</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={arama} onChange={(e) => setArama(e.target.value)}
              placeholder="Plaka, sürücü, marka..." className={selectClass + " pl-8 w-52"} />
          </div>
        </div>
        <div className="ml-auto flex items-end gap-4">
          <div className="text-xs text-gray-600 text-right leading-relaxed">
            <div>Araç: <strong>{ozet.sayi}</strong> · Çalışan: <strong className="text-emerald-700">{ozet.calisan}</strong></div>
            <div>Toplam: <strong className="text-[#1E3A5F]">{formatKm(ozet.toplamKm)} km</strong> · Damper: <strong className="text-orange-600">{ozet.toplamDamper}</strong> · Hareket: <strong>{formatSure(ozet.toplamHareket)}</strong></div>
          </div>
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs" disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {/* Sekmeler */}
      <div className="flex gap-1 mb-3 border-b">
        {([["calisma", "Araç Çalışma Raporu"], ["genel", "Genel Rapor (Damper)"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setAktifSekme(key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              aktifSekme === key ? "border-[#1E3A5F] text-[#1E3A5F]" : "border-transparent text-gray-400 hover:text-gray-600"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tablo */}
      {filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Satellite size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{seciliTarih ? "Bu tarihte kayıt yok." : "Henüz rapor yok. Excel yükleyin veya gece otomatik gelmesini bekleyin."}</p>
        </div>
      ) : aktifSekme === "calisma" ? (
        // ---- SEKME 1: ARAÇ ÇALIŞMA RAPORU (km / süre) ----
        <div className="bg-white rounded-lg border overflow-auto max-h-[75vh]">
          <Table noWrapper>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Araç</TableHead>
                <TableHead className="text-white text-[11px] px-2">Sürücü</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Damper</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right"><Route size={12} className="inline" /> Mesafe (km)</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Gen. Ort Km</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right"><Clock size={12} className="inline" /> Hareket</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Kontak Açık</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Rölanti</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right"><Gauge size={12} className="inline" /> Maks Hız</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gruplar.map((g) => (
                <Fragment key={g.ad}>
                  <TableRow className="bg-blue-50 hover:bg-blue-50">
                    <TableCell colSpan={10} className="px-2 py-1.5 text-[12px] font-bold text-[#1E3A5F]">
                      📍 {g.ad}
                      <span className="ml-2 text-[10px] font-normal text-gray-500">{g.kayitlar.length} araç · çalışan {g.calisan} · {formatKm(g.toplamKm)} km · {g.toplamDamper} damper</span>
                    </TableCell>
                  </TableRow>
                  {g.kayitlar.map((k) => {
                    const calisti = (k.hareket_sn ?? 0) > 0 || (k.mesafe_km ?? 0) > 0;
                    const ort = ortalamalar.get(k.plaka);
                    const kmFark = (k.mesafe_km ?? 0) - (ort?.ortKm ?? 0);
                    const farkClass = (f: number) => f > 0.05 ? "text-emerald-600" : f < -0.05 ? "text-red-500" : "text-gray-400";
                    return (
                      <TableRow key={k.id} className={`text-xs hover:bg-gray-50 ${calisti ? "" : "opacity-50"}`}>
                        <TableCell className="px-2 pl-4 font-bold text-[#1E3A5F] whitespace-nowrap">{k.plaka}</TableCell>
                        <TableCell className="px-2 text-gray-600 max-w-[150px] truncate">{[k.marka, k.model].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="px-2 max-w-[130px] truncate">{k.surucu ?? "—"}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums font-semibold text-orange-600">{k.damper_sayisi ?? 0}</TableCell>
                        <TableCell className={`px-2 text-right tabular-nums font-semibold ${farkClass(kmFark)}`}>{formatKm(k.mesafe_km)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-400">{ort ? formatKm(ort.ortKm) : "—"}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums">{formatSure(k.hareket_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-500">{formatSure(k.kontak_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-500">{formatSure(k.rolanti_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums">{k.maks_hiz != null ? `${k.maks_hiz} km/s` : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        // ---- SEKME 2: GENEL RAPOR (Damper İndirme) ----
        <div className="bg-white rounded-lg border overflow-auto max-h-[75vh]">
          <Table noWrapper>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Araç</TableHead>
                <TableHead className="text-white text-[11px] px-2">Sürücü</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Damper İndirme</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Genel Ortalama</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gruplar.map((g) => (
                <Fragment key={g.ad}>
                  <TableRow className="bg-blue-50 hover:bg-blue-50">
                    <TableCell colSpan={5} className="px-2 py-1.5 text-[12px] font-bold text-[#1E3A5F]">
                      📍 {g.ad}
                      <span className="ml-2 text-[10px] font-normal text-gray-500">{g.kayitlar.length} araç · {g.toplamDamper} damper indirme</span>
                    </TableCell>
                  </TableRow>
                  {g.kayitlar.map((k) => {
                    const ort = ortalamalar.get(k.plaka);
                    const dmpFark = (k.damper_sayisi ?? 0) - (ort?.ortDamper ?? 0);
                    const farkClass = dmpFark > 0.05 ? "text-emerald-600" : dmpFark < -0.05 ? "text-red-500" : "text-gray-400";
                    return (
                      <TableRow key={k.id} className={`text-xs hover:bg-gray-50 ${(k.damper_sayisi ?? 0) > 0 ? "" : "opacity-50"}`}>
                        <TableCell className="px-2 pl-4 font-bold text-[#1E3A5F] whitespace-nowrap">{k.plaka}</TableCell>
                        <TableCell className="px-2 text-gray-600 max-w-[150px] truncate">{[k.marka, k.model].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="px-2 max-w-[130px] truncate">{k.surucu ?? "—"}</TableCell>
                        <TableCell className={`px-2 text-right tabular-nums font-semibold text-base ${farkClass}`}>{k.damper_sayisi ?? 0}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-400">{ort ? ort.ortDamper.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
