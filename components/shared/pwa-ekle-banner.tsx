// "Ana ekrana ekle" öneri banner'ı — telefondan girenlere siteyi PWA olarak kurmayı önerir.
//
// İki platform ayrı çalışır:
//  • Android/Chrome: tarayıcı "beforeinstallprompt" olayını yollar. Biz varsayılan mini-infobar'ı
//    engelleyip olayı saklıyoruz; kullanıcı butona basınca deferredPrompt.prompt() ile native
//    kurulum diyaloğunu açıyoruz. Tek dokunuş.
//  • iOS Safari: beforeinstallprompt YOK. Kurulum yalnızca "Paylaş → Ana Ekrana Ekle" ile elle
//    yapılır. Bu yüzden iOS'te görsel talimat gösteriyoruz.
//
// Gösterilmediği durumlar: masaüstü, zaten kurulu (standalone) açılış, ya da kullanıcı daha önce
// kapatmışsa (localStorage'da hatırlanır; süre dolunca tekrar önerilir).
"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// beforeinstallprompt tip tanımı — lib.dom'da standart değil.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KAPAT_ANAHTAR = "pwa-ekle-kapatildi"; // localStorage: kapatma zaman damgası (ms)
const TEKRAR_ONER_GUN = 14; // kapatıldıktan bu kadar gün sonra tekrar öner

// Kullanıcı yakın zamanda kapattı mı?
function yakindaKapatildi(): boolean {
  try {
    const ham = localStorage.getItem(KAPAT_ANAHTAR);
    if (!ham) return false;
    const gecen = Date.now() - parseInt(ham, 10);
    return gecen < TEKRAR_ONER_GUN * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

// Uygulama zaten ana ekrandan (standalone) mı açıldı?
function standaloneMi(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari standalone bayrağı (standart dışı)
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function PwaEkleBanner() {
  // Tek durum: "gizli" hiçbir şey gösterme · "ios" elle ekleme talimatı · "android" kur butonu.
  // İlk render (SSR + client hydration) daima "gizli" → hidrasyon uyuşmazlığı olmaz; karar effect'te.
  const [mod, setMod] = useState<"gizli" | "ios" | "android">("gizli");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (standaloneMi() || yakindaKapatildi()) return;

    const ua = window.navigator.userAgent;
    const iosCihaz = /iphone|ipad|ipod/i.test(ua);
    // iPadOS 13+ kendini Mac gibi tanıtır → dokunmatik + Mac = iPad
    const iPadMasaustu = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    const ios = iosCihaz || iPadMasaustu;
    // iOS'te kurulum yalnız Safari'de mümkün (Chrome/Firefox iOS'te Add to Home Screen sunmaz)
    const iosSafari = ios && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);

    if (iosSafari) {
      // Tarayıcı bilgisi (UA/standalone) render sırasında bilinemez, bu yüzden effect'te karar veriyoruz.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMod("ios");
      return;
    }

    // Android/Chrome: kurulabilir hale gelince olay tetiklenir (geri çağırma içinde setState → kural dışı)
    const handler = (e: Event) => {
      e.preventDefault(); // tarayıcının kendi mini-infobar'ını engelle
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setMod("android");
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Kurulum tamamlanınca banner'ı kaldır
    const kuruldu = () => setMod("gizli");
    window.addEventListener("appinstalled", kuruldu);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", kuruldu);
    };
  }, []);

  function kapat() {
    setMod("gizli");
    try {
      localStorage.setItem(KAPAT_ANAHTAR, String(Date.now()));
    } catch {
      /* sessiz */
    }
  }

  async function kur() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const secim = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setMod("gizli");
    // Reddederse kapatma damgası bırak ki hemen tekrar bombalamayalım
    if (secim.outcome === "dismissed") {
      try {
        localStorage.setItem(KAPAT_ANAHTAR, String(Date.now()));
      } catch {
        /* sessiz */
      }
    }
  }

  if (mod === "gizli") return null;
  const iosMod = mod === "ios";

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60] p-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      role="dialog"
      aria-label="Uygulamayı ana ekrana ekle"
    >
      <div className="mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1E3A5F] text-white">
          <Smartphone className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">İkikat&apos;i ana ekrana ekle</p>

          {iosMod ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Alttaki <Share className="mx-0.5 inline h-3.5 w-3.5 align-text-bottom" />
              <span className="font-medium">Paylaş</span> düğmesine dokun, ardından{" "}
              <SquarePlus className="mx-0.5 inline h-3.5 w-3.5 align-text-bottom" />
              <span className="font-medium">Ana Ekrana Ekle</span> seçeneğini seç.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Tek dokunuşla kur; uygulama gibi tam ekran açılır ve daha hızlı erişirsin.
            </p>
          )}

          {!iosMod && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="h-8 bg-[#1E3A5F] hover:bg-[#16304d]" onClick={kur}>
                Ana ekrana ekle
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-slate-500" onClick={kapat}>
                Şimdi değil
              </Button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={kapat}
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Kapat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
