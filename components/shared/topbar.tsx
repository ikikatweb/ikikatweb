// Üst bar bileşeni - Tarih/saat, kullanıcı adı, rol badge ve çıkış butonu
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Menu, LogOut, Clock, Mail, MessageSquare, X } from "lucide-react";
import toast from "react-hot-toast";
import PushBildirimMenu from "@/components/shared/push-bildirim-menu";
import { getKonusmalar } from "@/lib/supabase/queries/mesajlasma";

type TopbarProps = {
  onMenuToggle: () => void;
};

// Yeni mesaj toast'ı — sağ alt köşede gözükür, üzerine tıklanırsa konuşmaya gider
function yeniMesajToastGoster(p: {
  konusmaId: string;
  gonderen: string;
  icerik: string;
  grupBaslik: string | null;
  onClick: () => void;
}) {
  toast.custom(
    (t) => (
      <div
        onClick={() => { p.onClick(); toast.dismiss(t.id); }}
        className={`${t.visible ? "animate-in slide-in-from-bottom-4" : "animate-out slide-out-to-bottom-4"} cursor-pointer bg-white border border-gray-200 shadow-2xl rounded-lg px-3 py-2.5 max-w-sm flex items-start gap-2.5 hover:bg-blue-50 transition-colors`}
      >
        <div className="bg-[#1E3A5F] text-white p-1.5 rounded-full flex-shrink-0">
          <MessageSquare size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-[#1E3A5F] truncate">
              {p.grupBaslik ? `${p.grupBaslik} · ${p.gonderen}` : p.gonderen}
            </span>
          </div>
          <div className="text-xs text-gray-600 truncate mt-0.5">{p.icerik}</div>
          <div className="text-[10px] text-blue-500 mt-1">Görmek için tıkla →</div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          aria-label="Kapat"
        >
          <X size={14} />
        </button>
      </div>
    ),
    {
      position: "bottom-right",
      duration: 6000,
      id: `mesaj-${p.konusmaId}-${Date.now()}`,
    },
  );
}

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const router = useRouter();
  const { kullanici, isYonetici, isShantiyeAdmin } = useAuth();
  const [tarihSaat, setTarihSaat] = useState("");
  const [mesajOkunmamis, setMesajOkunmamis] = useState(0);

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

  // Mesaj okunmamış sayısı + yeni gelen mesaj toast'ı (PC sağ alt köşe)
  // İlk yükleme: prev state'i doldur, toast gösterme
  // Sonraki yüklemeler: yeni mesaj varsa toast göster
  const oncekiMesajRef = useRef<Map<string, string>>(new Map()); // konusma_id → son mesaj created_at
  const ilkYuklemeRef = useRef(true);
  useEffect(() => {
    if (!kullanici?.id) return;
    const cek = async () => {
      try {
        const konusmalar = await getKonusmalar(kullanici.id);
        // Toplam okunmamış sayısını güncelle
        const toplam = konusmalar.reduce((s, k) => s + k.okunmamisSayisi, 0);
        setMesajOkunmamis(toplam);

        // Yeni mesaj tespiti — sadece ilk yükleme sonrası ve PC'de
        const isPC = typeof window !== "undefined" && window.innerWidth >= 768;
        if (!ilkYuklemeRef.current && isPC) {
          // Mevcut sayfada mesajlaşma sekmesi açıksa toast gösterme (rahatsız etmesin)
          const mesajlasmaSayfasinda = window.location.pathname.startsWith("/dashboard/mesajlasma");
          if (!mesajlasmaSayfasinda) {
            for (const k of konusmalar) {
              if (!k.sonMesaj) continue;
              const onceki = oncekiMesajRef.current.get(k.id);
              const guncel = k.sonMesaj.created_at;
              // Yeni veya daha güncel bir mesaj var
              if (onceki && guncel > onceki) {
                // Mesaj kendi gönderdiği değilse toast göster
                const benimAdim = kullanici.ad_soyad || kullanici.kullanici_adi;
                if (k.sonMesaj.gonderen_ad !== benimAdim) {
                  yeniMesajToastGoster({
                    konusmaId: k.id,
                    gonderen: k.sonMesaj.gonderen_ad ?? "—",
                    icerik: k.sonMesaj.icerik || "📎 Dosya",
                    grupBaslik: k.tip === "grup" ? (k.baslik || "Grup") : null,
                    // window.location.href ile tam yükleme — sayfa fresh mount olur,
                    // deep link useEffect garantili çalışır (router.push bazen soft nav yapıp atlatabiliyor)
                    onClick: () => { window.location.href = `/dashboard/mesajlasma?konusma=${k.id}`; },
                  });
                }
              }
            }
          }
        }

        // State'i güncelle (ilk yüklemede de doldur ki sonraki diff için baseline olsun)
        const yeniMap = new Map<string, string>();
        for (const k of konusmalar) {
          if (k.sonMesaj) yeniMap.set(k.id, k.sonMesaj.created_at);
        }
        oncekiMesajRef.current = yeniMap;
        ilkYuklemeRef.current = false;
      } catch { /* sessiz */ }
    };
    cek();
    // 10 sn'de bir kontrol — daha hızlı geri bildirim için 30sn yerine
    const interval = setInterval(cek, 10_000);
    return () => clearInterval(interval);
  }, [kullanici?.id, router]);

  const displayName = kullanici?.ad_soyad || kullanici?.kullanici_adi || "";

  async function handleLogout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success("Çıkış yapıldı.");
      router.push("/login");
      router.refresh();
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

        {/* Mesajlaşma ikonu — tüm kullanıcılar */}
        <button
          type="button"
          onClick={() => router.push("/dashboard/mesajlasma")}
          className="relative p-2 rounded-md text-[#1E3A5F] hover:bg-gray-100 transition-colors"
          title="Mesajlar"
        >
          <Mail size={20} />
          {mesajOkunmamis > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-white">
              {mesajOkunmamis > 99 ? "99+" : mesajOkunmamis}
            </span>
          )}
        </button>

        {/* Bildirim Menüsü — yönetici ve şantiye admini görür (kısıtlı kullanıcıya değil) */}
        {(isYonetici || isShantiyeAdmin) && <PushBildirimMenu />}

        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          className="text-[#1E3A5F] border-[#1E3A5F] hover:bg-[#1E3A5F] hover:text-white"
        >
          <LogOut size={16} className="mr-1" />
          <span className="hidden sm:inline">Çıkış</span>
        </Button>
      </div>
    </header>
  );
}
