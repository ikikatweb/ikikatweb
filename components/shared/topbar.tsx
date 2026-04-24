// Üst bar bileşeni - Tarih/saat, kullanıcı adı, rol badge ve çıkış butonu
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Menu, LogOut, Clock } from "lucide-react";
import toast from "react-hot-toast";
import PushBildirimButonu from "@/components/shared/push-bildirim-butonu";

type TopbarProps = {
  onMenuToggle: () => void;
};

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const router = useRouter();
  const { kullanici } = useAuth();
  const [tarihSaat, setTarihSaat] = useState("");

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

        {/* Push Bildirim Aç/Kapat */}
        <PushBildirimButonu />

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
