// Bir günün metriğini TARAYICIDA yeniden hesaplayıp cache'e (arvento_gunluk_metrik) yazar.
// Neden: dashboard "Sezon Özeti" geçmiş günleri cache'ten okur, bugünü taze hesaplar. Manuel damper override
// (gerçek/mükerrer/arıza) GEÇMİŞ bir günde yapılınca o günün cache'i güncellenmediği için sezon toplamı
// değişmiyordu. Override sonrası bu çağrılır → o günün kamyon sefer + uzunluk metrikleri tazelenir.
import { getArventoRaporByTarih, getGuzergahByTarih, getGuzergahByRange, getPlakaSantiyeMap, getAraclarAtama, getArventoSonTarih, plakaNorm } from "@/lib/supabase/queries/arvento";
import { getArventoAyarlar, getOcakForTarih, getDamperSiniflar, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import { hesaplaGunlukMetrik, metrikImza, ocakMakineSeti } from "./gunluk-metrik";

const SEZON_BAS = "2026-01-01";

// OCAK MAKİNE KÜMESİ — İş Makineleri sekmesindeki `ocakMakineMap` ile BİREBİR: bitiş(bugün) ocağına karşı
// ARALIK-BİRLEŞİK rotalar. Tek gün değil (o gün rapor vermeyen ocak makinesi kaçardı, ör. 0011). Adaylar
// yalnız ismakine (makineSn'e sadece onlar girer) → sorgu hafif (tekSorgu). Widget + override AYNI fn → imza tutarlı.
export async function ocakMakineSetiCek(bitis?: string | null): Promise<Set<string>> {
  const son = bitis ?? (await getArventoSonTarih());
  if (!son) return new Set();
  const atama = await getAraclarAtama();
  const ismakineAtanmisVar = atama.some((a) => a.sekmeler?.includes("ismakine"));
  const adaylar = atama
    .filter((a) => (a.sekmeler != null ? a.sekmeler.includes("ismakine") : (ismakineAtanmisVar ? false : a.sayacTipi === "saat")))
    .map((a) => a.plaka);
  if (adaylar.length === 0) return new Set();
  const [guz, gunOcak, ayarlar] = await Promise.all([
    getGuzergahByRange(SEZON_BAS, son, adaylar, { tekSorgu: true }),
    getOcakForTarih(son),
    getArventoAyarlar(),
  ]);
  return ocakMakineSeti(guz, [], ayarlar, gunOcak);
}

export async function gunMetrikTazele(tarih: string): Promise<void> {
  const [kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinif, ocakMakinePlakalar] = await Promise.all([
    getArventoRaporByTarih(tarih),
    getGuzergahByTarih(tarih),
    getPlakaSantiyeMap(tarih),
    getArventoAyarlar(),
    getOcakForTarih(tarih),
    getDamperSiniflar(tarih, tarih), // GÜNCEL override'ları (yeni işaretleme dahil) okur
    ocakMakineSetiCek(),
  ]);
  const sinifMap = new Map<string, DamperSinif>();
  for (const r of sinif) sinifMap.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif);
  const m = hesaplaGunlukMetrik({ tarih, kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinifMap, ocakMakinePlakalar });
  await fetch("/api/arvento/gunluk-metrik", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tarih, ...m, imza: metrikImza(ayarlar, plakaSantiye, ocakMakinePlakalar) }),
  });
}
