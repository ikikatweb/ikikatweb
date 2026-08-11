"use client";

// Dashboard uyarısı: İhaleli+aktif bir işte, işyeri tesliminden sonra `teknik_atama_gun` içinde teknik
// personel ataması (Bordro/İşçilik Takibi'nde) LİSTE KADAR yapılmamışsa uyarır. Son tarih = teslim + gün;
// süre dolmadan geri sayım ("N gün kaldı"), geçince gecikme ("N gün gecikti"). Bordro Takibi'ne yönlendirir.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks";
import { getTeknikAtamaEksikleri, type TeknikAtamaEksik } from "@/lib/supabase/queries/personel-teknik";

// YYYY-MM-DD → DD.MM.YYYY
function ymdToTr(s: string | null): string {
  const m = (s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (s ?? "");
}

export default function TeknikAtamaHatirlatma() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const yetkili = hasPermission("bordro-takibi", "duzenle") || hasPermission("bordro-takibi", "ekle");
  const [kayitlar, setKayitlar] = useState<TeknikAtamaEksik[]>([]);

  useEffect(() => {
    if (!yetkili) return; // yetki yoksa hiç çekme; render zaten null döner
    let iptal = false;
    const kontrol = async () => {
      const veri = await getTeknikAtamaEksikleri();
      if (!iptal) setKayitlar(veri);
    };
    void kontrol();
    const onFocus = () => void kontrol(); // atama yapılıp dönünce güncellensin
    window.addEventListener("focus", onFocus);
    return () => { iptal = true; window.removeEventListener("focus", onFocus); };
  }, [yetkili]);

  if (!yetkili || kayitlar.length === 0) return null;

  const gecikenSayi = kayitlar.filter((k) => k.kalanGun < 0).length;

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-amber-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {kayitlar.length} iş için teknik personel ataması gerekiyor
          </div>
          <div className="text-xs text-amber-700">
            İşyeri tesliminden sonra tanınan süre içinde teknik personel bordroda atanmalı.
            {gecikenSayi > 0 && <span className="font-semibold text-red-700"> {gecikenSayi} tanesi süresi geçmiş.</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/dashboard/bordro-takibi")}
          className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          Bordro Takibi <ArrowRight size={13} />
        </button>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {kayitlar.map((k) => {
          const gecikti = k.kalanGun < 0;
          const sure = gecikti
            ? `${-k.kalanGun} gün gecikti`
            : k.kalanGun === 0 ? "bugün son gün" : `${k.kalanGun} gün kaldı`;
          return (
            <li key={k.santiye_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-amber-900">{k.is_adi}</span>
              <span className="text-xs text-amber-700">
                {k.bazTip === "teslim" ? "teslim" : "sözleşme (teslim girilmemiş)"} {ymdToTr(k.bazTarih)} · son tarih {ymdToTr(k.sonTarih)}
                {k.gunVarsayilan && " · süre 10g (varsayılan)"}
              </span>
              <span className={gecikti ? "text-xs font-semibold text-red-600" : "text-xs font-semibold text-amber-700"}>{sure}</span>
              <span className="text-[11px] text-gray-500">(gereken {k.gereken}, atanan {k.atanan})</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
