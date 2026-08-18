// Stabilize özeti — ORTAK hesap çekirdeği. Hem SUNUCU (API/backfill: özet üret) hem TARAYICI
// (tek-gün düzenleme) aynı fonksiyonu çağırır → sonuç BİREBİR aynı, sapma olmaz.
//
// Mantık arvento-stabilize.tsx ile birebir:
//   gunBazliSinifla (per-day): mukerrerIsaretle(pencSn, yaricap) → arizaIsaretle(rota, ocak, ocakYaricap)
//   snap: damperDurakKonumu(rota, saat)  (yoksa null → tarayıcı snapReglaj fallback yapar)
//
// NOT: MANUEL override (gerçek/mükerrer/arıza) BURADA uygulanmaz — o tarayıcıda, özetin üstüne uygulanır
//   (override değişince özet bayatlamasın). Özet yalnız OTOMATİK sınıfı taşır.
import { arizaIsaretle, damperDurakKonumu, type LatLng } from "./ocak";
import { mukerrerIsaretle } from "./damper-say";

export type OzetAyar = { mukerrerDk: number; mukerrerYaricap: number; ocakYaricap: number };

// Sefer Analizi: kamyon çizgisinin GİRİŞ KAPISINI o yöne kesme sayısı (per plaka). Kamyon rotası gerektiği
// için SUNUCUDA hesaplanır (tarayıcıya kamyon GPS inmiyor) ve özete eklenir.
export type OzetGiris = { plaka: string; girisOcak: number; girisDokum: number };

export type OzetDamper = {
  plaka: string;
  saat: string | null;
  tarih: string;          // damperin KENDİ günü (_t)
  adres: string | null;
  surucu: string | null;
  rawLat: number | null;  // ham (API) konum — durak yoksa snapReglaj için
  rawLng: number | null;
  durakLat: number | null; // damperDurakKonumu sonucu (yoksa null)
  durakLng: number | null;
  mukerrer: boolean;
  ariza: boolean;
  dogrulanmamis: boolean;
};

type HamDamper = { saat: string | null; adres?: string | null; lat?: number | null; lng?: number | null };
type RotaNk = { lat: number; lng: number; saat: string | null; hiz: number | null };

// BİR gün + BİR plaka: sınıfla + durak konumuna oturt. (gunBazliSinifla'nın gün-içi adımı ile aynı.)
export function siniflaGunDamper(
  plaka: string,
  tarih: string,
  surucu: string | null,
  dampers: HamDamper[],
  rota: RotaNk[],
  ocak: LatLng | null,
  ayar: OzetAyar,
): OzetDamper[] {
  const pencSn = Math.max(0, ayar.mukerrerDk) * 60;
  const muk = mukerrerIsaretle(dampers, pencSn, ayar.mukerrerYaricap);
  const sinifli = arizaIsaretle(muk, rota, ocak, ayar.ocakYaricap);
  return sinifli.map((o) => {
    // Alarm konumu MESAFE SINIRI ile oturt: sınırsız oturtma, uzak kavşak/sıra duruşuna yapışıp
    // ikonu ~200m kaydırıyordu (bkz. ocak.ts damperDurakKonumu notu).
    const durak = damperDurakKonumu(rota, o.saat, 420, (o.lat != null && o.lng != null) ? { lat: o.lat, lng: o.lng } : null);
    return {
      plaka,
      saat: o.saat ?? null,
      tarih,
      adres: o.adres ?? null,
      surucu,
      rawLat: o.lat ?? null,
      rawLng: o.lng ?? null,
      durakLat: durak ? durak[0] : null,
      durakLng: durak ? durak[1] : null,
      mukerrer: o.mukerrer,
      ariza: o.ariza,
      dogrulanmamis: o.dogrulanmamis,
    };
  });
}

// O günün ocak+ayar+giriş parmak izi → imza. Değişirse özet yeniden hesaplanır.
// SINIFLAMA ALGORİTMA SÜRÜMÜ — sınıflama mantığı (lib/arvento/ocak.ts: arizaIsaretle / mukerrerIsaretle)
// her değiştiğinde BURAYI artır. İmzanın başına yazılır; sunucu önbellekte farklı sürüm görünce o günü
// yeniden hesaplar. Yoksa geçmiş günler eski mantıkla hesaplanmış sonucu sonsuza kadar gösterir
// (önbellek gün-gün imza karşılaştırmıyordu; a2 öncesi düzeltmeler elle backfill gerektiriyordu).
//   a1 → ilk sürüm
//   a2 → "ocakta döküm" kararı artık döküm ANINDAKİ konuma bakıyor (ham koordinat → ±3 dk rota → karar yok);
//        eskiden ±7 dk içindeki en yakın DURUŞ kullanılıyor, saha teslimleri ocakta döküm sanılıyordu.
export const OZET_ALGO = "a2";

export function ozetImza(
  ocak: LatLng | null,
  ayar: OzetAyar,
  // Kapı çizgisi ÇOK NOKTALI olabilir → imza TÜM noktaları kapsar, yoksa köşe eklenip çıkarıldığında
  // önbellek tazelenmez. Eski çağrılar (yalnız lat/lng+lat2/lng2) için A–B'ye düşer.
  giris?: { lat: number; lng: number; lat2: number; lng2: number; noktalar?: LatLng[] } | null,
): string {
  const o = ocak ? `${ocak.lat.toFixed(6)},${ocak.lng.toFixed(6)}` : "yok";
  const gn = giris
    ? (giris.noktalar && giris.noktalar.length >= 2
      ? giris.noktalar
      : [{ lat: giris.lat, lng: giris.lng }, { lat: giris.lat2, lng: giris.lng2 }])
    : null;
  const g = gn ? gn.map((n) => `${n.lat.toFixed(6)},${n.lng.toFixed(6)}`).join(";") : "yok";
  return `v:${OZET_ALGO}|o:${o}|oy:${ayar.ocakYaricap}|md:${ayar.mukerrerDk}|my:${ayar.mukerrerYaricap}|g:${g}`;
}
