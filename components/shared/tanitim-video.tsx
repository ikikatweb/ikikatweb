// SAYFAYI TANI — panelde herhangi bir yere sağ tıklayınca çıkan küçük menü ve video penceresi.
//
// Nasıl çalışır:
//  1) Panelin her yerinde sağ tık dinlenir. Başka bir bileşenin KENDİ sağ tık menüsü varsa
//     (ana ekran teklif kartları, bordro, harita üzerindeki ocak menüsü…) o bileşen olayı
//     preventDefault ettiği için biz karışmayız — mevcut menüler aynen çalışır.
//  2) Bağlantı, görsel, video ve yazı alanlarında TARAYICININ kendi menüsü bırakılır: "bağlantıyı
//     yeni sekmede aç", "kopyala/yapıştır" kaybolmasın diye.
//  3) Menüdeki "Sayfayı Tanı" → bulunulan ekranın tanıtım videosu küçük pencerede oynar.
//
// Video adresi /api/tanitim-video'dan gelir (özel kova + imzalı adres). Video yoksa pencere
// bunu açıkça yazar; sessizce boş açılmaz.
//
// TELEFON / TABLET: dokunmatik cihazda sağ tık yoktur. İki yol var:
//  • Üst bardaki klaket düğmesi (components/shared/topbar) — TANITIM_OLAY olayını yayar.
//  • Ekrana parmağı basılı tutmak (yarım saniye) — sağ tıkın dokunmatik karşılığı.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { sayfaBul, type TanitimSayfa } from "@/lib/tanitim/sayfalar";
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize2, X, Clapperboard, Loader2,
} from "lucide-react";

/** Bu öğelerin üzerinde tarayıcının kendi menüsü kalsın. */
const TARAYICIYA_BIRAK = 'a[href], img, video, audio, input, textarea, select, [contenteditable="true"], [contenteditable=""]';

const ATLAMA_SANIYE = 10;
const HIZLAR = [0.75, 1, 1.25, 1.5, 2];

/** Telefon/tablette menünün açılması için parmağın basılı tutulma süresi (ms). */
const UZUN_BASMA_MS = 500;
/** Basılı tutarken hoş görülen en fazla kayma (px) — fazlası kaydırma sayılır, menü açılmaz. */
const UZUN_BASMA_KAYMA = 10;
/** Menü açıldıktan sonra bu süre içindeki tıklama onu kapatmaz (parmağı kaldırınca kapanmasın). */
const KAPATMA_KORUMA_MS = 350;

/**
 * Üst bardaki "Sayfayı Tanı" düğmesi bu olayı yayar, pencere dinler.
 * Telefonda sağ tık/basılı tutma bulunamazsa görünür ve kesin çalışan yol budur.
 */
export const TANITIM_OLAY = "sayfayi-tani";

type Durum =
  | { tip: "yukleniyor" }
  | { tip: "hazir"; url: string }
  | { tip: "yok" }
  | { tip: "hata"; mesaj: string };

function sureYaz(sn: number): string {
  if (!Number.isFinite(sn) || sn < 0) return "0:00";
  const d = Math.floor(sn / 60);
  const s = Math.floor(sn % 60);
  return `${d}:${s.toString().padStart(2, "0")}`;
}

export default function TanitimVideo() {
  const pathname = usePathname();
  const sayfa: TanitimSayfa | null = sayfaBul(pathname ?? "");

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [acik, setAcik] = useState(false);
  const [durum, setDurum] = useState<Durum>({ tip: "yukleniyor" });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const kutuRef = useRef<HTMLDivElement | null>(null);
  const disardaBasildiRef = useRef(false);

  const [oynuyor, setOynuyor] = useState(false);
  const [an, setAn] = useState(0);
  const [toplam, setToplam] = useState(0);
  const [ses, setSes] = useState(1);
  const [sessiz, setSessiz] = useState(false);
  const [hiz, setHiz] = useState(1);

  // Menüyü verilen noktada aç — ekran dışına taşmasın (yaklaşık 220×54 px).
  const acilisAniRef = useRef(0);
  const menuAc = useCallback((x: number, y: number) => {
    acilisAniRef.current = Date.now();
    const sx = Math.min(x, window.innerWidth - 232);
    const sy = Math.min(y, window.innerHeight - 66);
    setMenu({ x: Math.max(8, sx), y: Math.max(8, sy) });
  }, []);

  // ── Sağ tık: menüyü aç ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sagTik = (e: MouseEvent) => {
      if (e.defaultPrevented) return;                 // başka bir menü sahiplendi
      if (!sayfa) return;                             // bu rota için tanıtım tanımlı değil
      const hedef = e.target as HTMLElement | null;
      if (hedef?.closest?.(TARAYICIYA_BIRAK)) return; // bağlantı/görsel/yazı alanı → tarayıcı menüsü
      if ((window.getSelection()?.toString() ?? "").trim()) return;  // seçili metin varsa kopyalayabilsin
      e.preventDefault();
      menuAc(e.clientX, e.clientY);
    };
    document.addEventListener("contextmenu", sagTik);
    return () => document.removeEventListener("contextmenu", sagTik);
  }, [sayfa, menuAc]);

  // ── Telefon/tablet: parmağı basılı tutunca aynı menü ──────────────────────────────────────
  // Dokunmatik cihazda sağ tık yok. Kaydırmayı ve yakınlaştırmayı bozmamak için: yalnız TEK
  // parmak, 10 px'ten fazla kayarsa iptal (aşağı çekip yenileme çalışmaya devam eder), bağlantı
  // ve yazı alanlarında hiç devreye girmez. Parmak kalkınca menü hemen kapanmasın diye kapatma
  // koruması yenilenir.
  useEffect(() => {
    if (!sayfa) return;
    let sayac: number | null = null;
    let bas: { x: number; y: number } | null = null;
    let menuAcildi = false;

    // Basılı tutarken Android/iOS kendi METİN SEÇME balonunu açıyor ve bizim menü onun
    // altında kalıyor (aynı sorun bordro kartında da yaşanmıştı). Çözüm aynı: dokunuş
    // başladığı anda seçim ve iOS "callout" kapatılır, parmak kalkınca geri açılır —
    // böylece metin seçme ve kopyalama normal zamanlarda çalışmaya devam eder.
    const govdeStili = () => document.body.style as CSSStyleDeclaration &
      { webkitUserSelect?: string; webkitTouchCallout?: string };
    const secimKapat = () => {
      const s = govdeStili();
      s.userSelect = "none"; s.webkitUserSelect = "none"; s.webkitTouchCallout = "none";
    };
    const secimAc = () => {
      const s = govdeStili();
      s.userSelect = ""; s.webkitUserSelect = ""; s.webkitTouchCallout = "";
    };

    const iptal = () => {
      if (sayac !== null) { clearTimeout(sayac); sayac = null; }
      bas = null;
      secimAc();
    };
    const basla = (e: TouchEvent) => {
      iptal();
      if (e.touches.length !== 1) return;
      const hedef = e.target as HTMLElement | null;
      if (hedef?.closest?.(TARAYICIYA_BIRAK)) return;   // yazı alanı/bağlantı: seçime dokunma
      const t = e.touches[0];
      bas = { x: t.clientX, y: t.clientY };
      secimKapat();
      sayac = window.setTimeout(() => {
        sayac = null;
        if (bas) {
          menuAcildi = true;
          // Parmak inmeden önce kalmış bir seçim varsa menünün altında durmasın.
          window.getSelection()?.removeAllRanges();
          menuAc(bas.x, bas.y);
        }
        bas = null;
      }, UZUN_BASMA_MS);
    };
    const hareket = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!bas || sayac === null || !t) return;
      if (Math.abs(t.clientX - bas.x) > UZUN_BASMA_KAYMA || Math.abs(t.clientY - bas.y) > UZUN_BASMA_KAYMA) iptal();
    };
    const bitti = () => {
      // Basılı tutma menüyü açtıysa: parmağın kalkmasıyla gelen tıklama menüyü kapatmasın.
      if (menuAcildi) { acilisAniRef.current = Date.now(); menuAcildi = false; }
      iptal();
    };

    document.addEventListener("touchstart", basla, { passive: true });
    document.addEventListener("touchmove", hareket, { passive: true });
    document.addEventListener("touchend", bitti, { passive: true });
    document.addEventListener("touchcancel", bitti, { passive: true });
    return () => {
      iptal();
      document.removeEventListener("touchstart", basla);
      document.removeEventListener("touchmove", hareket);
      document.removeEventListener("touchend", bitti);
      document.removeEventListener("touchcancel", bitti);
    };
  }, [sayfa, menuAc]);

  // Menü; tıklama, kaydırma, Esc ve sayfa değişiminde kapanır.
  useEffect(() => {
    if (!menu) return;
    const kapat = () => {
      if (Date.now() - acilisAniRef.current < KAPATMA_KORUMA_MS) return;  // açılışın hemen ardındaki olay
      setMenu(null);
    };
    const tus = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("click", kapat);
    document.addEventListener("scroll", kapat, true);
    window.addEventListener("resize", kapat);
    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("click", kapat);
      document.removeEventListener("scroll", kapat, true);
      window.removeEventListener("resize", kapat);
      document.removeEventListener("keydown", tus);
    };
  }, [menu]);

  // Başka ekrana geçilince açık menü kapansın (React'in önerdiği "render sırasında düzelt" kalıbı;
  // efekt içinde setState cascading render'a yol açıyor).
  const [sonYol, setSonYol] = useState(pathname);
  if (pathname !== sonYol) { setSonYol(pathname); setMenu(null); }

  // ── Pencereyi aç: videoyu getir ───────────────────────────────────────────────────────────
  const pencereAc = useCallback(async () => {
    if (!sayfa) return;
    setMenu(null);
    setAcik(true);
    setDurum({ tip: "yukleniyor" });
    setOynuyor(false); setAn(0); setToplam(0);
    try {
      const y = await fetch(`/api/tanitim-video?sayfa=${encodeURIComponent(sayfa.slug)}`, { cache: "no-store" });
      const veri = await y.json().catch(() => null) as { var?: boolean; url?: string; error?: string } | null;
      if (!y.ok) {
        setDurum({ tip: "hata", mesaj: veri?.error ?? `Sunucu ${y.status} döndü.` });
        return;
      }
      if (!veri?.var || !veri.url) { setDurum({ tip: "yok" }); return; }
      setDurum({ tip: "hazir", url: veri.url });
    } catch (e) {
      setDurum({ tip: "hata", mesaj: e instanceof Error ? e.message : "Bağlantı kurulamadı." });
    }
  }, [sayfa]);

  // Üst bardaki klaket düğmesi (telefonda görünür yol) bu olayı yayar; menüye hiç uğramadan
  // doğrudan video penceresini açar.
  useEffect(() => {
    const ac = () => { setMenu(null); void pencereAc(); };
    window.addEventListener(TANITIM_OLAY, ac);
    return () => window.removeEventListener(TANITIM_OLAY, ac);
  }, [pencereAc]);

  const pencereKapat = useCallback(() => {
    videoRef.current?.pause();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setAcik(false);
  }, []);

  // ── Oynatma düğmeleri ─────────────────────────────────────────────────────────────────────
  const oynatDurdur = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play().catch(() => {}); } else { v.pause(); }
  }, []);

  const atla = useCallback((saniye: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + saniye), v.duration || 0);
  }, []);

  const sesAyarla = useCallback((deger: number) => {
    const v = videoRef.current;
    const yeni = Math.min(1, Math.max(0, deger));
    setSes(yeni);
    if (v) { v.volume = yeni; v.muted = yeni === 0; }
    setSessiz(yeni === 0);
  }, []);

  const sessizDegistir = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const yeni = !v.muted;
    v.muted = yeni;
    setSessiz(yeni);
  }, []);

  // Tam ekran. iPhone/iPad Safari kutuyu (div) tam ekrana ALMAZ; orada videonun kendi
  // webkitEnterFullscreen'i kullanılır — yoksa düğme sessizce hiçbir şey yapmış olurdu.
  const tamEkran = useCallback(() => {
    const k = kutuRef.current;
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    if (k?.requestFullscreen && document.fullscreenEnabled) {
      void k.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
      return;
    }
    v?.webkitEnterFullscreen?.();
  }, []);

  // Klavye: boşluk oynat/durdur, ok tuşları sarma ve ses, Esc kapat.
  useEffect(() => {
    if (!acik) return;
    const tus = (e: KeyboardEvent) => {
      const hedef = e.target as HTMLElement | null;
      if (hedef && /^(INPUT|TEXTAREA|SELECT)$/.test(hedef.tagName)) return;  // kaydırıcıdayken karışma
      if (e.key === "Escape") { pencereKapat(); return; }
      if (durum.tip !== "hazir") return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); oynatDurdur(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); atla(ATLAMA_SANIYE); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); atla(-ATLAMA_SANIYE); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sesAyarla((videoRef.current?.volume ?? 1) + 0.1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); sesAyarla((videoRef.current?.volume ?? 1) - 0.1); }
      else if (e.key === "m") { sessizDegistir(); }
      else if (e.key === "f") { tamEkran(); }
    };
    document.addEventListener("keydown", tus);
    return () => document.removeEventListener("keydown", tus);
  }, [acik, durum.tip, pencereKapat, oynatDurdur, atla, sesAyarla, sessizDegistir, tamEkran]);

  if (!sayfa) return null;

  return (
    <>
      {/* ── Sağ tık menüsü ── */}
      {menu && (
        <div
          className="fixed z-[200] rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
          style={{ left: menu.x, top: menu.y, minWidth: 224 }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={pencereAc}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#1E3A5F] hover:bg-slate-100"
          >
            <Clapperboard size={16} className="shrink-0 text-[#F97316]" />
            <span className="flex flex-col">
              <span className="font-medium">Sayfayı Tanı</span>
              <span className="text-[11px] text-gray-500">{sayfa.baslik} tanıtım videosu</span>
            </span>
          </button>
        </div>
      )}

      {/* ── Video penceresi ── */}
      {acik && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-3"
          // Dışarı tıklayınca kapanır. AMA kapanma yalnız tıklama DIŞARIDA BAŞLADIYSA: ses/gezinme
          // sürgüsünü sürükleyip fareyi pencere dışında bırakan kullanıcının videosu kapanmasın.
          onMouseDown={(e) => { disardaBasildiRef.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (e.target === e.currentTarget && disardaBasildiRef.current) pencereKapat(); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div
            className="w-[min(94vw,900px)] overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Başlık */}
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Clapperboard size={18} className="shrink-0 text-[#F97316]" />
                <span className="truncate text-sm font-semibold text-[#1E3A5F]">
                  {sayfa.baslik} — Tanıtım
                </span>
              </div>
              <button type="button" onClick={pencereKapat} title="Kapat (Esc)"
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            {/* Görüntü alanı — pencere boyu duruma göre ZIPLAMASIN diye her hâlde aynı oranda. */}
            <div ref={kutuRef} className="relative aspect-video w-full bg-black">
              {durum.tip === "hazir" ? (
                <video
                  ref={videoRef}
                  src={durum.url}
                  className="h-full w-full object-contain"
                  autoPlay
                  playsInline
                  onClick={oynatDurdur}
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    setToplam(v.duration || 0);
                    v.volume = ses; v.muted = sessiz; v.playbackRate = hiz;
                  }}
                  onTimeUpdate={(e) => setAn(e.currentTarget.currentTime)}
                  onPlay={() => setOynuyor(true)}
                  onPause={() => setOynuyor(false)}
                  onVolumeChange={(e) => { setSes(e.currentTarget.volume); setSessiz(e.currentTarget.muted); }}
                  onError={() => setDurum({ tip: "hata", mesaj: "Video dosyası açılamadı (bozuk olabilir ya da adresin süresi dolmuş)." })}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
                  {durum.tip === "yukleniyor" && (
                    <>
                      <Loader2 size={28} className="animate-spin text-white/70" />
                      <span className="text-sm text-white/70">Video hazırlanıyor…</span>
                    </>
                  )}
                  {durum.tip === "yok" && (
                    <>
                      <Clapperboard size={30} className="text-white/50" />
                      <span className="text-sm font-medium text-white/85">
                        Bu ekranın tanıtım videosu henüz yüklenmemiş.
                      </span>
                      <span className="text-xs text-white/50">
                        Beklenen dosya: tanitim/{sayfa.slug}.mp4
                      </span>
                    </>
                  )}
                  {durum.tip === "hata" && (
                    <>
                      <span className="text-sm font-medium text-red-300">Video getirilemedi</span>
                      <span className="text-xs text-white/60">{durum.mesaj}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Kumanda çubuğu */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-200 px-3 py-2">
              <button type="button" onClick={() => atla(-ATLAMA_SANIYE)} disabled={durum.tip !== "hazir"}
                title={`${ATLAMA_SANIYE} sn geri (←)`}
                className="rounded-md p-1.5 text-[#1E3A5F] hover:bg-slate-100 disabled:opacity-30">
                <RotateCcw size={18} />
              </button>
              <button type="button" onClick={oynatDurdur} disabled={durum.tip !== "hazir"}
                title={oynuyor ? "Durdur (boşluk)" : "Oynat (boşluk)"}
                className="rounded-md bg-[#1E3A5F] p-1.5 text-white hover:bg-[#2a4e7d] disabled:opacity-30">
                {oynuyor ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button type="button" onClick={() => atla(ATLAMA_SANIYE)} disabled={durum.tip !== "hazir"}
                title={`${ATLAMA_SANIYE} sn ileri (→)`}
                className="rounded-md p-1.5 text-[#1E3A5F] hover:bg-slate-100 disabled:opacity-30">
                <RotateCw size={18} />
              </button>

              <span className="font-mono text-xs tabular-nums text-gray-600">
                {sureYaz(an)} / {sureYaz(toplam)}
              </span>

              <input
                type="range" min={0} max={toplam || 0} step={0.1} value={an}
                disabled={durum.tip !== "hazir"}
                onChange={(e) => { const v = videoRef.current; if (v) { v.currentTime = Number(e.target.value); setAn(Number(e.target.value)); } }}
                title="Videoda gezin"
                className="h-1.5 min-w-[120px] flex-1 cursor-pointer accent-[#F97316] disabled:opacity-30"
              />

              <button type="button" onClick={sessizDegistir} disabled={durum.tip !== "hazir"}
                title={sessiz ? "Sesi aç (m)" : "Sesi kapat (m)"}
                className="rounded-md p-1.5 text-[#1E3A5F] hover:bg-slate-100 disabled:opacity-30">
                {sessiz || ses === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              {/* Ses düzeyi sürgüsü telefonda GİZLİ: iOS'ta video.volume salt okunur, sürgü
                  oynatılsa bile hiçbir şey olmaz. Telefonda ses tuşları + sustur düğmesi kullanılır. */}
              <input
                type="range" min={0} max={1} step={0.05} value={sessiz ? 0 : ses}
                disabled={durum.tip !== "hazir"}
                onChange={(e) => sesAyarla(Number(e.target.value))}
                title="Ses düzeyi (↑ ↓)"
                className="hidden h-1.5 w-20 cursor-pointer accent-[#1E3A5F] disabled:opacity-30 sm:block"
              />

              <select
                value={hiz} disabled={durum.tip !== "hazir"}
                onChange={(e) => { const h = Number(e.target.value); setHiz(h); if (videoRef.current) videoRef.current.playbackRate = h; }}
                title="Oynatma hızı"
                className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs text-[#1E3A5F] disabled:opacity-30"
              >
                {HIZLAR.map((h) => <option key={h} value={h}>{h}x</option>)}
              </select>

              <button type="button" onClick={tamEkran} disabled={durum.tip !== "hazir"}
                title="Tam ekran (f)"
                className="rounded-md p-1.5 text-[#1E3A5F] hover:bg-slate-100 disabled:opacity-30">
                <Maximize2 size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
