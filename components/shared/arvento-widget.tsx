// Dashboard widget — son Arvento raporunun özeti (çalışan araç, toplam km, en çok yol yapanlar)
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Satellite, Route, ChevronRight } from "lucide-react";
import { getArventoSonTarih, getArventoRaporByTarih } from "@/lib/supabase/queries/arvento";
import type { AracArventoRapor } from "@/lib/supabase/types";

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function formatSure(sn: number | null): string {
  if (!sn) return "0";
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  return sa > 0 ? `${sa}sa ${dk}dk` : `${dk}dk`;
}

export default function ArventoWidget() {
  const [tarih, setTarih] = useState<string | null>(null);
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const t = await getArventoSonTarih();
        setTarih(t);
        if (t) setKayitlar(await getArventoRaporByTarih(t));
      } catch { /* tablo yoksa sessiz */ } finally { setLoading(false); }
    })();
  }, []);

  const calisan = kayitlar.filter((k) => (k.hareket_sn ?? 0) > 0 || (k.mesafe_km ?? 0) > 0);
  const toplamKm = kayitlar.reduce((s, k) => s + (k.mesafe_km ?? 0), 0);
  const enCok = [...calisan].sort((a, b) => (b.mesafe_km ?? 0) - (a.mesafe_km ?? 0)).slice(0, 5);

  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Satellite size={16} className="text-[#1E3A5F]" />
          <h3 className="font-bold text-sm text-[#1E3A5F]">Arvento Araç Çalışma</h3>
        </div>
        <Link href="/dashboard/araclar/arvento-raporu" className="text-[11px] text-blue-600 hover:underline flex items-center">
          Tümü <ChevronRight size={12} />
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div>
      ) : !tarih ? (
        <p className="text-xs text-gray-400 py-4 text-center">Henüz Arvento raporu yok.</p>
      ) : (
        <>
          <div className="text-[10px] text-gray-400 mb-2">{formatTarih(tarih)} raporu</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-emerald-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-emerald-700">{calisan.length}</div>
              <div className="text-[9px] text-gray-500">Çalışan Araç</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-blue-700">{toplamKm.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</div>
              <div className="text-[9px] text-gray-500">Toplam km</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-gray-700">{kayitlar.length}</div>
              <div className="text-[9px] text-gray-500">Toplam Araç</div>
            </div>
          </div>
          {enCok.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-500 flex items-center gap-1"><Route size={11} /> En çok yol yapanlar</div>
              {enCok.map((k) => (
                <div key={k.id} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-50 last:border-0">
                  <span className="font-semibold text-[#1E3A5F]">{k.plaka}</span>
                  <span className="text-gray-500 text-[10px] truncate px-1 flex-1">{k.surucu ?? ""}</span>
                  <span className="tabular-nums">{(k.mesafe_km ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km</span>
                  <span className="tabular-nums text-gray-400 text-[10px] ml-2 w-16 text-right">{formatSure(k.hareket_sn)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
