"use client";

// Dashboard'da CUMARTESİ günü gösterilen "yedek al" hatırlatması.
// Yedek alındığında (Yedek Al sayfasında indirilince localStorage'a "sonYedekTarihi" yazılır) gizlenir.
// Sekmeye geri dönüldüğünde (focus) yeniden kontrol eder → yedek alıp dönünce kaybolur.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Database, ArrowRight } from "lucide-react";

function bugunStr(): string {
  const d = new Date(); // yerel = Türkiye saati (PC saat dilimi TR)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function YedekHatirlatma() {
  const [goster, setGoster] = useState(false);

  useEffect(() => {
    const kontrol = () => {
      const cumartesi = new Date().getDay() === 6; // 0=Pazar … 6=Cumartesi
      let sonYedek: string | null = null;
      try { sonYedek = localStorage.getItem("sonYedekTarihi"); } catch { /* yoksay */ }
      setGoster(cumartesi && sonYedek !== bugunStr()); // bugün yedek alındıysa gösterme
    };
    kontrol();
    window.addEventListener("focus", kontrol); // yedek alıp dönünce gizlensin
    return () => window.removeEventListener("focus", kontrol);
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
