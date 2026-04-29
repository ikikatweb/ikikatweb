// Üst bar bileşeni - Tarih/saat, kullanıcı adı, rol badge ve çıkış butonu
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Menu, LogOut, Clock, Mail } from "lucide-react";
import toast from "react-hot-toast";
import PushBildirimMenu from "@/components/shared/push-bildirim-menu";
import { getOkunmamisToplam } from "@/lib/supabase/queries/mesajlasma";

type TopbarProps = {
  onMenuToggle: () => void;
};

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

  // Mesaj okunmamış sayısı — 30 sn'de bir çek
  useEffect(() => {
    if (!kullanici?.id) return;
    const cek = async () => {
      try {
        const sayi = await getOkunmamisToplam(kullanici.id);
        setMesajOkunmamis(sayi);
      } catch { /* sessiz */ }
    };
    cek();
    const interval = setInterval(cek, 30_000);
    return () => clearInterval(interval);
  }, [kullanici?.id]);

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
