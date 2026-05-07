// Toaster wrapper — react-hot-toast'a kapatma (X) butonu ekler
// ve varsayılan süreyi 5 saniyeye ayarlar.
"use client";

import { Toaster, ToastBar, toast } from "react-hot-toast";

export default function ToasterX() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 5000,
        style: {
          background: "#1E3A5F",
          color: "#fff",
        },
        success: {
          duration: 5000,
        },
        error: {
          duration: 5000,
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
