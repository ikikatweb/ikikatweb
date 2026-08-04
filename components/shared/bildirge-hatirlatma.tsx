"use client";

// Dashboard uyarısı: muhasebeye işe giriş / işten çıkış maili gönderildi ama SGK bildirgesi
// (cevap PDF'i) henüz gelmedi → "bugün gönderilip cevabı gelmeyen" talepleri gösterir.
// Kayıtlar app/api/bordro-mail-bulk açar; scripts/personel-bildirge-sync cevabı yakalayınca kapatır
// → uyarı otomatik kalkar. Sekmeye dönünce (focus) yeniden kontrol edilir.
import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { getBekleyenBildirgeler, bildirgeTarihiniKabulEt, type PersonelIslemTakip } from "@/lib/supabase/queries/personel-islem-takip";

// TR bugünün YYYY-MM-DD değeri
function trBugun(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
}
// YYYY-MM-DD → DD.MM.YYYY
function ymdToTr(s: string | null): string {
  const m = (s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (s ?? "");
}
function gunFarki(fromYmd: string, todayYmd: string): number {
  const a = new Date(fromYmd + "T00:00:00").getTime();
  const b = new Date(todayYmd + "T00:00:00").getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export default function BildirgeHatirlatma() {
  const { hasPermission } = useAuth();
  const yetkili = hasPermission("bordro-takibi", "ekle") || hasPermission("bordro-takibi", "duzenle");
  const [kayitlar, setKayitlar] = useState<PersonelIslemTakip[]>([]);
  const [dozeltiliyor, setDozeltiliyor] = useState<string | null>(null);
  const [acik, setAcik] = useState(false); // fazla isimde: varsayılan 2 göster, ok tuşuyla açılır

  useEffect(() => {
    if (!yetkili) { setKayitlar([]); return; }
    let iptal = false;
    const kontrol = async () => {
      const veri = await getBekleyenBildirgeler();
      if (!iptal) setKayitlar(veri);
    };
    void kontrol();
    const onFocus = () => void kontrol(); // cevap gelip kapanınca dönünce gizlensin
    window.addEventListener("focus", onFocus);
    return () => { iptal = true; window.removeEventListener("focus", onFocus); };
  }, [yetkili]);

  // "Düzelt" — bildirgedeki resmi tarihi kaydımıza uygula ve talebi kapat (muhasebe geç işlediğinde)
  const dozelt = async (k: PersonelIslemTakip) => {
    if (!k.bildirge_tarihi) return;
    setDozeltiliyor(k.id);
    const res = await bildirgeTarihiniKabulEt(k.id);
    setDozeltiliyor(null);
    if (res.ok) {
      setKayitlar((prev) => prev.filter((x) => x.id !== k.id));
      const bordroNot = res.atamaGuncellendi > 0 ? " (bordro da düzeltildi)" : " (bordroda eşleşen kayıt bulunamadı)";
      toast.success(`${k.personel_ad}: tarih ${ymdToTr(k.bildirge_tarihi)} olarak düzeltildi${bordroNot}.`, { duration: toastSuresi() });
    } else {
      toast.error("Düzeltilemedi.", { duration: toastSuresi() });
    }
  };

  if (!yetkili || kayitlar.length === 0) return null;

  const bugun = trBugun();
  const gecikmis = kayitlar.filter((k) => gunFarki(k.gonderim_tarihi, bugun) >= 1).length;
  const uyusmazlikSayi = kayitlar.filter((k) => k.uyusmazlik).length;

  return (
    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-red-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {kayitlar.length} işlem için bildirge bekleniyor
          </div>
          <div className="text-xs text-red-700">
            Muhasebeye giriş/çıkış maili gönderildi, işe giriş/çıkış bildirgesi (cevap) henüz gelmedi.
            {gecikmis > 0 && <span className="font-semibold"> {gecikmis} tanesi gün aşımında.</span>}
            {uyusmazlikSayi > 0 && <span className="font-semibold text-red-800"> {uyusmazlikSayi} tanesinde gelen bildirge kayıtla uyuşmuyor.</span>}
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {(acik ? kayitlar : kayitlar.slice(0, 2)).map((k) => {
          const fark = gunFarki(k.gonderim_tarihi, bugun);
          const gecikme = fark >= 1 ? ` — ${fark} gün gecikti` : " — bugün bekliyor";
          return (
            <li key={k.id}>
              <div className="flex items-center gap-2">
                <span className={k.tip === "giris" ? "text-emerald-700 font-medium" : "text-red-700 font-medium"}>
                  {k.tip === "giris" ? "İşe giriş" : "İşten çıkış"}
                </span>
                <span className="text-red-900">{k.personel_ad}</span>
                <span className={fark >= 1 ? "text-red-600 text-xs font-semibold" : "text-red-500 text-xs"}>{gecikme}</span>
              </div>
              {k.uyusmazlik && (
                <div className="mt-0.5 flex items-start gap-2 rounded-md bg-amber-100 border border-amber-300 px-2 py-1 text-xs text-amber-900">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
                  <span className="flex-1">{k.uyusmazlik}</span>
                  {k.bildirge_tarihi && (
                    <button
                      type="button"
                      onClick={() => dozelt(k)}
                      disabled={dozeltiliyor === k.id}
                      title={`Kaydınızı ${ymdToTr(k.islem_tarihi)} → ${ymdToTr(k.bildirge_tarihi)} olarak düzeltip kapat`}
                      className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      <Check size={12} /> {ymdToTr(k.bildirge_tarihi)} olarak düzelt
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {kayitlar.length > 2 && (
        <button
          type="button"
          onClick={() => setAcik((v) => !v)}
          className="mt-1 ml-9 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          {acik
            ? <><ChevronUp size={14} /> Gizle</>
            : <><ChevronDown size={14} /> {kayitlar.length - 2} işlem daha göster</>}
        </button>
      )}
    </div>
  );
}
