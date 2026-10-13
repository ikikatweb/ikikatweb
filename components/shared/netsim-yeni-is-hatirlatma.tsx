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

type YeniNokta = {
  nokta_no: number; ad: string; ilk_gorulme: string;
  // Netsim'de aynı işe ait diğer alanlar. Ad BÜYÜK HARF ve 40 karaktere kırpık geldiği
  // için tek başına hangi iş olduğunu anlatmaya yetmiyordu; bunlar onu tanıtıyor.
  kod: string | null; sorumlu: string | null; is_grubu: string | null;
  sozlesme_bedeli: number | null; ek_sozlesme_bedeli: number | null; yaklasik_maliyet: number | null;
  ihale_tarihi: string | null; ilan_tarihi: string | null; ihale_kayit_no: string | null;
  sozlesme_tarihi: string | null; isyeri_teslim_tarihi: string | null;
  ortaklik_orani: number | null; pilot_firma: string | null; asgari_iscilik_orani: number | null;
};

const SECIM = "nokta_no, ad, ilk_gorulme, kod, sorumlu, is_grubu, sozlesme_bedeli, ek_sozlesme_bedeli, yaklasik_maliyet, ihale_tarihi, ilan_tarihi, ihale_kayit_no, sozlesme_tarihi, isyeri_teslim_tarihi, ortaklik_orani, pilot_firma, asgari_iscilik_orani";

/** Ana ekranda iş adı 50 karakterde kesilir — uzun adlar satırı bozuyordu. */
const kisalt = (ad: string, sinir = 50) => (ad.length > sinir ? ad.slice(0, sinir).trimEnd() + "…" : ad);

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const tarih = (g: string) => new Date(g + "T00:00:00").toLocaleDateString("tr-TR");
const oran = (n: number) => "%" + n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

/**
 * Netsim'de DOLU olan alanları etiketli rozetlere çevirir. Boş alan hiç yazılmaz:
 * 106 iş noktasının ölçümünde sözleşme bedeli 93'ünde, İKN 39'unda, iş grubu 25'inde
 * doluydu — hepsini basmak uyarıyı "— / —" satırlarıyla doldururdu.
 */
function bilgiler(n: YeniNokta): { etiket: string; deger: string }[] {
  const x: { etiket: string; deger: string }[] = [];
  if (n.sozlesme_bedeli != null) x.push({ etiket: "Sözleşme bedeli", deger: tl(n.sozlesme_bedeli) });
  if (n.ek_sozlesme_bedeli != null) x.push({ etiket: "Ek sözleşme", deger: tl(n.ek_sozlesme_bedeli) });
  if (n.yaklasik_maliyet != null) x.push({ etiket: "Yaklaşık maliyet", deger: tl(n.yaklasik_maliyet) });
  if (n.ihale_kayit_no) x.push({ etiket: "İKN", deger: n.ihale_kayit_no });
  if (n.ihale_tarihi) x.push({ etiket: "İhale", deger: tarih(n.ihale_tarihi) });
  if (n.ilan_tarihi) x.push({ etiket: "İlan", deger: tarih(n.ilan_tarihi) });
  if (n.sozlesme_tarihi) x.push({ etiket: "Sözleşme", deger: tarih(n.sozlesme_tarihi) });
  if (n.isyeri_teslim_tarihi) x.push({ etiket: "İşyeri teslim", deger: tarih(n.isyeri_teslim_tarihi) });
  if (n.is_grubu) x.push({ etiket: "İş grubu", deger: n.is_grubu });
  if (n.asgari_iscilik_orani != null) x.push({ etiket: "Asgari işçilik", deger: oran(n.asgari_iscilik_orani) });
  if (n.pilot_firma) {
    x.push({ etiket: "Pilot", deger: n.pilot_firma + (n.ortaklik_orani != null ? ` ${oran(n.ortaklik_orani)}` : "") });
  } else if (n.ortaklik_orani != null) {
    x.push({ etiket: "Ortaklık oranı", deger: oran(n.ortaklik_orani) });
  }
  if (n.sorumlu) x.push({ etiket: "Sorumlu", deger: n.sorumlu });
  return x;
}

export default function NetsimYeniIsHatirlatma() {
  const router = useRouter();
  const { hasPermission, kullanici } = useAuth();
  // Yeni iş açacak yetkisi olmayana sormanın anlamı yok.
  const yetkili = hasPermission("yonetim-santiyeler", "ekle");
  const [kayitlar, setKayitlar] = useState<YeniNokta[]>([]);
  const [islemde, setIslemde] = useState<number | null>(null);

  const kontrol = useCallback(async () => {
    const sb = createClient();
    const oku = (secim: string) => sb
      .from("netsim_yeni_nokta")
      .select(secim)
      .eq("durum", "bekliyor")
      .order("nokta_no", { ascending: false });

    let { data, error } = await oku(SECIM);
    // Ek bilgi sütunları henüz açılmamışsa (sql/netsim_yeni_nokta_bilgiler.sql) sorgu
    // tümden hata verir ve uyarı hiç görünmezdi. Sade sütunlarla yeniden denenir:
    // iş adı yine çıkar, ek bilgiler o kadar boş kalır.
    if (error) ({ data, error } = await oku("nokta_no, ad, ilk_gorulme"));
    // Tablo hiç yoksa sessiz geç — uyarı görünmez, sayfa bozulmaz.
    if (error) { setKayitlar([]); return; }
    const bekleyen = (data ?? []) as unknown as YeniNokta[];
    if (bekleyen.length === 0) { setKayitlar([]); return; }

    // ARTIK BİR ŞANTİYEYE BAĞLANMIŞ OLANLARI ELE. İş kaydedilince kayıt 'eklendi' olarak
    // işaretleniyor; ama işaretleme atlanırsa uyarı ekranda kalıyordu — 275'te böyle oldu,
    // şantiye açılmıştı ve uyarı duruyordu. Nokta bağlıysa sorulacak bir şey yok.
    const { data: bagli } = await sb
      .from("santiyeler")
      .select("netsim_nokta_no")
      .in("netsim_nokta_no", bekleyen.map((b) => b.nokta_no));
    const bagliNo = new Set((bagli ?? []).map((b) => Number(b.netsim_nokta_no)));
    setKayitlar(bekleyen.filter((b) => !bagliNo.has(b.nokta_no)));
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
    // Onay ŞART: "Hayır" geri alınamaz, o nokta bir daha sorulmaz.
    if (!confirm(`"${n.ad}" işi iş deneyim belgelerine EKLENMEYECEK ve bir daha sorulmayacak.

Emin misiniz?`)) return;
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
          <li key={n.nokta_no} className="rounded-lg border border-sky-200 bg-white/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono text-sky-600">[{n.nokta_no}]</span>
              {/* Uzun iş adı satırı kırıp rozetleri aşağı itiyordu; 50 karakterde kesilir,
                  tamamı üzerine gelince görünür. Forma TAM ad gider, kısaltma yalnız burada. */}
              <span className="font-medium text-sky-900" title={n.ad}>{kisalt(n.ad)}</span>
              {n.kod && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] text-sky-700">{n.kod}</span>
              )}
              <span className="text-[10px] text-sky-600">
                {new Date(n.ilk_gorulme).toLocaleDateString("tr-TR")}
              </span>
              <span className="flex-1" />
              <button type="button" disabled={islemde === n.nokta_no}
                onClick={() => ekle(n)}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                <Check size={13} /> Evet, ekle
              </button>
              <button type="button" disabled={islemde === n.nokta_no}
                onClick={() => yoksay(n)}
                className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-100 px-2.5 py-1 text-xs text-red-800 hover:bg-red-200 disabled:opacity-60">
                <X size={13} /> Hayır
              </button>
            </div>
            {bilgiler(n).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                {bilgiler(n).map((b) => (
                  <span key={b.etiket} className="whitespace-nowrap">
                    <span className="text-sky-600">{b.etiket}</span>{" "}
                    <span className="font-medium text-sky-900">{b.deger}</span>
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
