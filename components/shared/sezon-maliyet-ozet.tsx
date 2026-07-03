// Dashboard için Sezon Maliyeti özeti — şantiye + toplam (yalnız yönetici).
// Sezon Maliyeti sayfasında gizlenen (Silinenler) şantiyeler burada GÖRÜNMEZ
// (aynı PAYLAŞIMLI DB listesi okunur). Veri bu yıl bazında hesaplanır.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks";
import { getMaliyetRaporu, getMaliyetGizliSantiyeler, type MaliyetSatir } from "@/lib/supabase/queries/maliyet";
import { FileBarChart2 } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BU_YIL = new Date().getFullYear();
const CACHE_KEY = `sezon-maliyet-ozet-${BU_YIL}`;
const CACHE_TTL = 15 * 60 * 1000; // 15 dk: ağır yıl-bazlı sorgu her dashboard açılışında değil, oturumda en çok 1 kez/15dk

export default function SezonMaliyetOzet() {
  const { isYonetici, loading } = useAuth();
  const [satirlar, setSatirlar] = useState<MaliyetSatir[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);

  useEffect(() => {
    if (loading || !isYonetici) return;
    let iptal = false;
    (async () => {
      // Gizli (Silinenler) listesi PAYLAŞIMLI DB'den — gizli filtre kullanım anında uygulanır (önbellekte HAM satırlar).
      const gizli = new Set(await getMaliyetGizliSantiyeler().catch(() => []));
      if (iptal) return;
      const uygula = (ham: MaliyetSatir[]) => {
        if (iptal) return;
        setSatirlar(ham.filter((s) => !gizli.has(s.santiyeId)));
        setYukleniyor(false);
      };
      // ÖNBELLEK: 15 dk taze ise ağır yıl-bazlı sorguyu tekrar çalıştırma (dashboard her açılışında DB'yi yormasın).
      try {
        const c = sessionStorage.getItem(CACHE_KEY);
        if (c) {
          const obj = JSON.parse(c) as { ts: number; satirlar: MaliyetSatir[] };
          if (obj && Date.now() - obj.ts < CACHE_TTL && Array.isArray(obj.satirlar)) { uygula(obj.satirlar); return; }
        }
      } catch { /* yoksay → taze çek */ }
      try {
        const r = await getMaliyetRaporu(`${BU_YIL}-01-01`, `${BU_YIL}-12-31`);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), satirlar: r.satirlar })); } catch { /* kota → yoksay */ }
        uygula(r.satirlar);
      } catch { if (!iptal) setYukleniyor(false); }
    })();
    return () => { iptal = true; };
  }, [isYonetici, loading]);

  // Yalnız auth BİTTİ + yönetici DEĞİL ise gizle. Auth yüklenirken gizleme → aşağıda iskelet göster (boşluk olmasın).
  if (!loading && !isYonetici) return null;

  const toplam = satirlar.reduce((t, s) => t + s.toplam, 0);
  const bekliyor = loading || yukleniyor; // auth yükleniyor VEYA veri geliyor → iskelet

  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <FileBarChart2 size={18} className="text-rose-600" /> Sezon Maliyeti ({BU_YIL})
        </h3>
        <Link href="/dashboard/maliyet-raporu" className="text-xs text-[#1E3A5F] hover:underline">Detay →</Link>
      </div>
      {bekliyor ? (
        <div className="space-y-2.5 py-1" aria-label="Yükleniyor">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: `${45 + ((i * 13) % 35)}%` }} />
              <div className="h-4 w-16 bg-gray-200 rounded animate-pulse shrink-0" />
            </div>
          ))}
          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-gray-500">
            <span className="inline-block h-3.5 w-3.5 border-2 border-gray-300 border-t-rose-500 rounded-full animate-spin" />
            Sezon maliyeti hesaplanıyor…
          </div>
        </div>
      ) : satirlar.length === 0 ? (
        <div className="text-sm text-gray-400 py-4">Kayıt yok.</div>
      ) : (
        <div className="overflow-y-auto max-h-80">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b sticky top-0 bg-white">
                <th className="text-left py-1.5 font-semibold">Şantiye</th>
                <th className="text-right py-1.5 font-semibold">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s) => (
                <tr key={s.santiyeId} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 text-gray-800">{s.isAdi}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{fmt(s.toplam)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t-2 text-gray-900">
                <td className="py-1.5">TOPLAM</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(toplam)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
