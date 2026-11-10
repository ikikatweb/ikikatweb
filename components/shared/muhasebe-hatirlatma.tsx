// ANA SAYFA — MUHASEBE AŞAMASINDA TIKANAN DOSYALAR.
//
// NİYE: cevabın altlığını ve borç durumunu muhasebe hazırlıyor; cevap şeklini
// (yazışma / havale / avukat) belirleyen de o. Bu aşamada duran dosya, hiçbir
// ekranda "bekliyor" demiyordu — süre ise muhasebe beklerken de işliyor.
//
// İKİ HÂL GÖSTERİLİR:
//   1) GÖNDERİLMEDİ (kırmızı) — dosya panele girilmiş ama mail gitmemiş. Olmaması
//      gereken hâl: yeni kayıtta mail kendiliğinden gidiyor, burada görünen dosya
//      ya gönderim hatası almış (ek inmemiş) ya da sütunlar kurulmadan girilmiş.
//      Şeridin kendi üzerinden GÖNDERİLEBİLİR — bir tık, iki ekran gezdirmez.
//   2) CEVAP BEKLENİYOR (sarı) — mail gitmiş, cevap girilmemiş VE süre daralmış
//      (son günden bir gün önce; hafta sonuna denk gelirse cumaya çekilir, bkz.
//      lib/utils/icra-sure). Muhasebeyi aramanın vakti budur.
//
// KAPATMA DÜĞMESİ YOK: iki hâl de iş yapılınca kendiliğinden kalkıyor (mail
// gidince / cevap girilince). Kapatılabilen bir uyarı, yapılmamış işi gizlemenin
// kolay yolu olurdu.
//
// SÜRESİ GEÇMİŞ ESKİ DOSYALAR SAYILMAZ: defterde 2021-2023 tebliğ tarihli, süresi
// yıllar önce dolmuş cevapsız kayıtlar var. Onlar için muhasebeden altlık istemek
// karşılıksız bir mail olurdu (bkz. muhasebeGerekliMi).
"use client";

import { useCallback, useEffect, useState } from "react";
import { Calculator, Gavel, Scale, Loader2, Send } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth, ICRA_DEGISTI } from "@/hooks";
import { createClient } from "@/lib/supabase/client";
import type { IcraKayit, IcraSirketTakip } from "@/lib/supabase/types";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import {
  muhasebeyeGonder, muhasebeGerekliMi, muhasebeCevabiAcilMi,
} from "@/lib/supabase/queries/icra-muhasebe";
import { sonGunHesapla, bugunISO, VARSAYILAN_CEVAP_SURESI } from "@/lib/utils/icra-sure";

const GOSTERILECEK = 6;

type Satir = {
  id: string;
  nereye: "takip" | "sirket";
  hal: "gonderilmedi" | "bekleniyor";
  kim: string;
  dosya: string;
  sonGun: string | null;
};

const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "süre belirsiz");

export default function MuhasebeHatirlatma() {
  const { isYonetici, hasPermission } = useAuth();
  const yetkili = isYonetici || hasPermission("icra", "goruntule");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [gonderilen, setGonderilen] = useState<string | null>(null);

  const kontrol = useCallback(async () => {
    if (!yetkili) { setSatirlar([]); return; }
    const sb = createClient();
    const bugun = bugunISO();
    const bulunan: Satir[] = [];
    try {
      // ── Üçüncü şahıs defteri ──
      const { data: ucuncu, error: e1 } = await sb.from("icra")
        .select("id, borclu_adi, dosya_esas_no, teblig_tarihi, cevap_suresi_gun, cevap_sekli, cevap_tarihi,"
          + " haciz_kaldirma_tarihi, muhasebe_mail_at, muhasebe_cevap_at");
      if (e1) throw e1;
      for (const r of (ucuncu ?? []) as Partial<IcraKayit>[]) {
        // HACİZ KALDIRILMIŞSA CEVAPLANACAK ŞEY KALMAZ: altlık da gerekmez.
        if (r.haciz_kaldirma_tarihi) continue;
        const gerekli = muhasebeGerekliMi({
          teblig_tarihi: r.teblig_tarihi ?? null,
          cevapVerildi: Boolean(r.cevap_sekli || r.cevap_tarihi),
          sureGun: r.cevap_suresi_gun ?? null,
        }, false, bugun);
        if (!gerekli) continue;
        const son = sonGunHesapla(r.teblig_tarihi ?? null, r.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI);
        // CEVABI GELMİŞSE GÖNDERİM SORULMAZ: muhasebe cevabı panele girilmişse
        // aşama tamamlanmıştır — yazı kendi mail kutusundan gönderilmiş de
        // olabilir. "Gönderilmedi" demek, yapılmış işi yapılmamış göstermek olur.
        if (!r.muhasebe_mail_at && !r.muhasebe_cevap_at) {
          bulunan.push({ id: r.id as string, nereye: "takip", hal: "gonderilmedi",
            kim: r.borclu_adi ?? "borçlu belirsiz", dosya: r.dosya_esas_no ?? "—", sonGun: son });
        } else if (!r.muhasebe_cevap_at && muhasebeCevabiAcilMi(son, bugun)) {
          bulunan.push({ id: r.id as string, nereye: "takip", hal: "bekleniyor",
            kim: r.borclu_adi ?? "borçlu belirsiz", dosya: r.dosya_esas_no ?? "—", sonGun: son });
        }
      }

      // ── Şirkete açılan takipler ──
      const { data: sirket, error: e2 } = await sb.from("icra_sirket_takip")
        .select("id, alacakli_adi, dosya_esas_no, teblig_tarihi, itiraz_suresi_gun, durum,"
          + " muhasebe_mail_at, muhasebe_cevap_at");
      if (e2) {
        // Sütunlar kurulmamış olabilir; üçüncü şahıs uyarısı yine de gösterilsin.
        console.warn("Şirkete açılan takipler okunamadı:", e2.message);
      } else {
        for (const r of (sirket ?? []) as Partial<IcraSirketTakip>[]) {
          const gerekli = muhasebeGerekliMi({
            teblig_tarihi: r.teblig_tarihi ?? null,
            cevapVerildi: r.durum !== "yeni",
            sureGun: r.itiraz_suresi_gun ?? null,
          }, true, bugun);
          if (!gerekli) continue;
          const son = sonGunHesapla(r.teblig_tarihi ?? null, r.itiraz_suresi_gun ?? null);
          if (!r.muhasebe_mail_at && !r.muhasebe_cevap_at) {
            bulunan.push({ id: r.id as string, nereye: "sirket", hal: "gonderilmedi",
              kim: r.alacakli_adi ?? "alacaklı belirsiz", dosya: r.dosya_esas_no ?? "—", sonGun: son });
          } else if (!r.muhasebe_cevap_at && muhasebeCevabiAcilMi(son, bugun)) {
            bulunan.push({ id: r.id as string, nereye: "sirket", hal: "bekleniyor",
              kim: r.alacakli_adi ?? "alacaklı belirsiz", dosya: r.dosya_esas_no ?? "—", sonGun: son });
          }
        }
      }
      // Önce gönderilmeyenler, sonra son günü en yakın olanlar.
      bulunan.sort((a, b) => (a.hal === b.hal
        ? (a.sonGun ?? "9999").localeCompare(b.sonGun ?? "9999")
        : a.hal === "gonderilmedi" ? -1 : 1));
      setSatirlar(bulunan);
    } catch (e) {
      // Okunamazsa şerit çıkmaz; ana ekranın geri kalanı ayakta kalsın.
      console.warn("Muhasebe uyarısı hesaplanamadı:", e instanceof Error ? e.message : e);
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

  /** Şeridin üzerinden gönder — başarılıysa satır listeden düşer. */
  async function gonder(s: Satir) {
    setGonderilen(s.id);
    try {
      const c = await muhasebeyeGonder(s.id, s.nereye === "sirket" ? "sirket" : "icra");
      setSatirlar((p) => p.filter((x) => !(x.id === s.id && x.hal === "gonderilmedi")));
      toast.success(`${s.dosya} muhasebeye gönderildi (${c.alicilar.length} alıcı) · ek: ${c.ek}`, { duration: 7000 });
      if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
      if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
    } catch (e) {
      // SESSİZ GEÇİLMEZ (AGENTS.md): sebep söylenir, satır listede kalır.
      toast.error(e instanceof Error ? e.message : "Mail gönderilemedi.", { duration: 12000 });
    } finally { setGonderilen(null); }
  }

  if (!yetkili || satirlar.length === 0) return null;
  const gonderilmeyen = satirlar.filter((s) => s.hal === "gonderilmedi").length;
  const bekleyen = satirlar.length - gonderilmeyen;
  const gorunen = satirlar.slice(0, GOSTERILECEK);
  // ŞERİDİN RENGİ EN KÖTÜ HÂLE GÖRE: gönderilmemiş dosya varsa kırmızı.
  const kirmizi = gonderilmeyen > 0;
  const kutu = kirmizi
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-amber-300 bg-amber-50 text-amber-900";
  const ikincil = kirmizi ? "text-red-700" : "text-amber-700";
  const baslik = [
    gonderilmeyen ? `${gonderilmeyen} dosya muhasebeye gönderilmedi` : "",
    bekleyen ? `${bekleyen} dosyada muhasebe cevabı bekleniyor` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 shadow-sm ${kutu}`}>
      <div className="flex items-center gap-3">
        <Calculator size={22} className={`shrink-0 ${kirmizi ? "text-red-600" : "text-amber-600"}`} />
        <div className="flex-1">
          <div className="font-semibold">{baslik}</div>
          <div className={`text-xs ${ikincil}`}>
            Cevabın altlığını ve borç durumunu muhasebe hazırlıyor; cevap şeklini de o belirliyor.
            Süre muhasebe beklenirken de işliyor.
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {gorunen.map((s) => (
          <li key={`${s.hal}-${s.nereye}-${s.id}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {s.nereye === "takip"
              ? <Gavel size={13} className="shrink-0 opacity-70" aria-label="Üçüncü şahıs haczi" />
              : <Scale size={13} className="shrink-0 opacity-70" aria-label="Şirkete açılan takip" />}
            <span className="font-medium">
              {s.nereye === "takip" ? formatBuyukHarf(s.kim) : formatBaslik(s.kim)}
            </span>
            <span className={ikincil}>· {s.dosya}</span>
            <span className={ikincil}>
              · son gün <strong>{tarihGoster(s.sonGun)}</strong>
              {s.sonGun === bugunISO() ? " (bugün)" : ""}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {s.hal === "gonderilmedi" ? (
                <button type="button" disabled={gonderilen === s.id} onClick={() => void gonder(s)}
                  title="İcra yazısını ekiyle birlikte muhasebeye gönder"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-700 bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60">
                  {gonderilen === s.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Muhasebeye gönder
                </button>
              ) : (
                <span className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800">
                  Muhasebeyi arayın
                </span>
              )}
            </span>
          </li>
        ))}
        {satirlar.length > gorunen.length && (
          <li className={`text-xs ${ikincil}`}>
            … ve {satirlar.length - gorunen.length} dosya daha —{" "}
            <a href="/dashboard/icra" className="underline">İcra Dosyaları</a>
          </li>
        )}
      </ul>
    </div>
  );
}
