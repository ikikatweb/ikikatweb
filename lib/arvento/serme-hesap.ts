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

// Damper hücre-tarih haritası: her hücreye (±1 komşu) o hücredeki EN ERKEN damper DATETIME. Aralık öncesi
// (oncekiDamper) + aralık içi (raporlar) birleşir. sermeAralikKm VE reglaj ayıklama AYNI haritayı kullanır
// → serme ile reglaj birbirini TAM tümler (bir nokta ya serme ya reglaj, ikisi birden değil).
export function damperHucreTarihHesapla(raporlar: AracArventoRapor[], oncekiDamper: OncekiDamper[]): Map<string, string> {
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
  return dht;
}

// Bir greyder noktası SERME mi? = o hücreye, bu geçişten (gecisDt) ÖNCE damper dökülmüşse serme (yoksa reglaj).
export function noktaSermeMi(dht: Map<string, string>, lat: number, lng: number, gecisDt: string): boolean {
  const ct = dht.get(sermeHucreKey(lat, lng));
  return ct != null && ct < gecisDt;
}

// REGLAJ AYIKLAMA: greyder rotalarından SERME noktalarını çıkarır → geriye YALNIZ reglaj (taze yol, önceden
// damper yok) kalır. Böylece bir yol hem serme hem reglaj sayılmaz. YALNIZ "reglaj" greyder satırlarına
// uygulanır; silindir vb. satırlara DOKUNULMAZ (sıkıştırma bozulmasın). Dashboard + Reglaj sekmesi bunu
// kullanır → ikisi de serme'yi reglajdan düşer, birbiriyle tutar.
export function reglajRotalariniAyikla(params: {
  guzergahRows: AracArventoGuzergah[];
  raporlar: AracArventoRapor[];
  oncekiDamper: OncekiDamper[];
  sekmeMap?: SekmeAtamaMap;
  atananSekmeler?: Set<ArventoSekme>;
}): AracArventoGuzergah[] {
  const { guzergahRows, raporlar, oncekiDamper, sekmeMap, atananSekmeler } = params;
  const dht = damperHucreTarihHesapla(raporlar, oncekiDamper);
  // Silindir (sıkıştırma) satırları hem serme hücresi üretmez hem de dokunulmaz (serme greyder işidir; sıkıştırma
  // bozulmasın). "reglaj" yerine "!sıkıştırma" geçidi: atama olmayan ama sekmede fallback ile görünen greyderler de
  // kapsanır (reglaj/serme aynı sınıf anahtarına sahip olduğundan "reglaj" geçidi bazı greyderleri atlıyordu).
  const silindirMi = (row: AracArventoGuzergah) => operasyondaGorunur(sekmeMap, atananSekmeler, row.arac_sinifi, "sikistirma", row.plaka);
  // 1) SERME HÜCRELERİ: bir greyder'in, o hücreye damper döküldükten SONRA geçtiği hücreler (serme = damper üstü geçiş).
  const sermeHucreler = new Set<string>();
  for (const row of guzergahRows) {
    if (silindirMi(row)) continue;
    const D = row.rapor_tarihi;
    for (const p of (row.noktalar ?? [])) {
      if (p?.lat == null || p?.lng == null) continue;
      if (noktaSermeMi(dht, p.lat, p.lng, `${D} ${p.saat ?? "23:59:59"}`)) sermeHucreler.add(sermeHucreKey(p.lat, p.lng));
    }
  }
  if (sermeHucreler.size === 0) return guzergahRows;
  // 2) YER-BAZLI ayıklama: serme yapılan hücrelerdeki TÜM greyder noktaları reglajdan çıkarılır (damper-ÖNCESİ
  // geçişler dahil) → "burası serme ise reglajda hiç görünmez". Silindir satırlarına dokunulmaz.
  return guzergahRows.map((row) => {
    if (silindirMi(row)) return row;
    const noktalar = (row.noktalar ?? []).filter((p) => {
      if (p?.lat == null || p?.lng == null) return true;
      return !sermeHucreler.has(sermeHucreKey(p.lat, p.lng));
    });
    return { ...row, noktalar };
  });
}

export function sermeAralikKm(params: {
  guzergahRows: AracArventoGuzergah[];               // HAM gün-bazlı greyder+silindir rotaları (birleştirilmemiş)
  raporlar: AracArventoRapor[];                      // aralık içi rapor (damper_olaylar)
  oncekiDamper: OncekiDamper[];                       // aralık ÖNCESİ damperler
  sekmeMap?: SekmeAtamaMap;
  atananSekmeler?: Set<ArventoSekme>;
  guzergahTekrar: number; gridMesafe: number; transitHiz: number; tekrarPencereSaat: number;
}): number {
  const { guzergahRows, raporlar, oncekiDamper, sekmeMap, atananSekmeler, guzergahTekrar, gridMesafe, transitHiz, tekrarPencereSaat } = params;
  // 1) damperHucreTarih: her hücreye o hücredeki EN ERKEN damper DATETIME (reglaj ayıklama ile ORTAK).
  const dht = damperHucreTarihHesapla(raporlar, oncekiDamper);
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
      if (noktaSermeMi(dht, p.lat, p.lng, `${D} ${p.saat ?? "23:59:59"}`)) g.pts.push({ lat: p.lat, lng: p.lng, hiz: p.hiz, ts: tsSaniye(D, p.saat) });
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
