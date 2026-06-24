// Stabilize GERÇEK damper sayımı — PAYLAŞILAN (Stabilize sekmesi + Dashboard widget AYNI sonucu üretsin).
// Gerçek = mükerrer DEĞİL + arıza DEĞİL. Mükerrer: aynı boşaltmanın art arda tetiklenmesi (yarıçap+süre).
// Arıza: ocağa (yükleme noktası) uğramadan inen damper. Manuel override (gercek/mukerrer/ariza) otomatiği ezer.
import { saatSn, mesafeMetre, arizaIsaretle, type LatLng } from "@/lib/arvento/ocak";
import type { DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";

type Olay = { saat: string | null; lat?: number | null; lng?: number | null };
type Nokta = { saat?: string | null; lat?: number | null; lng?: number | null };

// Mükerrer (yanlış tetik) işaretle: bir damper, daha önce TUTULAN bir dampere HEM yarıçap (m) HEM süre
// (sn) içinde yakınsa mükerrer. İkisi de >0 değilse temizleme yok. Konumsuz olaylar mükerrer sayılmaz.
export function mukerrerIsaretle<T extends Olay>(olaylar: T[], pencSn: number, yaricapM: number): (T & { mukerrer: boolean })[] {
  if (pencSn <= 0 || yaricapM <= 0) return olaylar.map((o) => ({ ...o, mukerrer: false }));
  const konumlu = olaylar.filter((o) => o.lat != null && o.lng != null);
  const sirali = [...konumlu].sort((a, b) => (saatSn(a.saat) ?? 0) - (saatSn(b.saat) ?? 0));
  const mset = new Set<T>();
  const tutulan: T[] = []; // mükerrer SAYILMAYAN (gerçek) damperler
  for (const o of sirali) {
    const sn = saatSn(o.saat);
    const yakin = sn != null && tutulan.some((t) => {
      const tsn = saatSn(t.saat);
      if (tsn == null || sn - tsn > pencSn) return false;
      return mesafeMetre(t.lat as number, t.lng as number, o.lat as number, o.lng as number) <= yaricapM;
    });
    if (yakin) mset.add(o); else tutulan.push(o);
  }
  return olaylar.map((o) => ({ ...o, mukerrer: mset.has(o) }));
}

// Bir aracın GERÇEK damper sayısı (mükerrer + ocağa göre arıza ayıklanmış, manuel override uygulanmış).
// Olay yoksa 0 döner → çağıran damper_sayisi'ne düşmeli.
export function gercekDamperSayisi<T extends Olay>(
  olaylar: T[],
  rota: Nokta[],
  ocak: LatLng | null,
  ocakYaricap: number,
  mukerrerDk: number,
  mukerrerYaricap: number,
  override: (o: T) => DamperSinif | undefined,
): number {
  const muk = mukerrerIsaretle(olaylar, Math.max(0, mukerrerDk) * 60, mukerrerYaricap);
  const sinifli = arizaIsaretle(muk, rota, ocak, ocakYaricap);
  return sinifli.filter((o) => {
    const ov = override(o);
    if (ov === "gercek") return true;
    if (ov === "mukerrer" || ov === "ariza") return false;
    return !o.mukerrer && !o.ariza;
  }).length;
}
