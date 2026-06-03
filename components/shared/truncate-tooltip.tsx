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
import { toastSuresi } from "@/lib/utils/toast-sure";

// Aynı içeriği üst üste birden fazla göstermeyi engelle.
// react-hot-toast id'si ile: aynı id'li toast varsa onu günceller, yeni oluşturmaz.
// Ayrıca son 800ms içinde gösterilen aynı içerik tekrar gönderilmez (çift event guard).
let sonToastIcerik = "";
let sonToastZaman = 0;
function gosterToast(metin: string) {
  const simdi = Date.now();
  if (metin === sonToastIcerik && simdi - sonToastZaman < 800) {
    return; // 800ms içinde aynı içerik tekrar gelmez (çift click/event koruması)
  }
  sonToastIcerik = metin;
  sonToastZaman = simdi;
  // İçerik bazlı id ile çağır — aynı metin görüntüleniyorsa yeni toast eklenmez,
  // mevcut olanın süresi yenilenir.
  const id = `truncate-${metin.slice(0, 64)}`;
  toast(metin, {
    id,
    duration: toastSuresi(),
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
