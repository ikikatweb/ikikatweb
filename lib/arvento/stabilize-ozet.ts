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
    const durak = damperDurakKonumu(rota, o.saat);
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
export function ozetImza(
  ocak: LatLng | null,
  ayar: OzetAyar,
  giris?: { lat: number; lng: number; lat2: number; lng2: number } | null,
): string {
  const o = ocak ? `${ocak.lat.toFixed(6)},${ocak.lng.toFixed(6)}` : "yok";
  const g = giris ? `${giris.lat.toFixed(6)},${giris.lng.toFixed(6)},${giris.lat2.toFixed(6)},${giris.lng2.toFixed(6)}` : "yok";
  return `o:${o}|oy:${ayar.ocakYaricap}|md:${ayar.mukerrerDk}|my:${ayar.mukerrerYaricap}|g:${g}`;
}
