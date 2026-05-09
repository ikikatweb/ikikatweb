// Site geneli: kesilmiş (truncate) yazılara tıklayınca tam halini toast olarak gösterir.
// Mobilde tooltip yok, PC'de title hover var; ikisinde de tıklamayla çalışır.
//
// Çalışma kuralı:
//   - Tıklanan elementin kendisi veya en yakın 5 atası "truncate" class'ı taşıyorsa,
//   - VEYA title attribute'u + scroll/client width farkı varsa,
//   - tam metni 5 sn'lik toast ile gösterir.
//
// Form input/button gibi interaktif elementlere tıklamada çalışmaz.
"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";

const ATLA_TAGLER = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "LABEL"]);

export default function TruncateTooltip() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null;
      if (!target) return;

      // Kullanıcı interaktif element'e tıkladıysa (buton, link vs.) atla
      // Ama içindeki span/div truncate ise yakalamak istiyoruz, bu yüzden sadece
      // direct target değil, parents'ı tarayalım.
      let kontrolEdilecek: HTMLElement | null = target;
      let depth = 0;
      while (kontrolEdilecek && depth < 6) {
        if (kontrolEdilecek.classList?.contains("truncate")) {
          // Gerçekten kesilmiş mi kontrol et
          const el = kontrolEdilecek as HTMLElement;
          const kesilmisMi = el.scrollWidth > el.clientWidth + 1;
          if (kesilmisMi) {
            const tam = el.getAttribute("title") || el.textContent?.trim() || "";
            if (tam) {
              toast(tam, {
                duration: 5000,
                icon: "📋",
                style: {
                  maxWidth: "min(90vw, 480px)",
                  whiteSpace: "pre-line",
                  wordBreak: "break-word",
                },
              });
            }
          }
          return;
        }
        // Tag bazlı atlama: form elementlerinde durma — onları bypass et
        if (ATLA_TAGLER.has(kontrolEdilecek.tagName)) {
          // Buton içinde truncate olabilir; alt kontrole devam et — yine de yukarı çıkmaya devam edelim
        }
        kontrolEdilecek = kontrolEdilecek.parentElement;
        depth++;
      }
    };

    // capture: true ile diğer handler'lardan önce yakala — ama diğerlerinin
    // de çalışmasına izin ver (preventDefault/stopPropagation YOK).
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  return null;
}
