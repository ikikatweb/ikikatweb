"use client";

// Dashboard'da her ayın 1'inden itibaren gösterilen "bordro gönder" hatırlatması.
// - BİR ÖNCEKİ (tamamlanan) ayın bordrosu içindir; o dönem gönderilene kadar durur.
// - Yalnız bordro-takibi EKLE veya DÜZENLE yetkisi olanlara gösterilir.
// - Durum PAYLAŞIMLI (DB): herhangi bir yetkili kullanıcı "Bordro Gönder" ile o dönemi gönderince
//   uyarı HERKESTE kalkar. Sekmeye dönünce (focus) yeniden kontrol edilir.
import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks";
import { bordroDonemGonderildiMi } from "@/lib/supabase/queries/bordro-gonderim";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// Bir önceki (tamamlanan) ayın dönem anahtarı ("YYYY-MM") + okunur etiketi.
function oncekiDonem(): { key: string; label: string } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { key, label: `${AYLAR[d.getMonth()]} ${d.getFullYear()}` };
}

export default function BordroHatirlatma() {
  const { hasPermission } = useAuth();
  const yetkili = hasPermission("bordro-takibi", "ekle") || hasPermission("bordro-takibi", "duzenle");
  const [goster, setGoster] = useState(false);
  const [donem, setDonem] = useState(oncekiDonem());

  useEffect(() => {
    if (!yetkili) { setGoster(false); return; }
    let iptal = false;
    const kontrol = async () => {
      const d = oncekiDonem();
      const gonderildi = await bordroDonemGonderildiMi(d.key);
      if (!iptal) { setDonem(d); setGoster(!gonderildi); }
    };
    void kontrol();
    const onFocus = () => void kontrol(); // bordro gönderilip dönülünce gizlensin
    window.addEventListener("focus", onFocus);
    return () => { iptal = true; window.removeEventListener("focus", onFocus); };
  }, [yetkili]);

  if (!goster) return null;

  return (
    <Link
      href={`/dashboard/bordro-takibi?ay=${donem.key}`}
      className="flex items-center gap-3 mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm transition-colors hover:bg-amber-100"
    >
      <FileSpreadsheet size={22} className="shrink-0 text-amber-600" />
      <div className="flex-1">
        <div className="font-semibold">🧾 {donem.label} bordrosunu göndermeyi unutmayın!</div>
        <div className="text-xs text-amber-700">Bordro muhasebeye gönderildiğinde bu hatırlatma kaybolur.</div>
      </div>
      <span className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white">
        Bordro Gönder <ArrowRight size={15} />
      </span>
    </Link>
  );
}
