// ANA SAYFA — AVUKATA GİDEN DOSYALARIN TAKİBİ.
//
// NİYE: dosyayı avukata göndermek işi bitirmiyor; bundan sonrası (duruşma, haciz,
// itiraz sonucu) panelde görünmüyor. Gönderip unutulan dosya, süresi dolduğunda
// kimsenin haberi olmadan kapanıyor. Son gün geldiğinde ekran tek bir şey soruyor:
// avukatı aradınız mı, bilgi aldınız mı?
//
// NE ZAMAN ÇIKAR: avukata mail GERÇEKTEN gitmiş (avukat_mail_at dolu) ve bugün
// dosyanın SON GÜNÜ. Yalnız o gün — erken çıkan uyarı okunmadan kapatılır, günlerce
// duran uyarı ise duvar kâğıdına döner ve kimse bakmaz. Son gün geçtikten sonra da
// çıkmaz: o aşamada iş avukatta bitmiştir, panelin sorabileceği bir şey kalmaz.
//
// CEVAPLAR KAYDA GEÇER (uyari_onaylari günlüğü):
//   EVET  → "görüşüldü, işlem süresinde başlatılmış". Uyarı TÜM kullanıcılarda kapanır: dosyayı
//           arayan kişi tektir, iş bitince herkesten kalkmalı. Kalıcıdır; arayüzde
//           geri alma yolu yok, o yüzden önce onay sorulur.
//   HAYIR → "henüz görüşmedim". Kayda geçer ve uyarı yalnız BU KULLANICIDA, günün
//           kalanında kapanır (anahtarın sonunda tarih var). Herkeste kapatmaz:
//           görüşmediğini söyleyen kişi, başkasının da görmesini engellememeli.
//
// SÜRE BELGEDE YOKSA UYARI DA YOK: gün uydurulmaz (bkz. lib/utils/icra-sure).
"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone, Gavel, Scale, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth, ICRA_DEGISTI } from "@/hooks";
import { createClient } from "@/lib/supabase/client";
import type { IcraKayit, IcraSirketTakip } from "@/lib/supabase/types";
import { formatBaslik, formatBuyukHarf, avukatAdiGoster } from "@/lib/utils/isim";
import { uyariAnahtari, uyariGizle } from "@/lib/supabase/queries/uyari-gizle";
import { getGenelKapatilanlar, uyariyiHerkeseKapat } from "@/lib/supabase/queries/uyari-kapatma";
import { cevapKipi } from "@/components/shared/icra-cevap-alanlari";
import { sonGunHesapla, bugunISO, VARSAYILAN_CEVAP_SURESI } from "@/lib/utils/icra-sure";

/** EVET anahtarı — herkeste kapanan. */
const TIP_SORULDU = "avukat-takip";
/** HAYIR anahtarı — kişisel ve günlük; anahtarın sonunda tarih var. */
const TIP_HAYIR = "avukat-takip-hayir";
const GOSTERILECEK = 6;

type Satir = {
  id: string;
  nereye: "takip" | "sirket";
  kim: string;
  dosya: string;
  avukat: string;
  sonGun: string;
  gonderildi: string;       // mailin gittiği an (ISO)
  anahtar: string;          // EVET anahtarı (genel)
  gunlukAnahtar: string;    // HAYIR anahtarı (kişisel + bugünün tarihi)
};

const tarihGoster = (v: string) => v.split("-").reverse().join(".");

export default function AvukatTakipHatirlatma() {
  const { isYonetici, hasPermission, kullanici, profilYenile } = useAuth();
  const yetkili = isYonetici || hasPermission("icra", "goruntule");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [gizlenenler, setGizlenenler] = useState<string[]>([]);
  const [onayBekleyen, setOnayBekleyen] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => { setGizlenenler(kullanici?.gizlenen_uyarilar ?? []); }, [kullanici]);

  const kontrol = useCallback(async () => {
    if (!yetkili) { setSatirlar([]); return; }
    const sb = createClient();
    const bugun = bugunISO();
    const bulunan: Satir[] = [];
    try {
      const kapali = await getGenelKapatilanlar([TIP_SORULDU]);

      const ekle = (s: Omit<Satir, "anahtar" | "gunlukAnahtar">) => {
        const anahtar = uyariAnahtari(TIP_SORULDU, `${s.nereye}-${s.id}`);
        if (kapali.has(anahtar)) return;   // biri "Evet" demiş → herkeste kapalı
        bulunan.push({ ...s, anahtar, gunlukAnahtar: uyariAnahtari(TIP_HAYIR, `${s.nereye}-${s.id}-${bugun}`) });
      };

      // ── Üçüncü şahıs defteri: avukat aracılığıyla cevap verilmiş dosyalar ──
      const { data: ucuncu, error: e1 } = await sb.from("icra")
        .select("id, borclu_adi, dosya_esas_no, teblig_tarihi, cevap_suresi_gun, cevap_sekli, avukat_adi, avukat_mail_at")
        .not("avukat_mail_at", "is", null);
      if (e1) throw e1;
      for (const r of (ucuncu ?? []) as Partial<IcraKayit>[]) {
        // CEVAP ŞEKLİ HÂLÂ AVUKAT MI: cevap geri alınıp başka kipe çevrildiyse
        // dosya artık avukatta değil, sormanın anlamı yok.
        if (!cevapKipi(r.cevap_sekli ?? "").avukat) continue;
        const son = sonGunHesapla(r.teblig_tarihi ?? null, r.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI);
        if (son !== bugun) continue;                  // yalnız SON GÜN
        ekle({
          id: r.id as string, nereye: "takip", kim: r.borclu_adi ?? "borçlu belirsiz",
          dosya: r.dosya_esas_no ?? "—", avukat: r.avukat_adi ?? "avukat",
          sonGun: son, gonderildi: r.avukat_mail_at as string,
        });
      }

      // ── Şirkete açılan takipler: dosyası avukatta olanlar ──
      const { data: sirket, error: e2 } = await sb.from("icra_sirket_takip")
        .select("id, alacakli_adi, dosya_esas_no, teblig_tarihi, itiraz_suresi_gun, durum, avukat_adi, avukat_mail_at")
        .not("avukat_mail_at", "is", null);
      if (e2) {
        // Sütunlar kurulmamış olabilir; üçüncü şahıs uyarısı yine de gösterilsin.
        console.warn("Şirkete açılan takipler okunamadı:", e2.message);
      } else {
        for (const r of (sirket ?? []) as Partial<IcraSirketTakip>[]) {
          if (r.durum !== "avukatta") continue;       // geri alınmış ya da ödenmiş
          const son = sonGunHesapla(r.teblig_tarihi ?? null, r.itiraz_suresi_gun ?? null);
          if (son !== bugun) continue;                // yalnız SON GÜN
          ekle({
            id: r.id as string, nereye: "sirket", kim: r.alacakli_adi ?? "alacaklı belirsiz",
            dosya: r.dosya_esas_no ?? "—", avukat: r.avukat_adi ?? "avukat",
            sonGun: son, gonderildi: r.avukat_mail_at as string,
          });
        }
      }
      // Son günü en eski olan üste: en çok bekleyen dosya en acili.
      bulunan.sort((a, b) => a.sonGun.localeCompare(b.sonGun));
      setSatirlar(bulunan);
    } catch (e) {
      // Okunamazsa şerit çıkmaz; ana ekranın geri kalanı ayakta kalsın.
      console.warn("Avukat takip uyarısı hesaplanamadı:", e instanceof Error ? e.message : e);
      setSatirlar([]);
    }
  }, [yetkili]);

  useEffect(() => {
    void kontrol();
    const onFocus = () => void kontrol();
    const onGorunur = () => { if (document.visibilityState === "visible") void kontrol(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener(ICRA_DEGISTI, onFocus);
    document.addEventListener("visibilitychange", onGorunur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ICRA_DEGISTI, onFocus);
      document.removeEventListener("visibilitychange", onGorunur);
    };
  }, [kontrol]);

  /** TEYİT — görüşüldü ve işlem süresinde başlatılmış. Herkeste kapanır, basan kişi kayda geçer. */
  async function evet(s: Satir) {
    setIslemde(true);
    try {
      const { kayitHatasi } = await uyariyiHerkeseKapat(s.anahtar);
      setSatirlar((p) => p.filter((x) => x.anahtar !== s.anahtar));
      setOnayBekleyen(null);
      toast.success("Teyit kaydedildi — uyarı tüm kullanıcılarda kapandı.");
      // SESSİZ GEÇİLMEZ: "kim cevapladı" kaydı tutulmadıysa söylenmeli.
      if (kayitHatasi) toast.error(`Cevabı veren kaydı tutulamadı: ${kayitHatasi}`, { duration: 8000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally { setIslemde(false); }
  }

  /** HENÜZ GÖRÜŞÜLMEDİ — kayda geçer, uyarı bu kullanıcıda günün kalanında kapanır. */
  async function hayir(s: Satir) {
    setIslemde(true);
    try {
      const { gizlenenler: yeni, kayitHatasi } = await uyariGizle(s.gunlukAnahtar);
      setGizlenenler(yeni);
      // PROFİL TAZELENİR — yoksa bileşen yeniden kurulduğunda eski listeyi okuyup
      // kendi yazdığını siler ve uyarı hemen geri gelir (09.11.2026'da yaşandı).
      await profilYenile();
      toast("Kaydedildi — avukatla görüşülmediği not edildi.", { icon: "🕑", duration: 6000 });
      if (kayitHatasi) toast.error(`Cevabı veren kaydı tutulamadı: ${kayitHatasi}`, { duration: 8000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally { setIslemde(false); }
  }

  if (!yetkili) return null;
  const gorunenHepsi = satirlar.filter((s) => !gizlenenler.includes(s.gunlukAnahtar));
  if (gorunenHepsi.length === 0) return null;
  const gorunen = gorunenHepsi.slice(0, GOSTERILECEK);
  // SON GÜN "DOLMUŞ" DEĞİLDİR: o gün hâlâ işlem yapılabilir; süre ancak son gün
  // geçtikten sonra dolar. Uyarı zaten yalnız son gün çıktığı için metin de öyle.
  const baslik = `Avukattaki ${gorunenHepsi.length} dosyada BUGÜN son gün`;

  return (
    <div className="mb-4 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sky-900 shadow-sm">
      <div className="flex items-center gap-3">
        <Phone size={22} className="shrink-0 text-sky-600" />
        <div className="flex-1">
          <div className="font-semibold">
            {baslik} — avukatla görüşüp işlemin süresinde başlatıldığını teyit ettiniz mi?
          </div>
          <div className="text-xs text-sky-700">
            Avukatı arayın; işlem süresinde yapıldıysa yandan teyit edin.
            Cevabınız, kim ve ne zaman verdiğiyle birlikte kaydedilir.
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {gorunen.map((s) => (
          <li key={s.anahtar} className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {s.nereye === "takip"
              ? <Gavel size={13} className="shrink-0 text-sky-600" aria-label="Üçüncü şahıs haczi" />
              : <Scale size={13} className="shrink-0 text-sky-600" aria-label="Şirkete açılan takip" />}
            <span className="font-medium">
              {s.nereye === "takip" ? formatBuyukHarf(s.kim) : formatBaslik(s.kim)}
            </span>
            <span className="text-sky-700">· {s.dosya}</span>
            <span className="text-sky-700">· {avukatAdiGoster(s.avukat)}</span>
            <span className="text-sky-700">
              · son gün <strong>{tarihGoster(s.sonGun)}</strong>
              {" (bugün)"}
            </span>

            {onayBekleyen === s.anahtar ? (
              // Onay kutusu KENDİ SATIRINA iner: aynı satırda durunca metni
              // okunmaz hâle getiriyor (süre uyarısındaki ile aynı düzen).
              <span className="flex basis-full items-center justify-end gap-2">
                <span className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 shadow-sm">
                  <span className="text-xs text-gray-700">
                    Avukatla görüştüğünüzü ve <strong>işlemin süresinde başlatıldığını</strong> teyit
                    ediyorsunuz. Uyarı <strong>tüm kullanıcılarda</strong> kalıcı olarak kapanacak.
                  </span>
                  <button type="button" disabled={islemde} onClick={() => void evet(s)}
                    className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
                    {islemde ? <Loader2 size={12} className="animate-spin" /> : "Onayla"}
                  </button>
                  <button type="button" disabled={islemde} onClick={() => setOnayBekleyen(null)}
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Vazgeç</button>
                </span>
              </span>
            ) : (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <button type="button" disabled={islemde} onClick={() => setOnayBekleyen(s.anahtar)}
                  title="Avukatla görüşüldü ve işlem süresinde başlatıldı — uyarı TÜM kullanıcılarda kapanır"
                  className="rounded-lg border border-emerald-700 bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
                  Görüştüm, teyit ettim
                </button>
                <button type="button" disabled={islemde} onClick={() => void hayir(s)}
                  title="Henüz görüşmedim — kayda geçer, uyarı sizde kapanır"
                  className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60">
                  Henüz görüşmedim
                </button>
              </span>
            )}
          </li>
        ))}
        {gorunenHepsi.length > gorunen.length && (
          <li className="text-xs text-sky-700">
            … ve {gorunenHepsi.length - gorunen.length} dosya daha —{" "}
            <a href="/dashboard/icra" className="underline">İcra Dosyaları</a>
          </li>
        )}
      </ul>
    </div>
  );
}
