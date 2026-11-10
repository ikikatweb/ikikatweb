// "VERİ YOK" EKRANINDAKİ SESSİZ CİHAZ UYARISI.
//
// Haritadaki kırmızı rozet (lib/arvento/sessiz-uyari.ts) yalnız harita çizildiğinde görünür.
// Ama o günün hiç verisi yoksa sekme haritayı değil "veri yok" kutusunu gösteriyor — yani
// uyarının EN GEREKLİ olduğu anda (veri neden yok?) ortadan kayboluyordu. Bu kutu tam oraya
// aynı bilgiyi koyar: hangi aracın cihazı ne zamandır susuyor.
"use client";

import { useState } from "react";
import { hataMetni } from "@/lib/utils/hata-metni";
import { sessizSure, sessizSonZaman, SESSIZ_ESIK_SAAT, type SessizCihaz } from "@/lib/arvento/cihaz-sessiz";

export function SessizUyariKutu({
  cihazlar,
  onBeklemede,
}: {
  cihazlar?: SessizCihaz[];
  /** "beklemede" — araç zaten çalışmıyorsa uyarıyı gizler. Verilmezse düğme çizilmez. */
  onBeklemede?: (s: SessizCihaz) => Promise<void>;
}) {
  const [bekleyen, setBekleyen] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  if (!cihazlar || cihazlar.length === 0) return null;

  // Yazma başarısızsa SESSİZ GEÇİLMEZ: düğmeye basıp hiçbir şey olmadığını sanmak,
  // uyarının gizlendiğini sanıp arızayı kaçırmaktan beter.
  const bas = async (s: SessizCihaz) => {
    if (!onBeklemede) return;
    setBekleyen(s.plaka); setHata(null);
    try { await onBeklemede(s); }
    catch (e) { setHata(hataMetni(e)); }
    finally { setBekleyen(null); }
  };

  return (
    <div className="mt-4 mx-auto max-w-[420px] text-left bg-red-50 border border-red-200 rounded-lg p-3">
      <div className="text-[12px] font-semibold text-red-800 mb-1.5">
        ⚠ {cihazlar.length} aracın takip cihazından veri gelmiyor
      </div>
      <div className="max-h-40 overflow-auto">
        {cihazlar.map((s) => (
          <div key={s.plaka} className="text-[11px] py-0.5 border-t border-red-100 first:border-t-0 flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <b className="text-gray-800">{s.plaka}</b>
              {s.model && <span className="text-gray-500"> {s.model}</span>}
              <span className="text-red-700"> · {sessizSure(s.saat)}</span>
              <span className="text-gray-500"> · son: {sessizSonZaman(s.son)}</span>
            </div>
            {onBeklemede && s.node && (
              <button
                type="button"
                onClick={() => bas(s)}
                disabled={bekleyen === s.plaka}
                title="Bu araç zaten çalışmıyor — uyarıyı gizle"
                className="flex-none text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                {bekleyen === s.plaka ? "…" : "beklemede"}
              </button>
            )}
          </div>
        ))}
      </div>
      {hata && <div className="text-[10px] text-red-700 mt-1.5 font-semibold">Gizlenemedi: {hata}</div>}
      <div className="text-[10px] text-gray-500 mt-1.5">
        {SESSIZ_ESIK_SAAT} saattir tek paket göndermeyen cihazlar. Bu araçların çalışması rapora da girmez.
        {onBeklemede && " Çalışmayan araç için “beklemede”ye basın; cihaz tekrar susarsa uyarı geri gelir."}
      </div>
    </div>
  );
}
