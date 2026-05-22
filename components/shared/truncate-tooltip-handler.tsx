// Global tooltip yöneticisi:
// - BİLGİSAYAR (≥768px): `.truncate` veya `truncate` Tailwind class'ı olan elementlerin
//   üzerindeki `title` attribute'larını temizler → hover'da rahatsız edici tooltip çıkmaz.
// - MOBİL (<768px): truncate edilmiş elementlere TIKLANINCA özel bir popup gösterir →
//   kullanıcı tam metni görebilir. (Native title attribute mobilde gözükmediği için.)
//
// Dashboard layout'a bir kez mount edilir; tüm sayfalardaki tablolara otomatik uygulanır.
"use client";

import { useEffect, useState } from "react";

export default function TruncateTooltipHandler() {
  const [popup, setPopup] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    // Mobil/Desktop tespiti
    const mobil = () => window.innerWidth < 768;

    // Element TABLO içinde mi? Filtre/dropdown/buton vb. yerlerdeki truncate'leri
    // ETKİLEMEMEK için sadece <table> içindeki elemanlara uygulanır.
    const tabloIcindeMi = (el: Element): boolean => {
      let n: Element | null = el;
      while (n) {
        const tag = n.tagName?.toLowerCase();
        if (tag === "table") return true;
        // Filtre dropdown'ları, butonlar, form alanları, dialog gibi yerleri hariç tut
        if (tag === "button" || tag === "select" || tag === "input" || tag === "textarea") return false;
        if (n instanceof HTMLElement && n.getAttribute("role") === "dialog") return false;
        n = n.parentElement;
      }
      return false;
    };

    // Hangi elementlerde title gösterilir? Truncate edilmiş VE tablo içinde olanlar.
    const truncateEdildiMi = (el: Element): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (!tabloIcindeMi(el)) return false;
      // Tailwind truncate class'ı VEYA inline style overflow:hidden + text-overflow:ellipsis
      const cls = el.className;
      if (typeof cls === "string" && cls.includes("truncate")) return true;
      const cs = window.getComputedStyle(el);
      if (cs.textOverflow === "ellipsis" && (cs.overflow === "hidden" || cs.overflowX === "hidden")) return true;
      return false;
    };

    // Bilgisayarda: truncate edilmiş elementlerin title'ını sil → hover tooltip çıkmaz
    const desktopBosalt = () => {
      if (mobil()) return;
      document.querySelectorAll<HTMLElement>("[title]").forEach((el) => {
        if (truncateEdildiMi(el)) {
          // data-title'a kopyala — mobile dönerse geri yükleyebiliriz
          if (!el.dataset.title) el.dataset.title = el.getAttribute("title") || "";
          el.removeAttribute("title");
        }
      });
    };

    // Mobile geçişte: data-title'dan title'ı geri yükle
    const mobilGeriYukle = () => {
      if (!mobil()) return;
      document.querySelectorAll<HTMLElement>("[data-title]").forEach((el) => {
        if (!el.getAttribute("title") && el.dataset.title) {
          el.setAttribute("title", el.dataset.title);
        }
      });
    };

    // Tap handler — mobilde truncate edilmiş elemente tıklayınca popup gösterir
    const onClick = (e: MouseEvent) => {
      if (!mobil()) return;
      const target = e.target as HTMLElement;
      if (!target) return;
      // En yakın truncate edilmiş atayı bul
      let el: HTMLElement | null = target;
      while (el && !truncateEdildiMi(el)) el = el.parentElement;
      if (!el) return;
      const text = el.getAttribute("title") || el.dataset.title || el.textContent?.trim();
      if (!text) return;
      // Element'in scrollWidth > clientWidth ise (gerçekten kesilmiş) popup göster
      if (el.scrollWidth <= el.clientWidth + 1) return;
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      setPopup({
        text,
        x: rect.left + rect.width / 2,
        y: rect.bottom + 6,
      });
    };

    // Bir yere tıklayınca popup kapanır
    const onDocClick = () => setPopup(null);

    // İlk çalıştırma
    const init = () => {
      desktopBosalt();
      mobilGeriYukle();
    };
    init();

    // Resize'da yeniden değerlendir
    window.addEventListener("resize", init);
    // DOM değişikliklerinde tekrar uygula (her sayfa geçişi/her satır eklenmesi vs.)
    const observer = new MutationObserver(() => {
      // Debounce — çok sık tetiklenmesin
      clearTimeout((window as unknown as { __ttDebounce?: number }).__ttDebounce);
      (window as unknown as { __ttDebounce?: number }).__ttDebounce = window.setTimeout(init, 200);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    document.addEventListener("click", onClick, true);
    document.addEventListener("click", onDocClick);

    return () => {
      window.removeEventListener("resize", init);
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("click", onDocClick);
    };
  }, []);

  if (!popup) return null;
  // Popup ekran kenarlarından taşmasın
  const maxW = Math.min(280, window.innerWidth - 32);
  let left = popup.x - maxW / 2;
  if (left < 16) left = 16;
  if (left + maxW > window.innerWidth - 16) left = window.innerWidth - 16 - maxW;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed z-[200] bg-[#1E3A5F] text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-auto"
      style={{
        top: popup.y,
        left,
        maxWidth: maxW,
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >
      {popup.text}
    </div>
  );
}
