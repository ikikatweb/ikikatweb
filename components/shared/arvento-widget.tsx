// Dashboard widget — son Arvento raporu: araç başına bugünkü km/damper + genel ortalama karşılaştırması
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Satellite, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { getArventoSonTarih, getArventoRaporByTarih, getArventoOrtalamalar, type ArventoOrtalama } from "@/lib/supabase/queries/arvento";
import type { AracArventoRapor } from "@/lib/supabase/types";

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
const km1 = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

// Bugünkü değer vs ortalama — ok yönü/renk
function Kiyas({ bugun, ort, birim }: { bugun: number; ort: number; birim: string }) {
  const yukari = bugun > ort + 0.05;
  const asagi = bugun < ort - 0.05;
  const renk = yukari ? "text-emerald-600" : asagi ? "text-red-500" : "text-gray-400";
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span className="font-semibold text-gray-800">{km1(bugun)}{birim}</span>
      <span className={`ml-1 ${renk}`}>
        {yukari ? <ArrowUp size={9} className="inline" /> : asagi ? <ArrowDown size={9} className="inline" /> : null}
        <span className="text-[9px] text-gray-400"> ort {km1(ort)}</span>
      </span>
    </span>
  );
}

export default function ArventoWidget() {
  const [tarih, setTarih] = useState<string | null>(null);
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  const [ortalamalar, setOrtalamalar] = useState<Map<string, ArventoOrtalama>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const t = await getArventoSonTarih();
        setTarih(t);
        if (t) {
          const [k, ort] = await Promise.all([getArventoRaporByTarih(t), getArventoOrtalamalar()]);
          setKayitlar(k);
          setOrtalamalar(ort);
        }
      } catch { /* tablo yoksa sessiz */ } finally { setLoading(false); }
    })();
  }, []);

  const calisan = kayitlar.filter((k) => (k.hareket_sn ?? 0) > 0 || (k.mesafe_km ?? 0) > 0 || (k.damper_sayisi ?? 0) > 0);
  const toplamKm = kayitlar.reduce((s, k) => s + (k.mesafe_km ?? 0), 0);
  const toplamDamper = kayitlar.reduce((s, k) => s + (k.damper_sayisi ?? 0), 0);
  // Bugün km'ye göre sırala
  const liste = [...calisan].sort((a, b) => (b.mesafe_km ?? 0) - (a.mesafe_km ?? 0)).slice(0, 6);

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
            <div className="bg-orange-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-orange-700">{toplamDamper}</div>
              <div className="text-[9px] text-gray-500">Damper İndirme</div>
            </div>
          </div>
          {liste.length > 0 && (
            <div>
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 text-[9px] font-semibold text-gray-400 px-1 pb-1 border-b">
                <span>Plaka</span><span className="text-right">Km (bugün/ort)</span><span className="text-right">Damper (bugün/ort)</span>
              </div>
              {liste.map((k) => {
                const ort = ortalamalar.get(k.plaka);
                return (
                  <div key={k.id} className="grid grid-cols-[auto_1fr_1fr] gap-x-2 items-center text-xs py-1 border-b border-gray-50 last:border-0">
                    <span className="font-semibold text-[#1E3A5F]">{k.plaka}</span>
                    <span className="text-right"><Kiyas bugun={k.mesafe_km ?? 0} ort={ort?.ortKm ?? 0} birim="" /></span>
                    <span className="text-right"><Kiyas bugun={k.damper_sayisi ?? 0} ort={ort?.ortDamper ?? 0} birim="" /></span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
