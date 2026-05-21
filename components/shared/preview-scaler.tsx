// Evrak/yazışma ön izlemelerini mobilde ekrana sığacak şekilde ölçekleyen sarmalayıcı.
// 210mm sabit genişlikteki sayfa içeriği geniş ekranda olduğu gibi gösterilir;
// dar ekranlarda CSS transform: scale ile küçültülerek yatay kaydırma ihtiyacı
// ortadan kaldırılır. Yazdırma sırasında scale otomatik sıfırlanır.
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
      // Sadece viewport genişliğine göre hesapla — DOM ölçümlerine güvenme.
      // Mobilde dialog ~95vw genişlikte, kenar paylarıyla birlikte
      // kullanılabilir alan ~90vw kadar.
      // Bilgisayarda (≥768px) tam ölçek (1) kullan — küçültmeye gerek yok.
      const viewportW = window.innerWidth;
      let efektifW: number;
      if (viewportW >= 900) {
        // Geniş ekran — ölçeklemeye gerek yok
        efektifW = SAYFA_GENISLIK_PX;
      } else if (viewportW >= 768) {
        // Orta — hafif küçültme
        efektifW = Math.min(viewportW - 80, SAYFA_GENISLIK_PX);
      } else {
        // Mobil — dialog padding'ini dahil et (her yönden ~24px + güvenlik payı)
        efektifW = Math.max(280, viewportW - 80);
      }
      const yeniScale = Math.min(1, efektifW / SAYFA_GENISLIK_PX);
      setScale(yeniScale);
      // Ölçekli yüksekliği container'a ata — sayfa altı boşluk oluşmasın
      setInnerHeight(inner.offsetHeight * yeniScale);
    };

    hesapla();
    // Layout finalize olduktan sonra bir kez daha — bazen ilk render'da
    // inner.offsetHeight tam ölçülmüş olmuyor
    const t1 = setTimeout(hesapla, 50);
    const t2 = setTimeout(hesapla, 200);

    const ro = new ResizeObserver(hesapla);
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
  // Container'ın görünür genişliği = scaled inner genişlik
  const containerW = printing ? undefined : SAYFA_GENISLIK_PX * scale;

  return (
    <div
      ref={containerRef}
      className="preview-scaler-container overflow-hidden mx-auto"
      style={{
        width: containerW,
        maxWidth: "100%",
        height: printing ? "auto" : innerHeight ?? undefined,
      }}
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
