// TEK ŞANTİYENİN PRİM DURUMU — ana ekrandaki "Kalan" sütununun birebir aynısı.
//
// Giden evrakta geçici kabul dilekçesi kaydedilmeden önce "prim dolmadı, emin misin?" uyarısı
// çıkacak. Önceki sürüm burada SADE formülü kullanıyordu —
//   (sözleşme + keşif + fiyat farkı) × oran / 100 − yatan
// — ve Samsun Vezirköprü'de −495.342 ₺ (fazla yatmış) çıktığı için uyarı hiç açılmıyordu;
// oysa ana ekranda aynı iş için 976.556 ₺ eksik yazıyordu. Fark iki kalemdi: tahmini fiyat
// farkı (yatması gerekene EKLENİR) ve tahmini bordro (henüz işlenmemiş aylar, DÜŞÜLÜR).
//
// Artık ana ekranla aynı veri kaynaklarından aynı hesap yapılıyor; tahmini bordro ortak
// fonksiyondan geliyor (lib/bordro/tahmini-bordro.ts).

import { getIscilikTakibi, getSonHakedisMap, getTumIscilikAyliklari } from "@/lib/supabase/queries/iscilik-takibi";
import { getAtamaGecmisiTumu, getManuelGunler, getGunlukUcretler } from "@/lib/supabase/queries/bordro";
import { getTumPersonelBrutUcretler, brutUcretForAy } from "@/lib/supabase/queries/personel-brut-ucret";
import { ayYilNum, tahminiBordroHesapla } from "@/lib/bordro/tahmini-bordro";

export type PrimDurumu = {
  /** Yatması gereken — tahmini fiyat farkı DÂHİL (ana ekranın varsayılan görünümü). */
  gereken: number;
  yatan: number;
  tahminiBordro: number;
  /** Ana ekrandaki "Kalan": gereken − yatan − tahmini bordro. */
  eksik: number;
};

/** Tek şantiyenin prim durumu. Hesaplanamıyorsa null → kaydı ENGELLEME. */
export async function getSantiyePrimDurumu(santiyeId: string): Promise<PrimDurumu | null> {
  if (!santiyeId) return null;
  try {
    const [takibi, sonHakedis, ayliklar, atamalar, manuelGunler, gunlukUcretler, brutUcretler] =
      await Promise.all([
        getIscilikTakibi(),
        getSonHakedisMap(),
        getTumIscilikAyliklari(),
        getAtamaGecmisiTumu(),
        getManuelGunler(),
        getGunlukUcretler(),
        getTumPersonelBrutUcretler(),
      ]);

    // iscilik_takibi_id → işlenmiş son ay (tahmin bu ayın SONRASI için yapılır)
    const sonAyByTakibi = new Map<string, string>();
    for (const a of ayliklar as { iscilik_takibi_id: string; ait_oldugu_ay: string }[]) {
      const mevcut = sonAyByTakibi.get(a.iscilik_takibi_id);
      if (!mevcut || ayYilNum(a.ait_oldugu_ay) > ayYilNum(mevcut)) {
        sonAyByTakibi.set(a.iscilik_takibi_id, a.ait_oldugu_ay);
      }
    }

    type Satir = {
      id: string; santiye_id: string | null;
      kesif_artisi: number | null; fiyat_farki: number | null;
      iscilik_orani: number | null; yatan_prim: number | null;
      santiyeler?: { sozlesme_bedeli?: number | null; sozlesme_fiyatlariyla_gerceklesen?: number | null } | null;
    };
    const sh = sonHakedis.get(santiyeId);

    let gereken = 0, yatan = 0, sonAyNum = 0;
    for (const r of (takibi ?? []) as unknown as Satir[]) {
      if (r.santiye_id !== santiyeId) continue;
      const bedel = r.santiyeler?.sozlesme_bedeli ?? 0;
      const kesif = r.kesif_artisi ?? 0;
      const ff = r.fiyat_farki ?? 0;
      const oran = r.iscilik_orani ?? 0;
      // Tahmini fiyat farkı — İşçilik Takibi ve ana ekranla aynı formül:
      //   kalan keşif = (sözleşme + keşif artışı) − tamamlanan keşif
      //   tahmini FF  = kalan keşif × (son hakediş fiyat farkı ÷ son hakediş bedeli)
      const gerceklesen = r.santiyeler?.sozlesme_fiyatlariyla_gerceklesen ?? 0;
      const kalanKesif = bedel + kesif - gerceklesen;
      const tahminiFF = sh && sh.kesif > 0 && sh.fark > 0 && kalanKesif > 0
        ? kalanKesif * (sh.fark / sh.kesif)
        : 0;
      gereken += (bedel + kesif + ff + tahminiFF) * oran / 100;
      yatan += r.yatan_prim ?? 0;
      const sonAy = sonAyByTakibi.get(r.id);
      const n = sonAy ? ayYilNum(sonAy) : 0;
      if (n > sonAyNum) sonAyNum = n;
    }
    if (gereken <= 0) return null;   // oran/bedel girilmemiş → hesaplanamaz, uyarma

    const simdi = new Date();
    const { toplam: tahminiBordro } = tahminiBordroHesapla({
      santiyeId,
      sonAyNum,
      buYilAyNum: simdi.getFullYear() * 100 + (simdi.getMonth() + 1),
      manuelGunler,
      atamalar,
      ucret: (personelId, ayStr, yil) => {
        const brut = brutUcretForAy(brutUcretler, personelId, ayStr);
        if (brut > 0) return brut;
        return gunlukUcretler.find((u) => u.yil === yil)?.ucret ?? 0;
      },
    });

    return { gereken, yatan, tahminiBordro, eksik: gereken - yatan - tahminiBordro };
  } catch {
    return null;                     // hesaplanamadıysa kaydı engelleme
  }
}
