// Evrak/yazışma ön izlemelerini mobilde ekrana sığacak şekilde ölçekleyen sarmalayıcı.
// 210mm sabit genişlikteki sayfa içeriği geniş ekranda olduğu gibi gösterilir;
// dar ekranlarda CSS transform: scale ile küçültülerek yatay kaydırma ihtiyacı
// ortadan kaldırılır. Yazdırma sırasında scale otomatik sıfırlanır (print CSS).
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// SSR'da useLayoutEffect uyarısını engellemek için
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// 210mm CSS pixel karşılığı (1mm = 3.7795275591 px). A4 sayfa genişliği.
const SAYFA_GENISLIK_PX = 210 * 3.7795275591; // ≈ 793.7

export default function PreviewScaler({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [innerHeight, setInnerHeight] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    const hesapla = () => {
      // İki kaynak: container.clientWidth VE window.innerWidth tabanlı tahmin.
      // Her zaman küçüğü kullan — bu sayede dialog kapalıyken veya
      // ölçüm hatalıyken yine doğru ölçek elde edilir.
      const containerW = container.clientWidth || 0;
      const viewportW = window.innerWidth;
      // Tahmin: dialog padding/margin için ekran genişliğinin %85'i
      const tahminW = Math.max(280, Math.floor(viewportW * 0.85));
      const efektifW = containerW > 50 ? Math.min(containerW, viewportW) : tahminW;
      const yeniScale = Math.min(1, efektifW / SAYFA_GENISLIK_PX);
      setScale(yeniScale);
      // Ölçekli yüksekliği container'a ata — sayfa altı boşluk oluşmasın
      setInnerHeight(inner.offsetHeight * yeniScale);
    };

    // İlk hesap; layout finalize olduktan sonra bir kez daha çalıştır
    hesapla();
    const t1 = setTimeout(hesapla, 50);
    const t2 = setTimeout(hesapla, 200);

    const ro = new ResizeObserver(hesapla);
    ro.observe(container);
    ro.observe(inner);
    window.addEventListener("resize", hesapla);
    window.addEventListener("orientationchange", hesapla);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      window.removeEventListener("resize", hesapla);
      window.removeEventListener("orientationchange", hesapla);
    };
  }, []);

  // Yazdırma sırasında scale sıfırlanır
  useEffect(() => {
    const onBefore = () => setPrinting(true);
    const onAfter = () => setPrinting(false);
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const aktifScale = printing ? 1 : scale;

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden preview-scaler-container"
      style={{ height: printing ? "auto" : innerHeight ?? undefined }}
    >
      <div
        ref={innerRef}
        className="preview-scaler-inner"
        style={{
          transform: `scale(${aktifScale})`,
          transformOrigin: "top left",
          width: `${SAYFA_GENISLIK_PX}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
