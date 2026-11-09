// ANA SAYFA — İCRA SÜRESİ UYARISI. İki ayrı şerit, iki ayrı anlam:
//
//   SARI    "son gün yaklaştı"   → bugün ∈ [hatırlatma günü … son gün]
//   KIRMIZI "cevap vermediniz"   → son gün geçti ve hâlâ cevap/işlem yok
//
// İkisi AYRI ANAHTARLA kapatılır. Sarıyı kapatmak kırmızıyı SUSTURMAZ: "yarın son
// gün, haberim var" demek "süreyi kaçırdım, haberim var" demek değildir. Tek anahtar
// kullanılsaydı hatırlatmayı kapatan kişi asıl uyarıyı da kendi elleriyle kapatmış
// olurdu ve kimse fark etmezdi.
//
// HATIRLATMA GÜNÜ: son günden bir gün önce; o gün hafta sonuna denk gelirse CUMADAN.
// Cumartesi-pazar icra dairesine cevap verilemez, pazar çıkan bir uyarı "yarın son
// gün" dese de elden bir şey gelmez. Hesap lib/utils/icra-sure içinde.
//
// KAPATMA HERKESİ ETKİLER (sql/uyari_kapatma_genel.sql): dosyaya cevap veren kişi
// tektir; iş bitince uyarının herkesten kalkması gerekir. Kişisel kapatma olsaydı
// her kullanıcı aynı uyarıyı ayrı ayrı kapatır, "bu dosyayla ilgilenildi mi" bilgisi
// hiçbir yerde toplanmazdı. Kapatan kişi kayda geçer (uyari_onaylari günlüğü).
// Geri alma yolu arayüzde YOK — o yüzden önce onay sorulur.
"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gavel, Scale, Check, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth, ICRA_DEGISTI } from "@/hooks";
import { createClient } from "@/lib/supabase/client";
import IcraCevapDialog from "@/components/shared/icra-cevap-dialog";
import OdemeEmriIslemDialog from "@/components/shared/odeme-emri-islem-dialog";
import type { IcraKayit, IcraSirketTakip } from "@/lib/supabase/types";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import { uyariAnahtari } from "@/lib/supabase/queries/uyari-gizle";
import { getGenelKapatilanlar, uyariyiHerkeseKapat } from "@/lib/supabase/queries/uyari-kapatma";
import {
  sonGunHesapla, hatirlatmaGunu, gunFarki, bugunISO, VARSAYILAN_CEVAP_SURESI,
} from "@/lib/utils/icra-sure";

const TIP_YAKLASTI = "icra-sure-yaklasti";
const TIP_GECTI = "icra-sure-gecti";
const GOSTERILECEK = 6;   // uzun liste şeridi devasa yapıyor; kalanı sayfada

type Satir = {
  id: string;
  nereye: "takip" | "sirket";   // hangi sekmeye götüreceği
  kim: string;                  // borçlu (üçüncü şahıs defteri) ya da alacaklı (ödeme emri)
  dosya: string;
  sonGun: string;
  kalan: number;                // negatifse süre geçmiş
  tutar: number;
  varsayilanSure: boolean;      // süre belgeden değil varsayılandan geldiyse söylenir
  anahtar: string;
};

const tarihGoster = (v: string) => v.split("-").reverse().join(".");
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function IcraSureHatirlatma() {
  const { isYonetici, hasPermission } = useAuth();
  const yetkili = isYonetici || hasPermission("icra", "goruntule");
  const [yaklasan, setYaklasan] = useState<Satir[]>([]);
  const [gecen, setGecen] = useState<Satir[]>([]);
  const [onayBekleyen, setOnayBekleyen] = useState<string | null>(null);   // anahtar
  const [kapatiliyor, setKapatiliyor] = useState(false);
  // SAYFA DEĞİŞMEDEN İŞLE — kartlardaki davranışın aynısı. Şerit satırı dosyanın
  // yalnız birkaç alanını taşıdığı için kayıt tıklanınca TAM hâliyle çekilir.
  const [cevapKayit, setCevapKayit] = useState<IcraKayit | null>(null);
  const [islemKayit, setIslemKayit] = useState<IcraSirketTakip | null>(null);
  const [aciliyor, setAciliyor] = useState<string | null>(null);

  async function islemAc(s: Satir) {
    setAciliyor(s.anahtar);
    try {
      const sb = createClient();
      if (s.nereye === "takip") {
        const { data, error } = await sb.from("icra").select("*").eq("id", s.id).single();
        if (error) throw error;
        setCevapKayit(data as IcraKayit);
      } else {
        const { data, error } = await sb.from("icra_sirket_takip").select("*").eq("id", s.id).single();
        if (error) throw error;
        setIslemKayit(data as IcraSirketTakip);
      }
    } catch (e) {
      // SESSİZ GEÇİLMEZ: pencere açılmadıysa kullanıcı tıkladığını sanıp bekler.
      toast.error(e instanceof Error ? e.message : "Dosya açılamadı.");
    } finally { setAciliyor(null); }
  }

  const kontrol = useCallback(async () => {
    if (!yetkili) { setYaklasan([]); setGecen([]); return; }
    const sb = createClient();
    const bugun = bugunISO();
    const yakin: Satir[] = [];
    const gecmis: Satir[] = [];
    try {
      const kapali = await getGenelKapatilanlar([TIP_YAKLASTI, TIP_GECTI]);

      const ekle = (s: Omit<Satir, "anahtar">) => {
        const gectiMi = s.kalan < 0;
        const anahtar = uyariAnahtari(gectiMi ? TIP_GECTI : TIP_YAKLASTI, `${s.nereye}-${s.id}`);
        if (kapali.has(anahtar)) return;             // biri kapatmış → herkeste kapalı
        (gectiMi ? gecmis : yakin).push({ ...s, anahtar });
      };

      // Üçüncü şahıs: cevabı verilmemiş, haczi kaldırılmamış dosyalar.
      const { data: ucuncu, error: e1 } = await sb.from("icra")
        .select("id, borclu_adi, dosya_esas_no, teblig_tarihi, cevap_suresi_gun, borc_miktari")
        .is("cevap_tarihi", null).is("haciz_kaldirma_tarihi", null);
      if (e1) throw e1;
      for (const r of ucuncu ?? []) {
        const sure = r.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI;
        const son = sonGunHesapla(r.teblig_tarihi, sure);
        const ilk = hatirlatmaGunu(son);
        if (!son || !ilk || bugun < ilk) continue;   // pencere daha açılmadı
        ekle({
          id: r.id, nereye: "takip", kim: r.borclu_adi ?? "borçlu belirsiz",
          dosya: r.dosya_esas_no ?? "—", sonGun: son, kalan: gunFarki(bugun, son),
          tutar: Number(r.borc_miktari || 0), varsayilanSure: r.cevap_suresi_gun == null,
        });
      }

      // Şirkete açılan takipler: henüz ele alınmamış ödeme emirleri.
      // SÜRE BELGEDE YOKSA ATLANIR: burada varsayılan süre YOK, gün uydurulmaz.
      const { data: sirket, error: e2 } = await sb.from("icra_sirket_takip")
        .select("id, alacakli_adi, dosya_esas_no, teblig_tarihi, itiraz_suresi_gun, takip_tutari")
        .eq("durum", "yeni");
      if (e2) {
        // Tablo henüz kurulmamış olabilir; üçüncü şahıs uyarısı yine de gösterilsin.
        console.warn("Şirkete açılan takipler okunamadı:", e2.message);
      } else {
        for (const r of sirket ?? []) {
          const son = sonGunHesapla(r.teblig_tarihi, r.itiraz_suresi_gun);
          const ilk = hatirlatmaGunu(son);
          if (!son || !ilk || bugun < ilk) continue;
          ekle({
            id: r.id, nereye: "sirket", kim: r.alacakli_adi ?? "alacaklı belirsiz",
            dosya: r.dosya_esas_no ?? "—", sonGun: son, kalan: gunFarki(bugun, son),
            tutar: Number(r.takip_tutari || 0), varsayilanSure: false,
          });
        }
      }
      // İkisinde de son günü en eski olan üste: sarıda "en yakın", kırmızıda "en çok gecikmiş".
      yakin.sort((a, b) => a.sonGun.localeCompare(b.sonGun) || b.tutar - a.tutar);
      gecmis.sort((a, b) => a.sonGun.localeCompare(b.sonGun) || b.tutar - a.tutar);
      setYaklasan(yakin);
      setGecen(gecmis);
    } catch (e) {
      // Okunamazsa şerit çıkmaz; ana ekranın geri kalanı ayakta kalsın. Sebep konsola.
      console.warn("İcra süresi uyarısı hesaplanamadı:", e instanceof Error ? e.message : e);
      setYaklasan([]); setGecen([]);
    }
  }, [yetkili]);

  useEffect(() => {
    void (async () => { await kontrol(); })();
    // Gece yarısını devirince gün değişir; sekmeye dönünce yeniden hesaplanır.
    // Başka bir kullanıcı kapatmışsa da bu tazelemede görünür.
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

  async function kapat(anahtar: string) {
    setKapatiliyor(true);
    try {
      const { kayitHatasi } = await uyariyiHerkeseKapat(anahtar);
      setYaklasan((p) => p.filter((s) => s.anahtar !== anahtar));
      setGecen((p) => p.filter((s) => s.anahtar !== anahtar));
      setOnayBekleyen(null);
      toast.success("Uyarı tüm kullanıcılar için kapatıldı.");
      // Günlük tutulamadıysa SÖYLE — "kim kapattı" kaydı var sanılmasın.
      if (kayitHatasi) toast.error(`Kapatan kaydı tutulamadı: ${kayitHatasi}`, { duration: 8000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uyarı kapatılamadı.");
    } finally { setKapatiliyor(false); }
  }

  /** Tek şerit — renk ve metin dışında ikisi aynı. */
  function Serit({ satirlar, kirmizi, baslik, altBaslik }: {
    satirlar: Satir[]; kirmizi: boolean; baslik: string; altBaslik: string;
  }) {
    if (satirlar.length === 0) return null;
    const kutu = kirmizi ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900";
    const ikon = kirmizi ? "text-red-600" : "text-amber-600";
    const ara = kirmizi ? "text-red-700" : "text-amber-700";
    const dugme = kirmizi
      ? "border-red-700 bg-red-600 hover:bg-red-700"
      : "border-amber-700 bg-amber-600 hover:bg-amber-700";
    const gorunen = satirlar.slice(0, GOSTERILECEK);
    return (
      <div className={`mb-4 rounded-xl border px-4 py-3 shadow-sm ${kutu}`}>
        <div className="flex items-center gap-3">
          <AlertTriangle size={22} className={`shrink-0 ${ikon}`} />
          <div className="flex-1">
            <div className="font-semibold">{baslik}</div>
            <div className={`text-xs ${ara}`}>{altBaslik}</div>
          </div>
        </div>
        <ul className="mt-2 space-y-1.5 pl-9 text-sm">
          {gorunen.map((s) => (
            <li key={s.anahtar} className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {s.nereye === "takip"
                ? <Gavel size={13} className={`shrink-0 ${ikon}`} aria-label="Üçüncü şahıs haczi" />
                : <Scale size={13} className={`shrink-0 ${ikon}`} aria-label="Şirkete açılan takip" />}
              {/* Üçüncü şahıs defterinde "kim" borçlu kişidir (TÜMÜ BÜYÜK),
                  ödeme emrinde alacaklı ünvanıdır (Başlık Biçimi) — kartlarla aynı. */}
              <span className="font-medium">
                {s.nereye === "takip" ? formatBuyukHarf(s.kim) : formatBaslik(s.kim)}
              </span>
              <span className={ara}>· {s.dosya}</span>
              <span className={ara}>
                · son gün <strong>{tarihGoster(s.sonGun)}</strong>
                {s.kalan < 0 ? ` (${-s.kalan} gün geçti)` : s.kalan === 0 ? " (bugün!)" : ` (${s.kalan} gün kaldı)`}
                {s.varsayilanSure && (
                  <span className="text-[11px] opacity-70" title="Belge okunmadığı için varsayılan 7 gün kullanıldı; gerçek süre belgede yazar."> (varsayılan süre)</span>
                )}
              </span>
              {s.tutar > 0 && <span className="font-semibold tabular-nums">· {fmt(s.tutar)} ₺</span>}

              {onayBekleyen === s.anahtar ? (
                // Onay kutusu KENDİ SATIRINA iner: aynı satırda durunca uyarı metnini
                // dar bir sütuna sıkıştırıp okunmaz hâle getiriyor.
                <span className="flex basis-full items-center justify-end gap-2">
                  <span className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 shadow-sm">
                    <span className="text-xs text-gray-700">
                      Bu uyarı <strong>tüm kullanıcılarda</strong> kalıcı olarak kapanacak. Onaylıyor musunuz?
                    </span>
                    <button type="button" disabled={kapatiliyor} onClick={() => kapat(s.anahtar)}
                      className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">Evet</button>
                    <button type="button" disabled={kapatiliyor} onClick={() => setOnayBekleyen(null)}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Vazgeç</button>
                  </span>
                </span>
              ) : (
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => islemAc(s)} disabled={aciliyor === s.anahtar}
                    className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-60 ${dugme}`}>
                    {aciliyor === s.anahtar && <Loader2 size={12} className="animate-spin" />} Cevabı işle
                  </button>
                  <button type="button" onClick={() => setOnayBekleyen(s.anahtar)}
                    title="Bu uyarıyı TÜM kullanıcılar için kapat"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50">
                    <Check size={14} /> Anlaşıldı
                  </button>
                </span>
              )}
            </li>
          ))}
          {satirlar.length > gorunen.length && (
            <li className={`text-xs ${ara}`}>
              … ve {satirlar.length - gorunen.length} dosya daha —{" "}
              <a href="/dashboard/icra" className="underline">İcra Dosyaları</a>
            </li>
          )}
        </ul>
      </div>
    );
  }

  if (!yetkili || (yaklasan.length === 0 && gecen.length === 0)) return null;

  const bugunSonGun = yaklasan.filter((s) => s.kalan === 0).length;

  return (
    <>
      {/* KIRMIZI ÖNCE: süresi geçmiş dosya, yaklaşandan daha acildir. */}
      <Serit
        satirlar={gecen} kirmizi
        baslik={`⛔ ${gecen.length} icra dosyasında süre geçti, cevap verilmedi`}
        altBaslik="Son cevap günü dolmuş ve panelde hâlâ cevap/işlem kaydı yok."
      />
      <Serit
        satirlar={yaklasan} kirmizi={false}
        baslik={`⚠️ ${yaklasan.length} icra dosyasında süre doluyor, cevap verilmemiş`
          + (bugunSonGun > 0 ? ` — ${bugunSonGun} tanesinde BUGÜN son gün` : "")}
        altBaslik="Hafta sonu cevap verilemediği için uyarı cumadan çıkar."
      />

      {/* Kayıt işlenince şerit yeniden hesaplanır: cevap girilen dosya listeden düşer. */}
      <IcraCevapDialog
        kayit={cevapKayit} acik={!!cevapKayit} kapat={() => setCevapKayit(null)}
        kaydedildi={() => void kontrol()}
      />
      <OdemeEmriIslemDialog
        kayit={islemKayit} acik={!!islemKayit} kapat={() => setIslemKayit(null)}
        kaydedildi={() => void kontrol()}
      />
    </>
  );
}
