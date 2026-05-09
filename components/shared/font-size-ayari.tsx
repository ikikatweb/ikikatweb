// Yazı boyutu ayarlayıcı — Safari'nin "Webpage Zoom" benzeri.
// html elementinin font-size değerini değiştirir (px). Tailwind rem-bazlı olduğu için
// tüm metin/boşluk/genişlik orantılı ölçeklenir → tarayıcı zoom etkisi.
// Tercih localStorage'da saklanır, sayfa yenilense de korunur.
"use client";

import { useEffect, useState, useRef } from "react";
import { ZoomIn, Plus, Minus } from "lucide-react";

const LS_KEY = "site-font-zoom";
// Tarayıcının varsayılan kök font-size'ı 16px. Yüzde × 16 ile çarpıyoruz.
const VARSAYILAN_PX = 16;
// 10'ar 10'ar artan/azalan adımlar
const SECENEKLER = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
const ADIM = 10;

function uygulaPx(zoomYuzde: number) {
  if (typeof document === "undefined") return;
  const px = (zoomYuzde / 100) * VARSAYILAN_PX;
  document.documentElement.style.fontSize = `${px}px`;
}

// Sayfa açılır açılmaz son seçimi uygulayan inline modüle hazır helper (opsiyonel kullanım için)
export function fontZoomBaslat() {
  if (typeof window === "undefined") return;
  try {
    const saved = window.localStorage.getItem(LS_KEY);
    if (!saved) return;
    const yuzde = parseInt(saved, 10);
    if (!Number.isFinite(yuzde) || yuzde < 50 || yuzde > 200) return;
    uygulaPx(yuzde);
  } catch { /* sessiz */ }
}

export default function FontSizeAyari() {
  const [zoomYuzde, setZoomYuzde] = useState<number>(100);
  const [acik, setAcik] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // İlk yüklemede saved değeri uygula
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LS_KEY);
      if (saved) {
        const y = parseInt(saved, 10);
        if (Number.isFinite(y) && y >= 50 && y <= 200) {
          setZoomYuzde(y);
          uygulaPx(y);
        }
      }
    } catch { /* sessiz */ }
  }, []);

  // Dış tıklama ile kapat
  useEffect(() => {
    if (!acik) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAcik(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [acik]);

  function ayarla(yeniYuzde: number) {
    const clamp = Math.max(50, Math.min(200, yeniYuzde));
    setZoomYuzde(clamp);
    uygulaPx(clamp);
    try { window.localStorage.setItem(LS_KEY, String(clamp)); } catch { /* sessiz */ }
  }

  function azalt() {
    // Mevcut değerden ADIM kadar azalt (10'a yuvarla)
    const yeni = Math.round((zoomYuzde - ADIM) / ADIM) * ADIM;
    ayarla(yeni);
  }
  function arttir() {
    // Mevcut değerden ADIM kadar arttır (10'a yuvarla)
    const yeni = Math.round((zoomYuzde + ADIM) / ADIM) * ADIM;
    ayarla(yeni);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setAcik((v) => !v)}
        className="flex items-center gap-1 p-2 rounded-md text-[#1E3A5F] hover:bg-gray-100 transition-colors"
        title={`Yazı boyutu: %${zoomYuzde}`}
        aria-label="Yazı boyutu ayarı"
      >
        <ZoomIn size={18} />
        <span className="text-[10px] font-bold tabular-nums">%{zoomYuzde}</span>
      </button>

      {acik && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 min-w-[180px]">
          <div className="text-[10px] text-gray-500 px-2 pb-1.5 font-semibold">Yazı Boyutu</div>

          {/* − / + ile hızlı ayarlama */}
          <div className="flex items-center justify-center gap-2 px-2 pb-2 border-b border-gray-100 mb-2">
            <button
              type="button"
              onClick={azalt}
              disabled={zoomYuzde <= SECENEKLER[0]}
              className="h-8 w-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-[#1E3A5F]"
              aria-label="Küçült"
            >
              <Minus size={14} />
            </button>
            <div className="text-sm font-bold text-[#1E3A5F] tabular-nums w-12 text-center">%{zoomYuzde}</div>
            <button
              type="button"
              onClick={arttir}
              disabled={zoomYuzde >= SECENEKLER[SECENEKLER.length - 1]}
              className="h-8 w-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-[#1E3A5F]"
              aria-label="Büyüt"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Hazır seçenekler — 10'ar 10'ar */}
          <div className="grid grid-cols-4 gap-1 max-h-[200px] overflow-y-auto">
            {SECENEKLER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { ayarla(s); }}
                className={`text-xs py-1.5 rounded transition-colors ${
                  zoomYuzde === s
                    ? "bg-[#1E3A5F] text-white font-bold"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                }`}
              >
                %{s}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => ayarla(100)}
            className="w-full mt-2 text-[10px] text-blue-600 hover:underline"
          >
            Varsayılana döndür (%100)
          </button>
        </div>
      )}
    </div>
  );
}
