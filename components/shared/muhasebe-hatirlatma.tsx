// ANA SAYFA — MUHASEBE AŞAMASINDA TIKANAN DOSYALAR.
//
// NİYE: cevabın altlığını ve borç durumunu muhasebe hazırlıyor; cevap şeklini
// (yazışma / havale / avukat) belirleyen de o. Bu aşamada duran dosya, hiçbir
// ekranda "bekliyor" demiyordu — süre ise muhasebe beklerken de işliyor.
//
// ══ GÖNDERİM İNSANI BEKLEMEZ ══
// Mail, dosya cevap bekleyenlere düşer düşmez KENDİLİĞİNDEN gider — yeni kayıtta
// kaydetme anında, gidememiş dosyalarda ana ekran açılınca. Burada basılacak bir
// "gönder" düğmesi yok: "gelir gelmez gönderilsin" kuralını insana bırakmak,
// kuralı unutulabilir yapardı.
//
// ÇİFT MAİL YOK: gönderim izi olan dosya otomatik yolda atlanıyor (sunucuda
// `otomatik` kapısı) — aynı dosyayı iki kullanıcının ekranı da tetiklese tek mail
// gider.
//
// ŞERİTTE GÖRÜNEN İKİ HÂL:
//   1) GÖNDERİLEMEDİ (kırmızı) — otomatik gönderim denendi ama olmadı; sebebi
//      yazıyor (çoğunlukla tebligat belgesi panelde yok / inmedi). AGENTS.md
//      "sessiz hata yok": gidemeyen mail gizlenmez, "Tekrar dene" burada durur.
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

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** gonderiliyor → otomatik gönderim sürüyor · gonderilemedi → denendi, olmadı */
  hal: "gonderiliyor" | "gonderilemedi" | "bekleniyor";
  kim: string;
  dosya: string;
  sonGun: string | null;
  /** Gönderilemediyse sebebi — kullanıcıya olduğu gibi gösterilir. */
  hata?: string;
};

const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "süre belirsiz");

export default function MuhasebeHatirlatma() {
  const { isYonetici, hasPermission } = useAuth();
  const yetkili = isYonetici || hasPermission("icra", "goruntule");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [gonderilen, setGonderilen] = useState<string | null>(null);
  // BU OTURUMDA DENENENLER: otomatik gönderim her satır için bir kez denenir.
  // Olmadıysa sebebiyle şeritte durur; sayfa her tazelendiğinde yeniden
  // denenseydi, inmeyen bir ek yüzünden dakikada bir mail denemesi olurdu.
  const denenenler = useRef<Set<string>>(new Set());

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
          bulunan.push({ id: r.id as string, nereye: "takip", hal: "gonderiliyor",
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
            bulunan.push({ id: r.id as string, nereye: "sirket", hal: "gonderiliyor",
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
        : a.hal === "bekleniyor" ? 1 : -1));
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

  /**
   * OTOMATİK GÖNDERİM — insan beklemez.
   *
   * Cevap bekleyenlere düşmüş ama maili gitmemiş dosya bulununca mail
   * kendiliğinden gider. Başarılıysa satır düşer; gidemezse SEBEBİYLE kalır
   * (AGENTS.md "sessiz hata yok") ve "Tekrar dene" düğmesi çıkar.
   *
   * HER SATIR İÇİN BİR KEZ: sayfa her tazelendiğinde yeniden denenseydi,
   * tebligat belgesi inmeyen bir dosya yüzünden sürekli gönderim denemesi
   * olurdu. Sunucudaki `otomatik` kapısı da ayrıca ikinci maili engelliyor.
   */
  async function gonder(s: Satir, elle = false) {
    setGonderilen(s.id);
    try {
      const c = await muhasebeyeGonder(s.id, s.nereye === "sirket" ? "sirket" : "icra", "", !elle);
      setSatirlar((p) => p.filter((x) => !(x.id === s.id && x.hal !== "bekleniyor")));
      // ZATEN GİTMİŞSE SESSİZ: başka bir ekran göndermiş olabilir, kullanıcıya
      // bildirilecek yeni bir şey yok.
      if (c.gonderildi) {
        toast.success(`${s.dosya} muhasebeye gönderildi (${c.alicilar.length} alıcı) · ek: ${c.ek}`);
        if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
        if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
      }
    } catch (e) {
      const mesaj = e instanceof Error ? e.message : "Mail gönderilemedi.";
      // SESSİZ GEÇİLMEZ: satır sebebiyle şeritte kalır, balon da çıkar.
      setSatirlar((p) => p.map((x) => (x.id === s.id && x.hal !== "bekleniyor"
        ? { ...x, hal: "gonderilemedi", hata: mesaj } : x)));
      toast.error(`${s.dosya} muhasebeye GÖNDERİLEMEDİ — ${mesaj}`, { duration: 12000 });
    } finally { setGonderilen(null); }
  }

  // Gönderim sırası: listeye yeni düşen her dosya için bir kez, art arda.
  useEffect(() => {
    const sira = satirlar.filter((s) => s.hal === "gonderiliyor" && !denenenler.current.has(s.id));
    if (sira.length === 0) return;
    for (const s of sira) denenenler.current.add(s.id);
    void (async () => { for (const s of sira) await gonder(s); })();
    // gonder bileşenin içinde tanımlı; satırlar değiştikçe bu etki yeniden koşar
    // ve denenenler kapısı tekrar göndermeyi engeller.
  }, [satirlar]);

  if (!yetkili || satirlar.length === 0) return null;
  const gidiyor = satirlar.filter((s) => s.hal === "gonderiliyor").length;
  const gonderilemeyen = satirlar.filter((s) => s.hal === "gonderilemedi").length;
  const bekleyen = satirlar.filter((s) => s.hal === "bekleniyor").length;
  const gorunen = satirlar.slice(0, GOSTERILECEK);
  // ŞERİDİN RENGİ EN KÖTÜ HÂLE GÖRE: gidemeyen mail varsa kırmızı.
  const kirmizi = gonderilemeyen > 0;
  const kutu = kirmizi
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-amber-300 bg-amber-50 text-amber-900";
  const ikincil = kirmizi ? "text-red-700" : "text-amber-700";
  const baslik = [
    gonderilemeyen ? `${gonderilemeyen} dosya muhasebeye GÖNDERİLEMEDİ` : "",
    gidiyor ? `${gidiyor} dosya muhasebeye gönderiliyor` : "",
    bekleyen ? `${bekleyen} dosyada muhasebe cevabı bekleniyor` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 shadow-sm ${kutu}`}>
      <div className="flex items-center gap-3">
        <Calculator size={22} className={`shrink-0 ${kirmizi ? "text-red-600" : "text-amber-600"}`} />
        <div className="flex-1">
          <div className="font-semibold">{baslik}</div>
          <div className={`text-xs ${ikincil}`}>
            Borç durumunu ve hesap ekstresini muhasebe hazırlıyor; cevap şeklini de o belirliyor.
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
            {/* SEBEP SATIRIN ALTINDA: "gönderilemedi" tek başına ne yapılacağını
                söylemiyor; çoğu zaman tebligat belgesi panelde yok demek. */}
            {s.hata ? <span className="basis-full text-xs text-red-700">{s.hata}</span> : null}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {s.hal === "gonderiliyor" ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
                  <Loader2 size={12} className="animate-spin" /> gönderiliyor…
                </span>
              ) : s.hal === "gonderilemedi" ? (
                <button type="button" disabled={gonderilen === s.id} onClick={() => void gonder(s, true)}
                  title="İcra yazısını ekiyle birlikte muhasebeye göndermeyi tekrar dene"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-700 bg-red-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60">
                  {gonderilen === s.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Tekrar dene
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
