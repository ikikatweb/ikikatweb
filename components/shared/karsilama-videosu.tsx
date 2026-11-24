// KARŞILAMA VİDEOSU — "tanıtım videoları nasıl izlenir" anlatımı.
//
// NE ZAMAN AÇILIR: kullanıcı bu videoyu İKİ KEZ izleyene kadar; hem girişten sonra hem de
// uygulamaya geri dönüldüğünde (telefon uyanınca, sekme öne gelince). Telefonda uygulama
// çoğu zaman yeniden YÜKLENMEDEN devam ettiriliyor; yalnız açılışa bakılsaydı uyanan
// telefonda hiç açılmazdı — kullanıcı 24.11.2026'da bunu bildirdi.
//
// İZLENDİ İŞARETİ NEREDE DURUYOR: tarayıcıda değil, kullanıcının kendi kaydında
// (kullanicilar.gizlenen_uyarilar). Her izleme ayrı bir anahtar:
//   karsilama-videosu:v1-izleme1 · karsilama-videosu:v1-izleme2
// İkisi de varsa pencere bir daha kendiliğinden açılmaz. Böylece kişi telefondan da
// girse sayaç kaldığı yerden devam eder. Anahtardaki "v1" bilerek duruyor: video
// yenilenirse v2 yapılır ve herkes yeniden iki kez izler.
//
// VİDEO YOKSA PENCERE HİÇ AÇILMAZ. Dosya kovaya konmadan önce herkese "video
// bulunamadı" kutusu çıkmasın diye; dosya yüklendiği an kendiliğinden devreye girer.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Clapperboard, X, Loader2, Check, Volume2, Play } from "lucide-react";
import { useAuth } from "@/hooks";
import { KARSILAMA_SLUG } from "@/lib/tanitim/sayfalar";
import { uyariGizle } from "@/lib/supabase/queries/uyari-gizle";
import { toastSuresi } from "@/lib/utils/toast-sure";

/** Kaç kez izlenmesi isteniyor. */
export const GEREKEN_IZLEME = 2;

/** Kullanıcı kaydındaki işaretin önü. Video yenilenirse v2 yapılır → herkes baştan izler. */
const ANAHTAR_ONEK = "karsilama-videosu:v1";
const izlemeAnahtari = (sira: number) => `${ANAHTAR_ONEK}-izleme${sira}`;

/** Üst bardaki "Nasıl izlenir?" düğmesi bu olayı yayar — izlemiş kullanıcı tekrar açabilsin. */
export const KARSILAMA_OLAY = "karsilama-videosu-ac";

/** İmzalı adres 2 saat geçerli; uyanan telefonda bayat adresle video açılmasın diye 90 dk sonra tazelenir. */
const ADRES_TAZELEME_MS = 90 * 60 * 1000;

export default function KarsilamaVideosu() {
  const { kullanici, loading, profilYenile } = useAuth();

  const [url, setUrl] = useState<string | null>(null);
  const [acik, setAcik] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  // Tarayıcı SESLİ otomatik oynatmayı engellerse video sessiz başlar; bu durumda tek
  // dokunuşluk "Sesi aç" düğmesi çıkar. Hiç oynatılamadıysa "Oynat" düğmesi çıkar —
  // kullanıcı donmuş bir kare ile baş başa bırakılmaz.
  const [sessizBasladi, setSessizBasladi] = useState(false);
  const [oynatilamadi, setOynatilamadi] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const adresAniRef = useRef(0);
  const ilkDenemeRef = useRef(false);
  // "Daha sonra" dendiyse bu oturumda uygulamaya her dönüşte tekrar açılmasın.
  const ertelendiRef = useRef(false);

  const gizlenenler = kullanici?.gizlenen_uyarilar ?? [];
  const izlemeSayisi = [1, 2].filter((n) => gizlenenler.includes(izlemeAnahtari(n))).length;
  const tamamlandi = izlemeSayisi >= GEREKEN_IZLEME;

  // Videonun imzalı adresi. Taze adres elde varsa yeniden istenmez.
  const videoGetir = useCallback(async (): Promise<string | null> => {
    if (url && Date.now() - adresAniRef.current < ADRES_TAZELEME_MS) return url;
    const y = await fetch(`/api/tanitim-video?sayfa=${KARSILAMA_SLUG}`, { cache: "no-store" });
    const veri = (await y.json().catch(() => null)) as { var?: boolean; url?: string; error?: string } | null;
    if (!y.ok) throw new Error(veri?.error ?? `Sunucu ${y.status} döndü.`);
    if (!veri?.var || !veri.url) return null;
    adresAniRef.current = Date.now();
    setUrl(veri.url);
    return veri.url;
  }, [url]);

  // Pencereyi aç (gerekiyorsa). sessiz=true: kendiliğinden açılan denemelerde hata gürültüsü yapma.
  const acmayiDene = useCallback(
    async (sessiz: boolean) => {
      try {
        const adres = await videoGetir();
        if (adres) setAcik(true);          // dosya yoksa hiçbir şey gösterme
        else if (!sessiz) {
          toast.error("Anlatım videosu henüz yüklenmemiş (tanitim/nasil-izlenir.mp4).", { duration: toastSuresi() });
        }
      } catch (e) {
        // Sessiz geçmiyoruz ama giriş akışını da durdurmuyoruz: karşılama videosu işin kendisi değil.
        toast.error(
          `Karşılama videosu açılamadı: ${e instanceof Error ? e.message : "bilinmeyen hata"}`,
          { duration: toastSuresi() },
        );
      }
    },
    [videoGetir],
  );

  // ── Girişten sonra ilk açılış ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !kullanici || tamamlandi || ilkDenemeRef.current) return;
    ilkDenemeRef.current = true;
    void acmayiDene(true);
  }, [loading, kullanici, tamamlandi, acmayiDene]);

  // ── Uygulamaya geri dönünce (telefon uyanınca, sekme öne gelince) ────────────────────────
  // Telefon uyandığında sayfa çoğu zaman baştan yüklenmez; bu yüzden açılış efekti değil,
  // görünürlük olayı dinlenir. "Daha sonra" diyen kullanıcıyı o oturumda rahatsız etmez.
  useEffect(() => {
    if (tamamlandi) return;
    const bak = () => {
      if (document.visibilityState !== "visible") return;
      if (loading || !kullanici || ertelendiRef.current || acik) return;
      void acmayiDene(true);
    };
    document.addEventListener("visibilitychange", bak);
    window.addEventListener("focus", bak);
    window.addEventListener("pageshow", bak);
    return () => {
      document.removeEventListener("visibilitychange", bak);
      window.removeEventListener("focus", bak);
      window.removeEventListener("pageshow", bak);
    };
  }, [loading, kullanici, tamamlandi, acik, acmayiDene]);

  // ── Üst bardaki düğme: tamamlamış olsa da tekrar açabilsin ───────────────────────────────
  useEffect(() => {
    const ac = () => { ertelendiRef.current = false; void acmayiDene(false); };
    window.addEventListener(KARSILAMA_OLAY, ac);
    return () => window.removeEventListener(KARSILAMA_OLAY, ac);
  }, [acmayiDene]);

  // Bir izlemeyi kullanıcının kendi kaydına yaz.
  // kapat=false: video sonuna geldiğinde işaret konur ama pencere açık kalır (kullanıcı kapatır).
  const izlemeyiYaz = useCallback(async (kapat = true) => {
    if (tamamlandi) { if (kapat) setAcik(false); return; }
    setKaydediliyor(true);
    try {
      const { kayitHatasi } = await uyariGizle(izlemeAnahtari(izlemeSayisi + 1));
      // Onay günlüğü yazılamadıysa sessiz geçme: "kim izledi" kaydı tutuluyor sanılmasın.
      if (kayitHatasi) {
        toast.error(`İşaretlendi ama onay günlüğüne yazılamadı: ${kayitHatasi}`, { duration: toastSuresi() });
      }
      await profilYenile();
      if (kapat) setAcik(false);
    } catch (e) {
      // İşaretlenemediyse pencereyi kapatıp "sayıldı" izlenimi VERME.
      toast.error(
        `İzleme kaydedilemedi, düğmeye tekrar basın: ${e instanceof Error ? e.message : "bilinmeyen hata"}`,
        { duration: toastSuresi() },
      );
    } finally {
      setKaydediliyor(false);
    }
  }, [tamamlandi, izlemeSayisi, profilYenile]);

  const ertele = useCallback(() => { ertelendiRef.current = true; setAcik(false); }, []);

  // Kullanıcı play'e basmasın: video hazır olur olmaz başlat. Sesli oynatma engellenirse
  // (telefonda ve dokunulmamış sayfada çoğu tarayıcı engeller) sessiz başlatılır.
  const kendiOynat = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.play()
      .then(() => { setSessizBasladi(false); setOynatilamadi(false); })
      .catch(() => {
        v.muted = true;
        v.play()
          .then(() => { setSessizBasladi(true); setOynatilamadi(false); })
          .catch(() => setOynatilamadi(true));   // hiç oynatamadı: düğmeyle kullanıcı başlatsın
      });
  }, []);

  const sesiAc = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.volume = 1;
    void v.play().catch(() => {});
    setSessizBasladi(false);
  }, []);

  if (!acik || !url) return null;

  const kalan = Math.max(0, GEREKEN_IZLEME - izlemeSayisi);

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-3">
      <div className="w-[min(94vw,820px)] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Clapperboard size={18} className="shrink-0 text-[#F97316]" />
            <span className="truncate text-sm font-semibold text-[#1E3A5F]">
              Tanıtım videoları nasıl izlenir?
            </span>
            {!tamamlandi && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums">
                {izlemeSayisi + 1}. izleme / {GEREKEN_IZLEME}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={ertele}
            title="Kapat"
            aria-label="Kapat"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tarayıcının kendi kumandası: telefonda tam ekran, ses ve sarma oradan daha tanıdık. */}
        <div className="relative">
          <video
            ref={videoRef}
            src={url}
            className="aspect-video w-full bg-black"
            controls
            autoPlay
            playsInline
            onLoadedData={kendiOynat}
            onEnded={() => void izlemeyiYaz(false)}
            onError={() =>
              toast.error("Video dosyası açılamadı (bozuk olabilir ya da adresin süresi dolmuş).", {
                duration: toastSuresi(),
              })
            }
          />

          {/* Sesli otomatik oynatma engellendiyse: video oynuyor ama sessiz — tek dokunuş yeter. */}
          {sessizBasladi && (
            <button
              type="button"
              onClick={sesiAc}
              className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#F97316] px-4 py-2 text-sm font-semibold text-white shadow-lg"
            >
              <Volume2 size={16} />
              Sesi aç
            </button>
          )}

          {/* Hiç oynatılamadıysa donmuş kare ile bırakma. */}
          {oynatilamadi && (
            <button
              type="button"
              onClick={kendiOynat}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white"
            >
              <Play size={40} />
              <span className="text-sm font-medium">Oynatmak için dokunun</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-2.5">
          <span className="text-xs text-gray-500">
            {tamamlandi
              ? "Bu pencere bir daha kendiliğinden açılmayacak."
              : kalan === GEREKEN_IZLEME
                ? `Bu anlatımın ${GEREKEN_IZLEME} kez izlenmesi isteniyor.`
                : "Bir kez daha açılacak."}
          </span>
          <div className="flex items-center gap-2">
            {!tamamlandi && (
              <button
                type="button"
                onClick={ertele}
                className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Daha sonra
              </button>
            )}
            <button
              type="button"
              onClick={() => void izlemeyiYaz()}
              disabled={kaydediliyor}
              className="flex items-center gap-1.5 rounded-md bg-[#1E3A5F] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2a4e7d] disabled:opacity-50"
            >
              {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {tamamlandi ? "Kapat" : `İzledim (${izlemeSayisi + 1}/${GEREKEN_IZLEME})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
