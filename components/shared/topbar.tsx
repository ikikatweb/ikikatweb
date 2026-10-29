// Üst bar bileşeni - Tarih/saat, kullanıcı adı, rol badge ve çıkış butonu
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks";
import { Menu, LogOut, Clock, X, KeyRound, ZoomIn, Plus, Minus, ChevronDown, UserCog } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import PushBildirimMenu from "@/components/shared/push-bildirim-menu";
import SifreDegistirDialog from "@/components/shared/sifre-degistir-dialog";

// Yazı boyutu ayarları (eski FontSizeAyari component'inden taşındı)
const FONT_LS_KEY = "site-font-zoom";
const FONT_VARSAYILAN_PX = 16;
// 10'ar 10'ar artan/azalan adımlar
const FONT_SECENEKLER = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
const FONT_ADIM = 10;

function uygulaFontPx(zoomYuzde: number) {
  if (typeof document === "undefined") return;
  const px = (zoomYuzde / 100) * FONT_VARSAYILAN_PX;
  document.documentElement.style.fontSize = `${px}px`;
}

// Tercihi COOKIE'ye de yaz: root layout SSR'da okuyup <html>'e inline stil basar → sonraki
// açılışlarda flicker'sız (localStorage'a inline <script> gerekmiyor; script React uyarısı veriyordu).
function yazFontCookie(zoomYuzde: number) {
  if (typeof document === "undefined") return;
  try { document.cookie = `${FONT_LS_KEY}=${zoomYuzde}; path=/; max-age=31536000; samesite=lax`; } catch { /* sessiz */ }
}

type TopbarProps = {
  onMenuToggle: () => void;
};

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const router = useRouter();
  const { kullanici, isYonetici, isShantiyeAdmin } = useAuth();
  const [tarihSaat, setTarihSaat] = useState("");
  const [sifreDialogOpen, setSifreDialogOpen] = useState(false);
  const [menuAcik, setMenuAcik] = useState(false);
  const [zoomAcik, setZoomAcik] = useState(false);
  const [zoomYuzde, setZoomYuzde] = useState<number>(100);
  const menuRef = useRef<HTMLDivElement>(null);

  // Font size — saved değeri yükle ve uygula
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FONT_LS_KEY);
      if (saved) {
        const y = parseInt(saved, 10);
        if (Number.isFinite(y) && y >= 50 && y <= 200) {
          setZoomYuzde(y);
          uygulaFontPx(y);
          yazFontCookie(y); // eski (yalnız localStorage'lı) tercihi cookie'ye taşı → sonraki açılış SSR'dan gelir
        }
      }
    } catch { /* sessiz */ }
  }, []);

  // Menü dışına tıklayınca kapat (zoom alt menüsünü de kapat)
  useEffect(() => {
    if (!menuAcik) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuAcik(false);
        setZoomAcik(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuAcik]);

  function ayarlaZoom(yeniYuzde: number) {
    const clamp = Math.max(50, Math.min(200, yeniYuzde));
    setZoomYuzde(clamp);
    uygulaFontPx(clamp);
    try { window.localStorage.setItem(FONT_LS_KEY, String(clamp)); } catch { /* sessiz */ }
    yazFontCookie(clamp);
  }
  function azaltZoom() {
    const yeni = Math.round((zoomYuzde - FONT_ADIM) / FONT_ADIM) * FONT_ADIM;
    ayarlaZoom(yeni);
  }
  function arttirZoom() {
    const yeni = Math.round((zoomYuzde + FONT_ADIM) / FONT_ADIM) * FONT_ADIM;
    ayarlaZoom(yeni);
  }

  useEffect(() => {
    function guncelle() {
      const n = new Date();
      const t = n.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const s = n.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setTarihSaat(`${t} ${s}`);
    }
    guncelle();
    const timer = setInterval(guncelle, 1000);
    return () => clearInterval(timer);
  }, []);

  const displayName = kullanici?.ad_soyad || kullanici?.kullanici_adi || "";

  async function handleLogout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success("Çıkış yapıldı.");
      // SERT yönlendirme: router.push (soft-nav) mobil/PWA'da eski oturum ağacını taşıyıp bazen login'e
      // düşürüyordu. window.location tam sayfa yükler → oturum tamamen temizlenir, ana sayfaya (public) gider.
      window.location.href = "/";
    } catch {
      toast.error("Çıkış yapılırken bir hata oluştu.");
    }
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-2 rounded-md text-[#1E3A5F] hover:bg-gray-100 transition-colors"
        aria-label="Menüyü aç"
      >
        <Menu size={24} />
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {/* Tarih ve Saat */}
        <div className="flex items-center gap-1.5 text-[#1E3A5F]">
          <Clock size={14} className="hidden sm:block" />
          <span className="text-xs font-medium tabular-nums">{tarihSaat || "\u00A0"}</span>
        </div>

        <div className="hidden sm:block w-px h-6 bg-gray-200" />

        <div className="hidden sm:flex items-center gap-2">
          <span className="text-sm font-medium text-[#1E3A5F]">{displayName}</span>
        </div>

        {/* Bildirim Menüsü — yönetici ve şantiye admini görür (kısıtlı kullanıcıya değil).
            Ayarlar (kategoriler + giriş bildirimi dahil) bu menünün "Ayarlar" sekmesinde; ayrı pencere kaldırıldı. */}
        {(isYonetici || isShantiyeAdmin) && <PushBildirimMenu />}

        {/* Birleşik kullanıcı menüsü: Bilgilerim / Yazı Boyutu / Şifre Değiştir / Çıkış */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuAcik((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#1E3A5F] text-[#1E3A5F] hover:bg-[#1E3A5F] hover:text-white transition-colors"
            title="Kullanıcı Menüsü"
            aria-label="Kullanıcı Menüsü"
            aria-expanded={menuAcik}
          >
            <LogOut size={16} />
            <ChevronDown size={14} className={`transition-transform ${menuAcik ? "rotate-180" : ""}`} />
          </button>

          {menuAcik && (
            <div className="absolute right-0 top-full mt-1 z-[1100] bg-white border border-gray-200 rounded-lg shadow-xl min-w-[220px] overflow-hidden">
              {/* Bilgilerim — kullanıcının kendi değiştirebileceği bilgiler (ad, e-posta, şifre) */}
              <button
                type="button"
                onClick={() => { setMenuAcik(false); setZoomAcik(false); router.push("/dashboard/bilgilerim"); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[#1E3A5F] hover:bg-gray-50 transition-colors text-left border-b border-gray-100"
              >
                <UserCog size={16} />
                Bilgilerim
              </button>

              {/* Yazı Boyutu — varsayılan kapalı, başlığa tıklayınca açılır */}
              <button
                type="button"
                onClick={() => setZoomAcik((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-[#1E3A5F] hover:bg-gray-50 transition-colors text-left border-b border-gray-100"
              >
                <span className="flex items-center gap-2">
                  <ZoomIn size={16} />
                  Yazı Boyutu
                  <span className="text-[10px] text-gray-400 tabular-nums">%{zoomYuzde}</span>
                </span>
                <ChevronDown size={14} className={`transition-transform ${zoomAcik ? "rotate-180" : ""}`} />
              </button>
              {zoomAcik && (
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={azaltZoom}
                      disabled={zoomYuzde <= FONT_SECENEKLER[0]}
                      className="h-7 w-7 flex items-center justify-center rounded-full bg-white border hover:bg-gray-100 disabled:opacity-40 text-[#1E3A5F]"
                      aria-label="Küçült"
                    >
                      <Minus size={14} />
                    </button>
                    <div className="text-sm font-bold text-[#1E3A5F] tabular-nums w-12 text-center">%{zoomYuzde}</div>
                    <button
                      type="button"
                      onClick={arttirZoom}
                      disabled={zoomYuzde >= FONT_SECENEKLER[FONT_SECENEKLER.length - 1]}
                      className="h-7 w-7 flex items-center justify-center rounded-full bg-white border hover:bg-gray-100 disabled:opacity-40 text-[#1E3A5F]"
                      aria-label="Büyüt"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {FONT_SECENEKLER.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ayarlaZoom(s)}
                        className={`text-[10px] py-1 rounded transition-colors ${
                          zoomYuzde === s
                            ? "bg-[#1E3A5F] text-white font-bold"
                            : "bg-white border text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        %{s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Şifre Değiştir */}
              <button
                type="button"
                onClick={() => { setMenuAcik(false); setSifreDialogOpen(true); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[#1E3A5F] hover:bg-gray-50 transition-colors text-left"
              >
                <KeyRound size={16} />
                Şifre Değiştir
              </button>

              {/* Çıkış */}
              <button
                type="button"
                onClick={() => { setMenuAcik(false); handleLogout(); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left border-t border-gray-100"
              >
                <LogOut size={16} />
                Çıkış
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Şifre Değiştir Dialog */}
      <SifreDegistirDialog open={sifreDialogOpen} onOpenChange={setSifreDialogOpen} />
    </header>
  );
}
