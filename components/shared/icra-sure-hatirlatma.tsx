// ANA SAYFA — İCRA SÜRESİ HATIRLATMASI.
//
// "Son cevap günü yaklaştı, hâlâ cevap yok" uyarısı. İki defteri birden tarar:
//   · Üçüncü Şahıs Hacizleri  → icraya cevap verilmemiş dosyalar
//   · Şirkete Açılan Takipler → henüz ele alınmamış ödeme emirleri
//
// NE ZAMAN ÇIKAR: son günden bir gün önce. O gün hafta sonuna denk gelirse CUMADAN
// çıkar — cumartesi-pazar icra dairesine cevap verilemez, pazar çıkan bir uyarı
// "yarın son gün" dese de elden bir şey gelmez. Hesap lib/utils/icra-sure içinde.
//
// SÜRESİ GEÇENLER BURADA GÖRÜNMEZ: bu bir hatırlatma. Geçmiş dosyalar aşağıdaki
// icra kartlarında kırmızı duruyor ve menü rozetinde sayılıyor; hepsi kalıcı olarak
// en üstte de dursaydı şerit her gün aynı şeyi söyleyip okunmaz hale gelirdi.
//
// "ANLAŞILDI" DÜĞMESİ YOK, BİLEREK: süre birkaç gün açık kalıyor ve kapatılırsa bir
// daha açılmaz. Kaçırılması en pahalı uyarı bu; kapatma hakkı verilmiyor. Cevap
// girilince ya da dosyanın durumu değişince şerit kendiliğinden kalkar.
"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gavel, Scale } from "lucide-react";
import { useAuth, ICRA_DEGISTI } from "@/hooks";
import { createClient } from "@/lib/supabase/client";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import {
  sonGunHesapla, hatirlatmaZamaniMi, hatirlatmaGunu, gunFarki, bugunISO,
  VARSAYILAN_CEVAP_SURESI,
} from "@/lib/utils/icra-sure";

type Satir = {
  id: string;
  nereye: "takip" | "sirket";   // hangi sekmeye götüreceği
  kim: string;                  // borçlu (üçüncü şahıs defteri) ya da alacaklı (ödeme emri)
  dosya: string;
  sonGun: string;
  kalan: number;
  tutar: number;
  varsayilanSure: boolean;      // süre belgeden değil varsayılandan geldiyse söylenir
};

const tarihGoster = (v: string) => v.split("-").reverse().join(".");
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function IcraSureHatirlatma() {
  const { isYonetici, hasPermission } = useAuth();
  const yetkili = isYonetici || hasPermission("icra", "goruntule");
  const [satirlar, setSatirlar] = useState<Satir[]>([]);

  const kontrol = useCallback(async () => {
    if (!yetkili) { setSatirlar([]); return; }
    const sb = createClient();
    const bugun = bugunISO();
    const bulunan: Satir[] = [];
    try {
      // Üçüncü şahıs: cevabı verilmemiş, haczi kaldırılmamış dosyalar.
      const { data: ucuncu, error: e1 } = await sb.from("icra")
        .select("id, borclu_adi, dosya_esas_no, teblig_tarihi, cevap_suresi_gun, borc_miktari")
        .is("cevap_tarihi", null).is("haciz_kaldirma_tarihi", null);
      if (e1) throw e1;
      for (const r of ucuncu ?? []) {
        const sure = r.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI;
        const son = sonGunHesapla(r.teblig_tarihi, sure);
        if (!son || !hatirlatmaZamaniMi(son, bugun)) continue;
        bulunan.push({
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
          if (!son || !hatirlatmaZamaniMi(son, bugun)) continue;
          bulunan.push({
            id: r.id, nereye: "sirket", kim: r.alacakli_adi ?? "alacaklı belirsiz",
            dosya: r.dosya_esas_no ?? "—", sonGun: son, kalan: gunFarki(bugun, son),
            tutar: Number(r.takip_tutari || 0), varsayilanSure: false,
          });
        }
      }
      bulunan.sort((a, b) => a.sonGun.localeCompare(b.sonGun) || b.tutar - a.tutar);
      setSatirlar(bulunan);
    } catch (e) {
      // Okunamazsa şerit çıkmaz; ana ekranın geri kalanı ayakta kalsın. Sebep konsola.
      console.warn("İcra süresi hatırlatması hesaplanamadı:", e instanceof Error ? e.message : e);
      setSatirlar([]);
    }
  }, [yetkili]);

  useEffect(() => {
    void (async () => { await kontrol(); })();
    // Gece yarısını devirince gün değişir; sekmeye dönünce yeniden hesaplanır.
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

  if (!yetkili || satirlar.length === 0) return null;

  const bugunSonGun = satirlar.filter((s) => s.kalan === 0).length;

  return (
    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-red-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {satirlar.length} icra dosyasında süre doluyor, cevap verilmemiş
            {bugunSonGun > 0 && <span className="ml-1">— {bugunSonGun} tanesinde BUGÜN son gün</span>}
          </div>
          <div className="text-xs text-red-700">
            Hafta sonu cevap verilemediği için uyarı cumadan çıkar.
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {satirlar.map((s) => (
          <li key={`${s.nereye}-${s.id}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {s.nereye === "takip"
              ? <Gavel size={13} className="shrink-0 text-red-600" aria-label="Üçüncü şahıs haczi" />
              : <Scale size={13} className="shrink-0 text-red-600" aria-label="Şirkete açılan takip" />}
            {/* Üçüncü şahıs defterinde "kim" borçlu kişidir (TÜMÜ BÜYÜK),
                ödeme emrinde alacaklı ünvanıdır (Başlık Biçimi) — kartlarla aynı. */}
            <span className="font-medium">
              {s.nereye === "takip" ? formatBuyukHarf(s.kim) : formatBaslik(s.kim)}
            </span>
            <span className="text-red-700">· {s.dosya}</span>
            <span className="text-red-700">
              · son gün <strong>{tarihGoster(s.sonGun)}</strong>
              {s.kalan === 0 ? " (bugün!)" : ` (${s.kalan} gün kaldı)`}
              {s.varsayilanSure && (
                <span className="text-[11px] text-red-500" title="Belge okunmadığı için varsayılan 7 gün kullanıldı; gerçek süre belgede yazar."> (varsayılan süre)</span>
              )}
            </span>
            {s.tutar > 0 && <span className="font-semibold tabular-nums">· {fmt(s.tutar)} ₺</span>}
            <a href={s.nereye === "takip"
              ? `/dashboard/icra?duzenle=${s.id}&kilit=1`
              : `/dashboard/icra?sekme=sirket&duzenle=${s.id}`}
              className="ml-auto inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700">
              Cevabı işle
            </a>
          </li>
        ))}
      </ul>
      {/* Hatırlatma penceresinin ne zaman açıldığını söyler — "niye bugün çıktı" sorusu
          için. Tek satırda ilk dosyanın penceresi örnek verilir. */}
      <p className="mt-2 pl-9 text-[11px] text-red-600">
        Uyarı {tarihGoster(hatirlatmaGunu(satirlar[0].sonGun)!)} tarihinden beri gösteriliyor.
      </p>
    </div>
  );
}
