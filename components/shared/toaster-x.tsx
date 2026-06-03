// Toaster wrapper — react-hot-toast'a kapatma (X) butonu ekler.
// Varsayılan süre: masaüstünde 5 sn, MOBİLDE 3 sn (viewport ≤ 768px).
"use client";

import { useEffect, useState } from "react";
import { Toaster, ToastBar, toast } from "react-hot-toast";

export default function ToasterX() {
  // Mobilde tüm bildirimler 3 sn; masaüstünde 5 sn. Viewport değişimine tepki verir.
  const [mobil, setMobil] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const uygula = () => setMobil(mq.matches);
    uygula();
    mq.addEventListener("change", uygula);
    return () => mq.removeEventListener("change", uygula);
  }, []);
  const sure = mobil ? 3000 : 5000;

  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: sure,
        style: {
          background: "#1E3A5F",
          color: "#fff",
        },
        success: {
          duration: sure,
        },
        error: {
          duration: sure,
          style: {
            background: "#ef4444",
            color: "#fff",
          },
        },
      }}
    >
      {(t) => (
        <ToastBar toast={t}>
          {({ icon, message }) => (
            <>
              {icon}
              {message}
              {t.type !== "loading" && (
                <button
                  type="button"
                  onClick={() => toast.dismiss(t.id)}
                  aria-label="Kapat"
                  className="ml-1 -mr-1 inline-flex items-center justify-center w-5 h-5 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors flex-shrink-0"
                  style={{ flexShrink: 0 }}
                >
                  ✕
                </button>
              )}
            </>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
