// Bir günün metriğini TARAYICIDA yeniden hesaplayıp cache'e (arvento_gunluk_metrik) yazar.
// Neden: dashboard "Sezon Özeti" geçmiş günleri cache'ten okur, bugünü taze hesaplar. Manuel damper override
// (gerçek/mükerrer/arıza) GEÇMİŞ bir günde yapılınca o günün cache'i güncellenmediği için sezon toplamı
// değişmiyordu. Override sonrası bu çağrılır → o günün kamyon sefer + uzunluk metrikleri tazelenir.
import { getArventoRaporByTarih, getGuzergahByTarih, getPlakaSantiyeMap, plakaNorm } from "@/lib/supabase/queries/arvento";
import { getArventoAyarlar, getOcakForTarih, getDamperSiniflar, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import { hesaplaGunlukMetrik, metrikImza } from "./gunluk-metrik";

export async function gunMetrikTazele(tarih: string): Promise<void> {
  const [kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinif] = await Promise.all([
    getArventoRaporByTarih(tarih),
    getGuzergahByTarih(tarih),
    getPlakaSantiyeMap(tarih),
    getArventoAyarlar(),
    getOcakForTarih(tarih),
    getDamperSiniflar(tarih, tarih), // GÜNCEL override'ları (yeni işaretleme dahil) okur
  ]);
  const sinifMap = new Map<string, DamperSinif>();
  for (const r of sinif) sinifMap.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif);
  const m = hesaplaGunlukMetrik({ tarih, kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinifMap });
  await fetch("/api/arvento/gunluk-metrik", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tarih, ...m, imza: metrikImza(ayarlar) }),
  });
}
