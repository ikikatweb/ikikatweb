// Evrak/yazışma ön izlemelerini mobilde ekrana sığacak şekilde ölçekleyen sarmalayıcı.
// 210mm sabit genişlikteki sayfa içeriği geniş ekranda olduğu gibi gösterilir;
// dar ekranlarda CSS transform: scale ile küçültülerek yatay kaydırma ihtiyacı
// ortadan kaldırılır. Yazdırma sırasında scale otomatik sıfırlanır (print CSS).
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// SSR'da useLayoutEffect uyarısını engellemek için
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function PreviewScaler({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [innerHeight, setInnerHeight] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    const hesapla = () => {
      const containerW = container.clientWidth;
      const innerW = inner.offsetWidth; // 210mm ~ 793px
      if (innerW === 0) return;
      const yeniScale = Math.min(1, containerW / innerW);
      setScale(yeniScale);
      // Ölçekli yüksekliği container'a ata — sayfa altı boşluk oluşmasın
      setInnerHeight(inner.offsetHeight * yeniScale);
    };

    hesapla();
    const ro = new ResizeObserver(hesapla);
    ro.observe(container);
    ro.observe(inner);
    window.addEventListener("resize", hesapla);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", hesapla);
    };
  }, []);

  // Yazdırma sırasında scale sıfırlanır — print snapshot'ı tam boyutta alır
  const [printing, setPrinting] = useState(false);
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
      className="w-full mx-auto overflow-hidden preview-scaler-container"
      style={{ height: printing ? "auto" : innerHeight ?? undefined }}
    >
      <div
        ref={innerRef}
        className="preview-scaler-inner"
        style={{
          transform: `scale(${aktifScale})`,
          transformOrigin: "top left",
          width: "210mm",
        }}
      >
        {children}
      </div>
    </div>
  );
}
