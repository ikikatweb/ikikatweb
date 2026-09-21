"use client";

// Dashboard uyarısı: poliçe PDF'i mailden okunup OTOMATİK kaydedildi ama poliçeleştirilmesi
// istenen teklifle uyuşmuyor — acente başka firmadan ya da başka rakama kesmiş.
//
// "Tamam" denince uyarı ana ekrandan kalkar (uyari_okundu_at yazılır) ama Acente Takip
// listesindeki kırmızı işaret KALIR: oradaki kayıt kalıcı, buradaki yalnız haber verme amaçlı.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { createClient } from "@/lib/supabase/client";

type PoliceUyarisi = {
  id: string;
  plaka: string;
  police_tipi: "kasko" | "trafik";
  sigorta_firmasi: string | null;
  acente: string | null;
  otomatik_uyari: string;
};

export default function PoliceUyariHatirlatma() {
  const { hasPermission } = useAuth();
  const yetkili = hasPermission("araclar", "duzenle") || hasPermission("araclar", "ekle");
  const [kayitlar, setKayitlar] = useState<PoliceUyarisi[]>([]);
  const [kapatiliyor, setKapatiliyor] = useState<string | null>(null);

  const kontrol = useCallback(async () => {
    const sb = createClient();
    const { data } = await sb
      .from("arac_police")
      .select("id, police_tipi, sigorta_firmasi, acente, otomatik_uyari, araclar(plaka)")
      .not("otomatik_uyari", "is", null)
      .is("uyari_okundu_at", null)
      .order("created_at", { ascending: false });
    const satirlar = (data ?? []) as unknown as (Omit<PoliceUyarisi, "plaka"> & { araclar?: { plaka?: string } | null })[];
    setKayitlar(satirlar.map((x) => ({ ...x, plaka: x.araclar?.plaka ?? "—" })));
  }, []);

  useEffect(() => {
    if (!yetkili) { setKayitlar([]); return; }
    void kontrol();
    const onFocus = () => void kontrol();   // başka sekmede kapatılırsa dönünce güncellensin
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [yetkili, kontrol]);

  const kapat = async (k: PoliceUyarisi) => {
    setKapatiliyor(k.id);
    try {
      const sb = createClient();
      const { error } = await sb.from("arac_police")
        .update({ uyari_okundu_at: new Date().toISOString() }).eq("id", k.id);
      if (error) throw error;
      setKayitlar((s) => s.filter((x) => x.id !== k.id));
    } catch {
      toast.error("Kapatılamadı.", { duration: toastSuresi() });
    } finally {
      setKapatiliyor(null);
    }
  };

  if (!yetkili || kayitlar.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-red-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {kayitlar.length} poliçe, istenen tekliften farklı kesilmiş
          </div>
          <div className="text-xs text-red-700">
            Mailden gelen poliçe otomatik kaydedildi ama poliçeleştirilmesini istediğimiz teklifle uyuşmuyor. Acente Takip ekranında işaretli kalacak.
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-2 pl-9 text-sm">
        {kayitlar.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-2">
            <span className="text-red-900">
              <b>{k.plaka}</b> {k.police_tipi === "kasko" ? "Kasko" : "Trafik"}
              {k.acente ? ` · ${k.acente}` : ""} — {k.otomatik_uyari}
            </span>
            <button type="button" disabled={kapatiliyor === k.id} onClick={() => kapat(k)}
              className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60">
              <Check size={13} /> Tamam
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
