"use client";

// Dashboard uyarısı: Netsim'de YENİ bir işlem noktası açılmış ama sitede karşılığı
// (iş deneyim belgesi / şantiye) yok.
//
// Neden gerekli: Netsim'de iş açılıp hakedişler işlenmeye başlıyor, sitede ise iş hiç
// görünmüyordu — tamamlanan keşif tutarı hiçbir yere akmıyor, iş deneyim belgesi eksik
// kalıyordu. Şu an böyle 64 eski nokta var; bu uyarı BUNDAN SONRA açılanları yakalar.
//
// Kaydı scripts/netsim-sync.ts açar (netsim_yeni_nokta tablosu, durum='bekliyor').
// "Evet" → yeni iş ekleme ekranı, adı ve Netsim nokta no'su önceden dolu gelir.
// "Hayır" → kayıt 'yoksayildi' olur, bir daha sorulmaz.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { createClient } from "@/lib/supabase/client";

type YeniNokta = { nokta_no: number; ad: string; ilk_gorulme: string };

export default function NetsimYeniIsHatirlatma() {
  const router = useRouter();
  const { hasPermission, kullanici } = useAuth();
  // Yeni iş açacak yetkisi olmayana sormanın anlamı yok.
  const yetkili = hasPermission("yonetim-santiyeler", "ekle");
  const [kayitlar, setKayitlar] = useState<YeniNokta[]>([]);
  const [islemde, setIslemde] = useState<number | null>(null);

  const kontrol = useCallback(async () => {
    const sb = createClient();
    const { data, error } = await sb
      .from("netsim_yeni_nokta")
      .select("nokta_no, ad, ilk_gorulme")
      .eq("durum", "bekliyor")
      .order("nokta_no", { ascending: false });
    // Tablo henüz yoksa sessiz geç — uyarı görünmez, sayfa bozulmaz.
    if (error) { setKayitlar([]); return; }
    setKayitlar((data ?? []) as YeniNokta[]);
  }, []);

  useEffect(() => {
    if (!yetkili) { setKayitlar([]); return; }
    void kontrol();
    const onFocus = () => void kontrol();   // iş eklenip dönülünce uyarı kalksın
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [yetkili, kontrol]);

  /** Hayır — bir daha sorma. Kayıt silinmez, "yoksayildi" olarak kalır (iz sürülebilsin). */
  const yoksay = async (n: YeniNokta) => {
    setIslemde(n.nokta_no);
    try {
      const sb = createClient();
      const { data, error } = await sb.from("netsim_yeni_nokta")
        .update({ durum: "yoksayildi", karar_veren: kullanici?.ad_soyad ?? null, karar_at: new Date().toISOString() })
        .eq("nokta_no", n.nokta_no).select("nokta_no");
      if (error) throw error;
      // .select() ŞART: satır yazılmadığında da hata gelmiyor, "tamam" demek yanıltıcı olur.
      if (!data?.length) { toast.error("Kaydedilemedi: yetkiniz yok görünüyor.", { duration: toastSuresi() }); return; }
      setKayitlar((s) => s.filter((x) => x.nokta_no !== n.nokta_no));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "İşlenemedi", { duration: toastSuresi() });
    } finally {
      setIslemde(null);
    }
  };

  /** Evet — yeni iş ekleme ekranını açar; ad ve nokta no önceden dolu gelir. */
  const ekle = (n: YeniNokta) => {
    const q = new URLSearchParams({ netsim: String(n.nokta_no), ad: n.ad });
    router.push(`/dashboard/yonetim/santiyeler/yeni?${q.toString()}`);
  };

  if (!yetkili || kayitlar.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sky-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-sky-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ Netsim&apos;de {kayitlar.length} yeni iş açılmış
          </div>
          <div className="text-xs text-sky-700">
            Bu işlerin sitede karşılığı yok. İş deneyim belgelerine eklemek ister misiniz?
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-2 pl-9 text-sm">
        {kayitlar.map((n) => (
          <li key={n.nokta_no} className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono text-sky-600">[{n.nokta_no}]</span>
            <span className="font-medium text-sky-900">{n.ad}</span>
            <span className="text-[10px] text-sky-600">
              {new Date(n.ilk_gorulme).toLocaleDateString("tr-TR")}
            </span>
            <button type="button" disabled={islemde === n.nokta_no}
              onClick={() => ekle(n)}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              <Check size={13} /> Evet, ekle
            </button>
            <button type="button" disabled={islemde === n.nokta_no}
              onClick={() => yoksay(n)}
              className="inline-flex items-center gap-1 rounded border border-sky-300 px-2.5 py-1 text-xs text-sky-800 hover:bg-sky-100 disabled:opacity-60">
              <X size={13} /> Hayır
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
