// Bir günün metriğini TARAYICIDA yeniden hesaplayıp cache'e (arvento_gunluk_metrik) yazar.
// Neden: dashboard "Sezon Özeti" geçmiş günleri cache'ten okur, bugünü taze hesaplar. Manuel damper override
// (gerçek/mükerrer/arıza) GEÇMİŞ bir günde yapılınca o günün cache'i güncellenmediği için sezon toplamı
// değişmiyordu. Override sonrası bu çağrılır → o günün kamyon sefer + uzunluk metrikleri tazelenir.
import { getArventoRaporByTarih, getGuzergahByTarih, getGuzergahByRange, getPlakaSantiyeMap, getAraclarAtama, getArventoSonTarih, plakaNorm } from "@/lib/supabase/queries/arvento";
import { getArventoAyarlar, getOcakForTarih, getDamperSiniflar, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import { mesafeMetre } from "@/lib/arvento/ocak";
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

export type OcakMakineDetay = { lat: number; lng: number; sonTarih: string };
// OCAK MAKİNELERİ + SON BİLİNEN GPS KONUMU. Ocak makinesi ocakta GPS'siz (sinyalsiz) çalıştığı gün rota
// vermez → o gün ocak sayılamaz, İş Makineleri'ne düşerdi. Bu fonksiyon aralık-birleşik (sezon) rotadan
// kalıcı ocak kümesini + her makinenin EN SON GPS noktasını verir. Stabilize, rota yoksa makineyi bu son
// konumda gösterir; İş Makineleri ise dışlar. (Set ile aynı üyelik: bitiş ocağına ≥%50 içeride.)
export async function ocakMakineDetayCek(bitis?: string | null): Promise<Map<string, OcakMakineDetay>> {
  const out = new Map<string, OcakMakineDetay>();
  const son = bitis ?? (await getArventoSonTarih());
  if (!son) return out;
  const atama = await getAraclarAtama();
  const ismakineAtanmisVar = atama.some((a) => a.sekmeler?.includes("ismakine"));
  const adaylar = atama
    .filter((a) => (a.sekmeler != null ? a.sekmeler.includes("ismakine") : (ismakineAtanmisVar ? false : a.sayacTipi === "saat")))
    .map((a) => a.plaka);
  if (adaylar.length === 0) return out;
  const [guz, gunOcak, ayarlar] = await Promise.all([
    getGuzergahByRange(SEZON_BAS, son, adaylar, { tekSorgu: true }),
    getOcakForTarih(son),
    getArventoAyarlar(),
  ]);
  const ocak = gunOcak ? { lat: gunOcak.lat, lng: gunOcak.lng } : (ayarlar?.ocakLat != null && ayarlar?.ocakLng != null ? { lat: ayarlar.ocakLat, lng: ayarlar.ocakLng } : null);
  const ocakR = gunOcak?.yaricap ?? ayarlar?.ocakYaricap ?? 150;
  if (!ocak) return out;
  // Plaka bazında: ocak-içi oranı + EN SON tarihli rotanın SON noktası (son bilinen GPS konumu).
  const byP = new Map<string, { top: number; ic: number; sonTarih: string; sonLat: number; sonLng: number }>();
  for (const row of guz) {
    const key = plakaNorm(row.plaka);
    let e = byP.get(key);
    if (!e) { e = { top: 0, ic: 0, sonTarih: "", sonLat: 0, sonLng: 0 }; byP.set(key, e); }
    const tarih = String(row.rapor_tarihi ?? "");
    for (const p of (row.noktalar ?? [])) {
      if (p.lat == null || p.lng == null) continue;
      e.top++;
      if (mesafeMetre(p.lat, p.lng, ocak.lat, ocak.lng) <= ocakR) e.ic++;
      if (tarih >= e.sonTarih) { e.sonTarih = tarih; e.sonLat = p.lat; e.sonLng = p.lng; } // en güncel rotanın son noktası
    }
  }
  for (const [key, e] of byP) {
    if (e.top > 0 && e.ic / e.top >= 0.5) out.set(key, { lat: e.sonLat, lng: e.sonLng, sonTarih: e.sonTarih });
  }
  return out;
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
