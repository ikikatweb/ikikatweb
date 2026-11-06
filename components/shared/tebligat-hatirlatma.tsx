"use client";

// Ana ekran uyarısı: AÇILMAMIŞ e-tebligat var.
//
// Neden ana ekranda: elektronik tebligat, adrese ulaştığı tarihi izleyen BEŞİNCİ GÜNÜN
// SONUNDA tebliğ edilmiş sayılır (7201 s. K. 7/a) — açılsa da açılmasa da. Yani kimse
// bakmasa bile süre işler. Kaçırılan tebligat doğrudan hak kaybıdır; haber vermek için
// kullanıcının Yazışmalar menüsüne girmesini beklemek yetmez.
//
// KAPATMA DÜĞMESİ YOK (açılmamışlar için). Poliçe uyarısında "Tamam" var çünkü orada
// bilgi veriliyor; burada SÜRE İŞLİYOR. Uyarı ancak tebligat UETS'te açılınca ya da
// süresi dolup arşivlenince kalkar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Check } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { useAuth, tebligatDegisti } from "@/hooks";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { createClient } from "@/lib/supabase/client";
import { kalanGun } from "@/lib/supabase/queries/tebligat";

const UETS_GIRIS = "https://ptt.etebligat.gov.tr/login";

type Satir = {
  id: number;
  hesap: string;
  gonderen_ad: string | null;
  konu: string | null;
  teblig_tarihi: string;
  durum: string;
  firmalar?: { firma_adi: string; kisa_adi: string | null; renk: string | null } | null;
};

export default function TebligatHatirlatma() {
  const { hasPermission, isYonetici } = useAuth();
  const yetkili = isYonetici || hasPermission("yazismalar-e-tebligat", "goruntule");
  const [kayitlar, setKayitlar] = useState<Satir[]>([]);
  const [kapatiliyor, setKapatiliyor] = useState<number | null>(null);

  const kontrol = useCallback(async () => {
    const sb = createClient();
    const { data, error } = await sb
      .from("tebligat")
      .select("id, hesap, gonderen_ad, konu, teblig_tarihi, durum, firmalar ( firma_adi, kisa_adi, renk )")
      // delivered  = açılmamış · readtimeout = süresi dolmuş (daha da önemli)
      .in("durum", ["delivered", "readtimeout"])
      .eq("arsivlendi", false)
      .order("teblig_tarihi", { ascending: true });
    // Hata YUTULMAZ ama ana ekranı da kilitlemez: uyarı görünmez, konsola düşer.
    if (error) { console.warn("Tebligat uyarısı okunamadı:", error.message); return; }
    setKayitlar((data ?? []) as unknown as Satir[]);
  }, []);

  useEffect(() => {
    if (!yetkili) { setKayitlar([]); return; }
    void kontrol();
    const onFocus = () => void kontrol();   // UETS'te açıp dönünce listeden düşsün
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [yetkili, kontrol]);

  // Süresi dolmuş olan arşivlenebilir: yapılacak bir şey kalmadıysa ekranı kilitlemesin.
  // Açılmamış olanlar arşivlenemez — süre işliyor, görmezden gelinmemeli.
  const arsivle = async (id: number) => {
    setKapatiliyor(id);
    try {
      const sb = createClient();
      const { error } = await sb.from("tebligat").update({ arsivlendi: true }).eq("id", id);
      if (error) throw error;
      setKayitlar((s) => s.filter((x) => x.id !== id));
      tebligatDegisti();   // menüdeki kırmızı rozet de hemen düşsün
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Arşivlenemedi.", { duration: toastSuresi() });
    } finally {
      setKapatiliyor(null);
    }
  };

  const { acil, normal } = useMemo(() => {
    const acil = kayitlar.filter((k) => k.durum === "readtimeout" || kalanGun(k.teblig_tarihi) <= 2);
    return { acil, normal: kayitlar.filter((k) => !acil.includes(k)) };
  }, [kayitlar]);

  if (!yetkili || kayitlar.length === 0) return null;

  const kirmizi = acil.length > 0;
  const kutu = kirmizi
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 shadow-sm ${kutu}`}>
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className={`shrink-0 ${kirmizi ? "text-red-600" : "text-amber-600"}`} />
        <div className="flex-1">
          <div className="font-semibold">
            ⚖️ {kayitlar.length} e-tebligat açılmamış
            {acil.length > 0 && ` — ${acil.length} tanesi acil`}
          </div>
          <div className={`text-xs ${kirmizi ? "text-red-700" : "text-amber-700"}`}>
            Elektronik tebligat, adrese ulaştığı tarihi izleyen beşinci günün sonunda tebliğ
            edilmiş sayılır (7201 s. K. 7/a). <b>Açılmaması süreyi durdurmaz.</b>
          </div>
        </div>
        <a href={UETS_GIRIS} target="_blank" rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-current/30 bg-white/70 px-3 py-1.5 text-xs font-medium hover:bg-white">
          UETS&apos;te aç <ExternalLink size={13} />
        </a>
      </div>

      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {[...acil, ...normal].slice(0, 8).map((k) => {
          const g = kalanGun(k.teblig_tarihi);
          const sureMetni = k.durum === "readtimeout"
            ? "SÜRE DOLDU"
            : g < 0 ? `${-g} gün geçti` : g === 0 ? "BUGÜN son gün" : `${g} gün kaldı`;
          return (
            <li key={k.id} className="flex flex-wrap items-center gap-2">
              {/* Firmanın kendi rengi — hangi şirkete geldiği bir bakışta görünsün. */}
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-gray-300"
                style={{ backgroundColor: k.firmalar?.renk ?? "#9ca3af" }}
                title={k.firmalar?.firma_adi ?? k.hesap} />
              <b>{k.firmalar?.kisa_adi || k.firmalar?.firma_adi || k.hesap}</b>
              <span>{k.gonderen_ad ?? "—"} · {k.konu ?? "konu yok"}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                k.durum === "readtimeout" || g <= 0 ? "bg-red-200 text-red-900" : "bg-white/80"}`}>
                {sureMetni}
              </span>
              {/* Arşivleme YALNIZ süresi dolmuşlar için — açılmamışı gizlemek tehlikeli. */}
              {k.durum === "readtimeout" && (
                <button type="button" disabled={kapatiliyor === k.id} onClick={() => arsivle(k.id)}
                  className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60">
                  <Check size={12} /> Gördüm
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {kayitlar.length > 8 && (
        <div className="mt-2 pl-9 text-xs">
          … ve {kayitlar.length - 8} tane daha
        </div>
      )}
      <div className="mt-2 pl-9">
        <Link href="/dashboard/yazismalar/e-tebligat" className="text-xs font-medium underline underline-offset-2">
          Tümünü gör →
        </Link>
      </div>
    </div>
  );
}
