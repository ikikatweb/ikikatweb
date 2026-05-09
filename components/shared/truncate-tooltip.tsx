// Site geneli: kesilmiş yazılar veya tooltip indikatörlü (noktalı alt çizgi)
// elementlere tıklayınca tam halini / tooltip içeriğini toast olarak gösterir.
//
// Yakalanan kalıplar:
//   1. "truncate" class'lı + scrollWidth > clientWidth (gerçekten kesilmiş)
//   2. "cursor-help" class'lı + title attribute (genelde hover tooltip indikatörü)
//   3. "border-dashed" class'lı + title attribute (noktalı alt çizgili tooltip)
//
// Form input/button gibi interaktif elementler kendi action'larına devam eder.
"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";

function gosterToast(metin: string) {
  toast(metin, {
    duration: 5000,
    icon: "📋",
    style: {
      maxWidth: "min(90vw, 480px)",
      whiteSpace: "pre-line",
      wordBreak: "break-word",
    },
  });
}

export default function TruncateTooltip() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      let cur: HTMLElement | null = target;
      let depth = 0;
      while (cur && depth < 6) {
        const cls = cur.classList;
        if (cls) {
          // 1) truncate + gerçekten kesilmiş
          if (cls.contains("truncate")) {
            if (cur.scrollWidth > cur.clientWidth + 1) {
              const tam = cur.getAttribute("title") || cur.textContent?.trim() || "";
              if (tam) gosterToast(tam);
            }
            return;
          }
          // 2) cursor-help — tooltip indikatörü
          // 3) border-dashed — noktalı alt çizgi (tooltip)
          if (cls.contains("cursor-help") || cls.contains("border-dashed")) {
            const tam = cur.getAttribute("title") || "";
            if (tam) gosterToast(tam);
            return;
          }
        }
        cur = cur.parentElement;
        depth++;
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  return null;
}
