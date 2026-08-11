"use client";

// Dashboard uyarısı: İHALELİ + AKTİF bir iş (İş Deneyim Belgeleri) eklendikten 1 gün sonra hâlâ
// İşçilik Takibi'nde SİCİL NO ve/veya ASGARİ İŞÇİLİK ORANI girilmemişse uyarır ve bu bilgileri
// satır içinde girip kaydetmeye olanak tanır (upsertIscilikTakibi → iscilik_takibi).
import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { getEksikIscilikBilgileri, upsertIscilikTakibi, type EksikIscilikBilgi } from "@/lib/supabase/queries/iscilik-takibi";

export default function IscilikBilgiHatirlatma() {
  const { hasPermission } = useAuth();
  const yetkili = hasPermission("iscilik-takibi", "duzenle") || hasPermission("iscilik-takibi", "ekle");
  const [kayitlar, setKayitlar] = useState<EksikIscilikBilgi[]>([]);
  const [sicilInput, setSicilInput] = useState<Record<string, string>>({});
  const [oranInput, setOranInput] = useState<Record<string, string>>({});
  const [kaydediliyor, setKaydediliyor] = useState<string | null>(null);

  useEffect(() => {
    if (!yetkili) { setKayitlar([]); return; }
    let iptal = false;
    const kontrol = async () => {
      const veri = await getEksikIscilikBilgileri();
      if (!iptal) setKayitlar(veri);
    };
    void kontrol();
    const onFocus = () => void kontrol(); // başka sekmede girilince dönünce gizlensin
    window.addEventListener("focus", onFocus);
    return () => { iptal = true; window.removeEventListener("focus", onFocus); };
  }, [yetkili]);

  const kaydet = async (k: EksikIscilikBilgi) => {
    const updates: Record<string, unknown> = {};
    if (k.sicilEksik) {
      const v = (sicilInput[k.santiye_id] ?? "").trim();
      if (!v) { toast.error("Sicil numarası girin.", { duration: toastSuresi() }); return; }
      updates.sicil_no = v;
    }
    if (k.oranEksik) {
      const ham = (oranInput[k.santiye_id] ?? "").trim().replace(",", ".");
      const n = parseFloat(ham);
      if (!ham || !Number.isFinite(n) || n <= 0) { toast.error("Geçerli bir işçilik oranı girin.", { duration: toastSuresi() }); return; }
      updates.iscilik_orani = n;
    }
    setKaydediliyor(k.santiye_id);
    try {
      await upsertIscilikTakibi(k.santiye_id, updates);
      setKayitlar((prev) => prev.filter((x) => x.santiye_id !== k.santiye_id));
      toast.success(`${k.is_adi}: bilgiler kaydedildi.`, { duration: toastSuresi() });
    } catch {
      toast.error("Kaydedilemedi.", { duration: toastSuresi() });
    } finally {
      setKaydediliyor(null);
    }
  };

  if (!yetkili || kayitlar.length === 0) return null;

  const mesaj = (k: EksikIscilikBilgi): string => {
    const parca = k.sicilEksik && k.oranEksik
      ? "sicil numarası ve Asgari işçilik oranı bilgileri"
      : k.sicilEksik ? "sicil numarası" : "Asgari işçilik oranı";
    return `${k.is_adi} işine ilişkin ${parca} girilmemiştir.`;
  };

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-amber-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {kayitlar.length} iş için sicil / işçilik oranı eksik
          </div>
          <div className="text-xs text-amber-700">
            İhaleli işlerin İşçilik Takibi bilgileri (sicil numarası ve Asgari işçilik oranı) henüz girilmemiş. Aşağıdan girebilirsiniz.
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-2 pl-9 text-sm">
        {kayitlar.map((k) => (
          <li key={k.santiye_id}>
            <div className="text-amber-900">{mesaj(k)}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {k.sicilEksik && (
                <input
                  type="text"
                  value={sicilInput[k.santiye_id] ?? ""}
                  onChange={(e) => setSicilInput((s) => ({ ...s, [k.santiye_id]: e.target.value }))}
                  placeholder="Sicil numarası (ör. 4 4100 01 …)"
                  className="w-64 max-w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-gray-800 focus:border-amber-500 focus:outline-none"
                />
              )}
              {k.oranEksik && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={oranInput[k.santiye_id] ?? ""}
                    onChange={(e) => setOranInput((s) => ({ ...s, [k.santiye_id]: e.target.value }))}
                    placeholder="İşçilik oranı"
                    className="w-28 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-gray-800 focus:border-amber-500 focus:outline-none"
                  />
                  <span className="text-xs text-amber-700">%</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => kaydet(k)}
                disabled={kaydediliyor === k.santiye_id}
                className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Check size={13} /> Kaydet
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
