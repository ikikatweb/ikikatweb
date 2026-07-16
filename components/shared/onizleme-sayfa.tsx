// Dialog içi A4 sayfa ölçekleyici — 210mm sabit genişlikteki evrak sayfasını, bulunduğu KONTEYNERİN
// genişliğine göre transform: scale ile küçültür (PreviewScaler viewport'a bakar ve dialog içinde
// yanlış sonuç veriyordu; bu bileşen doğrudan kendi kapsayıcısını ölçer → dialog/mobil fark etmez).
// Geniş ekranda scale=1 (birebir A4), dar ekranda sığacak kadar küçülür; yatay kaydırma çıkmaz.
"use client";

import { useEffect, useRef, useState } from "react";

const SAYFA_GENISLIK_PX = 210 * 3.7795275591; // ≈ 793.7 (210mm)

export default function OnizlemeSayfa({ children }: { children: React.ReactNode }) {
  const disRef = useRef<HTMLDivElement>(null);
  const icRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [yukseklik, setYukseklik] = useState<number | undefined>(undefined);
  const [solPay, setSolPay] = useState(0);

  useEffect(() => {
    const hesapla = () => {
      const w = disRef.current?.clientWidth ?? 0;
      if (w <= 0) return;
      const s = Math.min(1, w / SAYFA_GENISLIK_PX);
      setScale(s);
      setYukseklik((icRef.current?.offsetHeight ?? 0) * s);
      setSolPay(Math.max(0, (w - SAYFA_GENISLIK_PX * s) / 2)); // geniş ekranda ortala
    };
    hesapla();
    const t = setTimeout(hesapla, 150); // dialog açılış animasyonu/font yüklemesi sonrası bir kez daha
    const ro = new ResizeObserver(hesapla);
    if (disRef.current) ro.observe(disRef.current);
    if (icRef.current) ro.observe(icRef.current);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, []);

  return (
    <div ref={disRef} className="w-full overflow-hidden" style={{ height: yukseklik }}>
      <div
        ref={icRef}
        style={{ width: SAYFA_GENISLIK_PX, transform: `scale(${scale})`, transformOrigin: "top left", marginLeft: solPay }}
      >
        {children}
      </div>
    </div>
  );
}
