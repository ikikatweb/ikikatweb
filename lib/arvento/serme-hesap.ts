// SERME UZUNLUĞU (km) — Serme sekmesindeki (arvento-operasyon) algoritmayla BİREBİR. Serme = greyderin GÜN-GÜN
// rotasının, o hücreye O GEÇİŞTEN ÖNCE damper dökülmüş kısmı (reglaj = taze yol, önceden damper yok → serme değil).
// Dashboard sezon serme'si bunu kullanır → serme sekmesindeki toplamla tutar. (hesaplaGunlukMetrik'in basit
// "damper'e ≤80 m yakın omurga" serme'si sekmeyle tutmuyordu; bu hassas per-hücre zamansal yöntem odur.)
import { sadelesGuzergah, parcalarUzunlukKm, tsSaniye } from "@/lib/arvento/guzergah-sadelestir";
import { operasyondaGorunur, type SekmeAtamaMap, type ArventoSekme } from "@/lib/arvento/operasyonlar";
import { plakaNorm } from "@/lib/supabase/queries/arvento";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";

// Serme ızgarası: ~50 m sabit hücre (bölge ~41° enlem) — operasyon sekmesiyle AYNI.
const SERME_HUCRE_M = 50;
const SERME_LAT_STEP = SERME_HUCRE_M / 111320;
const SERME_LNG_STEP = SERME_HUCRE_M / (111320 * Math.cos((41 * Math.PI) / 180));
function sermeHucreIdx(lat: number, lng: number): [number, number] {
  return [Math.round(lat / SERME_LAT_STEP), Math.round(lng / SERME_LNG_STEP)];
}
function sermeHucreKey(lat: number, lng: number): string {
  const [y, x] = sermeHucreIdx(lat, lng);
  return `${y}_${x}`;
}

export type OncekiDamper = { lat: number; lng: number; dt: string };

export function sermeAralikKm(params: {
  guzergahRows: AracArventoGuzergah[];               // HAM gün-bazlı greyder+silindir rotaları (birleştirilmemiş)
  raporlar: AracArventoRapor[];                      // aralık içi rapor (damper_olaylar)
  oncekiDamper: OncekiDamper[];                       // aralık ÖNCESİ damperler
  sekmeMap?: SekmeAtamaMap;
  atananSekmeler?: Set<ArventoSekme>;
  guzergahTekrar: number; gridMesafe: number; transitHiz: number; tekrarPencereSaat: number;
}): number {
  const { guzergahRows, raporlar, oncekiDamper, sekmeMap, atananSekmeler, guzergahTekrar, gridMesafe, transitHiz, tekrarPencereSaat } = params;
  // 1) damperHucreTarih: her hücreye (±1 komşu) o hücredeki EN ERKEN damper DATETIME. Aralık öncesi + içi birleşir.
  const dht = new Map<string, string>();
  const ekle = (lat: number, lng: number, dt: string) => {
    const [cy, cx] = sermeHucreIdx(lat, lng);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const key = `${cy + dy}_${cx + dx}`;
      const mevcut = dht.get(key);
      if (mevcut == null || dt < mevcut) dht.set(key, dt);
    }
  };
  for (const d of oncekiDamper) ekle(d.lat, d.lng, d.dt);
  for (const r of raporlar) {
    for (const o of (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as { lat?: number | null; lng?: number | null; saat?: string | null }[]) {
      if (o?.lat == null || o?.lng == null) continue;
      ekle(o.lat, o.lng, `${r.rapor_tarihi} ${o.saat ?? "00:00:00"}`);
    }
  }
  // 2) Her serme greyderinin, geçişten ÖNCE damper dökülmüş hücrelere denk gelen noktaları → plaka bazında topla.
  const byP = new Map<string, { pts: { lat: number; lng: number; hiz?: number | null; ts?: number | null }[] }>();
  for (const row of guzergahRows) {
    if (!operasyondaGorunur(sekmeMap, atananSekmeler, row.arac_sinifi, "serme", row.plaka)) continue;
    const pk = plakaNorm(row.plaka);
    let g = byP.get(pk);
    if (!g) { g = { pts: [] }; byP.set(pk, g); }
    const D = row.rapor_tarihi;
    for (const p of (row.noktalar ?? [])) {
      if (p?.lat == null || p?.lng == null) continue;
      const ct = dht.get(sermeHucreKey(p.lat, p.lng));
      const gecisDt = `${D} ${p.saat ?? "23:59:59"}`;
      if (ct != null && ct < gecisDt) g.pts.push({ lat: p.lat, lng: p.lng, hiz: p.hiz, ts: tsSaniye(D, p.saat) });
    }
  }
  // 3) Plaka başına omurga (tekrar + pencere) uzunluklarının toplamı (km).
  let km = 0;
  for (const g of byP.values()) {
    if (g.pts.length < 2) continue;
    km += parcalarUzunlukKm(sadelesGuzergah(g.pts, guzergahTekrar, gridMesafe, transitHiz, tekrarPencereSaat * 3600).parcalar);
  }
  return km;
}
