"use client";

// Dashboard'da CUMARTESİ günü gösterilen "yedek al" hatırlatması.
// Durum PAYLAŞIMLI (DB): herhangi bir kullanıcı yedek alınca o gün işaretlenir → uyarı HERKESTE kalkar.
// Sekmeye geri dönüldüğünde (focus) yeniden kontrol eder → yedek alıp dönünce kaybolur.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Database, ArrowRight } from "lucide-react";
import { yedekAlindiMi } from "@/lib/supabase/queries/yedek-kaydi";

function bugunStr(): string {
  const d = new Date(); // yerel = Türkiye saati (PC saat dilimi TR)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function YedekHatirlatma() {
  const [goster, setGoster] = useState(false);

  useEffect(() => {
    let iptal = false;
    const kontrol = async () => {
      const cumartesi = new Date().getDay() === 6; // 0=Pazar … 6=Cumartesi
      if (!cumartesi) { if (!iptal) setGoster(false); return; }
      // PAYLAŞIMLI: bugün herhangi bir kullanıcı yedek aldıysa herkeste gizle
      const alindi = await yedekAlindiMi(bugunStr());
      if (!iptal) setGoster(!alindi);
    };
    void kontrol();
    const onFocus = () => void kontrol(); // yedek alıp dönünce gizlensin
    window.addEventListener("focus", onFocus);
    return () => { iptal = true; window.removeEventListener("focus", onFocus); };
  }, []);

  if (!goster) return null;

  return (
    <Link
      href="/dashboard/yedek"
      className="flex items-center gap-3 mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm transition-colors hover:bg-amber-100"
    >
      <Database size={22} className="shrink-0 text-amber-600" />
      <div className="flex-1">
        <div className="font-semibold">📅 Bugün Cumartesi — verilerin yedeğini almayı unutmayın!</div>
        <div className="text-xs text-amber-700">Haftalık yedek günü. Yedek aldığınızda bu hatırlatma kaybolur.</div>
      </div>
      <span className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white">
        Yedek Al <ArrowRight size={15} />
      </span>
    </Link>
  );
}
