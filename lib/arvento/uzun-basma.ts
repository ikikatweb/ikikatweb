// Mobil "uzun basma" (long-press) — masaüstündeki sağ-tık menüsünün dokunmatik karşılığı.
// Parmağı ~450 ms basılı tutunca onLong(x, y) çağrılır; parmak kayarsa/kalkarsa iptal olur.
// Butonlara {...uzunBasmaHandlers(...)} olarak yayılır.
import type { TouchEvent } from "react";

export function uzunBasmaHandlers(onLong: (x: number, y: number) => void, ms = 450) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const temizle = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const x = t.clientX, y = t.clientY;
      temizle();
      timer = setTimeout(() => onLong(x, y), ms);
    },
    onTouchMove: temizle,
    onTouchEnd: temizle,
    onTouchCancel: temizle,
  };
}
