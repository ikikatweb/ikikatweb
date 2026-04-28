// Mobilde sayfayı aşağı çekince yenileme — sadece mobilde aktif
// Scroll konumu 0'dayken aşağı çekilince tetiklenir, threshold 70px
"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";

type Props = {
  /** Scroll edilen element id'si (genellikle main alanı) */
  scrollTargetId: string;
  /** Yenileme tetiklenince çağrılır — promise dönerse beklenir */
  onRefresh?: () => void | Promise<void>;
};

const THRESHOLD = 70; // px — bu kadar çekilince yenileme tetiklenir
const MAX_PULL = 120; // px — görsel maksimum çekme mesafesi

export default function PullToRefresh({ scrollTargetId, onRefresh }: Props) {
  const [pull, setPull] = useState(0); // mevcut çekme mesafesi (px)
  const [yenileniyor, setYenileniyor] = useState(false);
  const startYRef = useRef<number | null>(null);
  const aktifRef = useRef(false);
  // Listener'lar bu ref'leri okur → her state değişiminde yeniden bağlanmaz
  const pullRef = useRef(0);
  const yenileniyorRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { pullRef.current = pull; }, [pull]);
  useEffect(() => { yenileniyorRef.current = yenileniyor; }, [yenileniyor]);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    // Sadece mobil/touch cihazlarda aktif
    if (typeof window === "undefined") return;
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return;

    const target = document.getElementById(scrollTargetId);
    if (!target) return;

    const onTouchStart = (e: TouchEvent) => {
      // Sadece scroll en üstteyken başlat
      if (target.scrollTop > 0) {
        startYRef.current = null;
        aktifRef.current = false;
        return;
      }
      if (yenileniyorRef.current) return;
      startYRef.current = e.touches[0].clientY;
      aktifRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!aktifRef.current || startYRef.current === null) return;
      if (yenileniyorRef.current) return;
      // Hareket sırasında scroll yukarı çıktıysa iptal
      if (target.scrollTop > 0) {
        aktifRef.current = false;
        startYRef.current = null;
        setPull(0);
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        setPull(0);
        return;
      }
      // Lastik gibi davranış — sürtünme uygula
      const sönümlü = Math.min(MAX_PULL, delta * 0.5);
      setPull(sönümlü);
      // Yeterince çekildiyse sayfa scroll'unu engelle
      if (sönümlü > 10 && e.cancelable) {
        e.preventDefault();
      }
    };

    const onTouchEnd = async () => {
      if (!aktifRef.current) {
        setPull(0);
        return;
      }
      aktifRef.current = false;
      const tetiklendi = pullRef.current >= THRESHOLD;
      startYRef.current = null;
      if (tetiklendi && !yenileniyorRef.current) {
        setYenileniyor(true);
        setPull(THRESHOLD);
        try {
          if (onRefreshRef.current) {
            await onRefreshRef.current();
          } else {
            window.location.reload();
            return; // sayfa zaten yenileniyor
          }
        } catch (e) {
          console.warn("Pull-to-refresh hata:", e);
        }
        setYenileniyor(false);
        setPull(0);
      } else {
        setPull(0);
      }
    };

    target.addEventListener("touchstart", onTouchStart, { passive: true });
    target.addEventListener("touchmove", onTouchMove, { passive: false });
    target.addEventListener("touchend", onTouchEnd, { passive: true });
    target.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchmove", onTouchMove);
      target.removeEventListener("touchend", onTouchEnd);
      target.removeEventListener("touchcancel", onTouchEnd);
    };
    // Listener'ları YALNIZCA bir kez bağla — pull/yenileniyor/onRefresh ref'lerden okunuyor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTargetId]);

  // Görsel — sadece çekme aktifken görünür
  if (pull === 0 && !yenileniyor) return null;

  const ilerleme = Math.min(1, pull / THRESHOLD);
  const opaklik = Math.min(1, pull / 30);

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-50 flex justify-center"
      style={{
        top: 0,
        transform: `translateY(${pull - 30}px)`,
        opacity: opaklik,
        transition: yenileniyor ? "transform 200ms ease" : "none",
      }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-slate-200">
        {yenileniyor ? (
          <Loader2 className="h-5 w-5 animate-spin text-[#1E3A5F]" />
        ) : (
          <ArrowDown
            className="h-5 w-5 text-[#1E3A5F] transition-transform"
            style={{
              transform: `rotate(${ilerleme >= 1 ? 180 : 0}deg)`,
            }}
          />
        )}
      </div>
    </div>
  );
}
