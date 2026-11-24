// KARŞILAMA VİDEOSU — "tanıtım videoları nasıl izlenir" anlatımı.
//
// Girişten sonra HER KULLANICIYA bir kez kendiliğinden açılır; kullanıcı izleyip
// "Anladım" dediğinde bir daha açılmaz.
//
// İZLENDİ İŞARETİ NEREDE DURUYOR: tarayıcıda değil, kullanıcının kendi kaydında
// (kullanicilar.gizlenen_uyarilar, anahtar "karsilama-videosu:v1"). Böylece kişi
// telefondan da girse tekrar karşısına çıkmaz. Anahtarın sonundaki sürüm numarası
// bilerek duruyor: video yenilenirse v2 yapılır ve herkese bir kez daha gösterilir.
//
// VİDEO YOKSA PENCERE HİÇ AÇILMAZ. Dosya kovaya konmadan önce herkese "video
// bulunamadı" kutusu çıkmasın diye; dosya yüklendiği an kendiliğinden devreye girer.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Clapperboard, X, Loader2, Check } from "lucide-react";
import { useAuth } from "@/hooks";
import { KARSILAMA_SLUG } from "@/lib/tanitim/sayfalar";
import { uyariGizle } from "@/lib/supabase/queries/uyari-gizle";
import { toastSuresi } from "@/lib/utils/toast-sure";

/** Kullanıcı kaydındaki işaret. Video değişirse sürümü artır → herkese bir kez daha açılır. */
export const KARSILAMA_ANAHTARI = "karsilama-videosu:v1";

/** Üst bardaki "Nasıl izlenir?" düğmesi bu olayı yayar — izlemiş kullanıcı tekrar açabilsin. */
export const KARSILAMA_OLAY = "karsilama-videosu-ac";

export default function KarsilamaVideosu() {
  const { kullanici, loading, profilYenile } = useAuth();

  const [url, setUrl] = useState<string | null>(null);
  const [acik, setAcik] = useState(false);
  const [bitti, setBitti] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const istendiRef = useRef(false);

  const izlemis = (kullanici?.gizlenen_uyarilar ?? []).includes(KARSILAMA_ANAHTARI);

  // Videonun imzalı adresini getir. Adres 2 saat geçerli; pencere kapanınca da elde tutulur
  // ki "tekrar izle" denince yeniden istek atılmasın.
  const videoGetir = useCallback(async (): Promise<string | null> => {
    if (url) return url;
    const y = await fetch(`/api/tanitim-video?sayfa=${KARSILAMA_SLUG}`, { cache: "no-store" });
    const veri = (await y.json().catch(() => null)) as { var?: boolean; url?: string; error?: string } | null;
    if (!y.ok) throw new Error(veri?.error ?? `Sunucu ${y.status} döndü.`);
    if (!veri?.var || !veri.url) return null;
    setUrl(veri.url);
    return veri.url;
  }, [url]);

  // ── Girişten sonra bir kez kendiliğinden aç ──────────────────────────────────────────────
  useEffect(() => {
    if (loading || !kullanici || izlemis || istendiRef.current) return;
    istendiRef.current = true;
    void (async () => {
      try {
        const adres = await videoGetir();
        if (adres) setAcik(true);          // dosya yoksa hiçbir şey gösterme
      } catch (e) {
        // Sessiz geçmiyoruz ama kullanıcıyı da panele sokmadan durdurmuyoruz: karşılama
        // videosu işin kendisi değil. Hata görünür olsun, giriş akışı bozulmasın.
        toast.error(
          `Karşılama videosu açılamadı: ${e instanceof Error ? e.message : "bilinmeyen hata"}`,
          { duration: toastSuresi() },
        );
      }
    })();
  }, [loading, kullanici, izlemis, videoGetir]);

  // ── Üst bardaki düğme: izlemiş olsa da tekrar açabilsin ──────────────────────────────────
  useEffect(() => {
    const ac = () => {
      void (async () => {
        try {
          const adres = await videoGetir();
          if (!adres) {
            toast.error("Anlatım videosu henüz yüklenmemiş (tanitim/nasil-izlenir.mp4).", { duration: toastSuresi() });
            return;
          }
          setBitti(false);
          setAcik(true);
        } catch (e) {
          toast.error(
            `Video getirilemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}`,
            { duration: toastSuresi() },
          );
        }
      })();
    };
    window.addEventListener(KARSILAMA_OLAY, ac);
    return () => window.removeEventListener(KARSILAMA_OLAY, ac);
  }, [videoGetir]);

  // "Bir daha gösterme" — kullanıcının kendi kaydına yazar.
  // kapat=false: video sonuna geldiğinde işaret konur ama pencere açık kalır (kullanıcı kapatır).
  const izlendiIsaretle = useCallback(async (kapat = true) => {
    if (izlemis) { if (kapat) setAcik(false); return; }   // zaten işaretli (tekrar izleme)
    setKaydediliyor(true);
    try {
      const { kayitHatasi } = await uyariGizle(KARSILAMA_ANAHTARI);
      // Onay günlüğü yazılamadıysa sessiz geçme: "kim izledi" kaydı tutuluyor sanılmasın.
      if (kayitHatasi) {
        toast.error(`İşaretlendi ama onay günlüğüne yazılamadı: ${kayitHatasi}`, { duration: toastSuresi() });
      }
      await profilYenile();
      if (kapat) setAcik(false);
    } catch (e) {
      // İşaretlenemediyse pencereyi kapatıp "bir daha çıkmaz" izlenimi VERME.
      toast.error(
        `İşaretlenemedi, bir daha denemek için düğmeye tekrar basın: ${e instanceof Error ? e.message : "bilinmeyen hata"}`,
        { duration: toastSuresi() },
      );
    } finally {
      setKaydediliyor(false);
    }
  }, [izlemis, profilYenile]);

  // Video sonuna gelince kendiliğinden işaretle — kullanıcı izledi, iş bitti.
  const videoBitti = useCallback(() => {
    setBitti(true);
    void izlendiIsaretle(false);   // pencere açık kalsın, kapatmayı kullanıcı yapsın
  }, [izlendiIsaretle]);

  if (!acik || !url) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-3">
      <div className="w-[min(94vw,820px)] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Clapperboard size={18} className="shrink-0 text-[#F97316]" />
            <span className="truncate text-sm font-semibold text-[#1E3A5F]">
              Tanıtım videoları nasıl izlenir?
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAcik(false)}
            title="Kapat"
            aria-label="Kapat"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tarayıcının kendi kumandası: telefonda tam ekran, ses ve sarma oradan daha tanıdık. */}
        <video
          src={url}
          className="aspect-video w-full bg-black"
          controls
          autoPlay
          playsInline
          onEnded={videoBitti}
          onError={() =>
            toast.error("Video dosyası açılamadı (bozuk olabilir ya da adresin süresi dolmuş).", {
              duration: toastSuresi(),
            })
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-2.5">
          <span className="text-xs text-gray-500">
            {izlemis || bitti
              ? "Bu pencere bir daha kendiliğinden açılmayacak."
              : "Panelde her ekranın kendi tanıtımı var; bu pencere yalnız bir kez açılır."}
          </span>
          <div className="flex items-center gap-2">
            {!izlemis && !bitti && (
              <button
                type="button"
                onClick={() => setAcik(false)}
                className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Daha sonra
              </button>
            )}
            <button
              type="button"
              onClick={() => void izlendiIsaretle()}
              disabled={kaydediliyor}
              className="flex items-center gap-1.5 rounded-md bg-[#1E3A5F] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2a4e7d] disabled:opacity-50"
            >
              {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {izlemis || bitti ? "Kapat" : "Anladım, bir daha gösterme"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
