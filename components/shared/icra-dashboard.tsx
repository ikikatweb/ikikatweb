// Dashboard İcra Takibi widget'ı — İCRAYA CEVABI VERİLMEMİŞ (İcraya Cevap Tarihi boş) dosyaları listeler.
// "Cevap Tarihi" sütunundaki "Tarih gir" butonuna tıklayıp tarih girilince kayıt güncellenir ve satır düşer.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Gavel } from "lucide-react";
import { useAuth } from "@/hooks";
import { getIcraKayitlar } from "@/lib/supabase/queries/icra";
import type { IcraKayit } from "@/lib/supabase/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "—");

export default function IcraDashboard() {
  const { isYonetici, hasPermission } = useAuth();
  const canDuzenle = isYonetici || hasPermission("icra", "duzenle");
  const [satirlar, setSatirlar] = useState<IcraKayit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let iptal = false;
    getIcraKayitlar()
      .then((r) => { if (!iptal) setSatirlar(r); })
      .catch(() => { /* tablo yoksa sessiz */ })
      .finally(() => { if (!iptal) setLoading(false); });
    return () => { iptal = true; };
  }, []);

  const bekleyen = useMemo(
    () => satirlar
      .filter((s) => !(s.cevap_tarihi ?? "").trim())
      .sort((a, b) => (a.gelen_yazi_tarihi ?? "").localeCompare(b.gelen_yazi_tarihi ?? "")),
    [satirlar],
  );

  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2 pb-2 border-b">
        <div className="flex items-center gap-2">
          <Gavel size={16} className="text-red-600" />
          <div>
            <h3 className="font-bold text-xs text-red-600 flex items-center gap-1.5">
              İcra — Cevap Bekleyen
              {bekleyen.length > 0 && <span className="bg-red-600 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5">{bekleyen.length}</span>}
            </h3>
            <p className="text-[10px] text-gray-400">İcraya cevabı verilmemiş dosyalar</p>
          </div>
        </div>
        <a href="/dashboard/icra" className="text-[11px] text-blue-600 hover:underline">Tümü →</a>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 animate-pulse">Yükleniyor...</p>
      ) : bekleyen.length === 0 ? (
        <p className="text-sm text-gray-400">Cevap bekleyen icra dosyası yok</p>
      ) : (
        <div className="max-h-[220px] overflow-y-auto">
          <Table className="text-xs text-gray-900">
            <TableHeader><TableRow>
              <TableHead className="px-2 text-[10px]">Borçlu</TableHead>
              <TableHead className="px-2 text-[10px] text-center">Gelen Tarih</TableHead>
              <TableHead className="px-2 text-[10px] text-center">Cevap Tarihi</TableHead>
              <TableHead className="px-2 text-[10px] text-right">Borç</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bekleyen.map((s) => (
                <TableRow key={s.id} className="hover:bg-red-50/40">
                  <TableCell className="px-2">
                    <div className="font-medium text-[#1E3A5F] truncate max-w-[110px]" title={s.borclu_adi ?? ""}>{s.borclu_adi ?? "—"}</div>
                    {s.dosya_esas_no && <div className="text-[9px] text-gray-400 truncate max-w-[110px]">{s.dosya_esas_no}</div>}
                  </TableCell>
                  <TableCell className="px-2 text-center whitespace-nowrap text-gray-600">{tarihGoster(s.gelen_yazi_tarihi)}</TableCell>
                  <TableCell className="px-2 text-center">
                    {canDuzenle ? (
                      <button type="button" onClick={() => { window.location.href = `/dashboard/icra?duzenle=${s.id}&kilit=1`; }}
                        className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-0.5 hover:bg-red-100">
                        Tarih gir
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 text-right tabular-nums text-red-600">{fmt(Number(s.borc_miktari || 0))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
