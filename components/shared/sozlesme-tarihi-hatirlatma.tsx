"use client";

// Dashboard uyarısı: "Henüz Sözleşme imzalanmadı" ile boş kaydedilmiş (sozlesme_tarihi yok) aktif işlerde,
// iş oluşturulduktan 7 gün sonra "sözleşme tarihini girin" hatırlatması. İş Deneyim Belgeleri'ne yönlendirir.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks";
import { getSozlesmeTarihiEksikleri, type SozlesmeTarihiEksik } from "@/lib/supabase/queries/santiyeler";

export default function SozlesmeTarihiHatirlatma() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const yetkili = hasPermission("yonetim-santiyeler", "duzenle") || hasPermission("yonetim-santiyeler", "ekle");
  const [kayitlar, setKayitlar] = useState<SozlesmeTarihiEksik[]>([]);

  useEffect(() => {
    if (!yetkili) return; // yetki yoksa hiç çekme; render zaten null döner
    let iptal = false;
    const kontrol = async () => {
      const veri = await getSozlesmeTarihiEksikleri();
      if (!iptal) setKayitlar(veri);
    };
    void kontrol();
    const onFocus = () => void kontrol(); // tarih girilip dönünce güncellensin
    window.addEventListener("focus", onFocus);
    return () => { iptal = true; window.removeEventListener("focus", onFocus); };
  }, [yetkili]);

  if (!yetkili || kayitlar.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-amber-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {kayitlar.length} iş için sözleşme tarihi girilmeli
          </div>
          <div className="text-xs text-amber-700">
            &quot;Henüz Sözleşme imzalanmadı&quot; işaretlenip 7 günden fazla süredir tarih girilmemiş işler.
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/dashboard/yonetim/santiyeler")}
          className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          İş Deneyim <ArrowRight size={13} />
        </button>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {kayitlar.map((k) => (
          <li key={k.santiye_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-amber-900">{k.is_adi}</span>
            <span className="text-xs font-semibold text-amber-700">
              {k.gunGecti === 0 ? "süre bugün doldu" : `${k.gunGecti} gündür bekliyor`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
