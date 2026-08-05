// SERME UZUNLUĞU (km) — Serme sekmesindeki (arvento-operasyon) algoritmayla BİREBİR. Serme = greyderin GÜN-GÜN
// rotasının, o hücreye O GEÇİŞTEN ÖNCE damper dökülmüş kısmı (reglaj = taze yol, önceden damper yok → serme değil).
// Dashboard sezon serme'si bunu kullanır → serme sekmesindeki toplamla tutar. (hesaplaGunlukMetrik'in basit
// "damper'e ≤80 m yakın omurga" serme'si sekmeyle tutmuyordu; bu hassas per-hücre zamansal yöntem odur.)
import { sadelesGuzergah, parcalarUzunlukKm, tsSaniye, kumulMesafe, noktaPolylineIzdusum, polylineDilim, METRE_DERECE } from "@/lib/arvento/guzergah-sadelestir";
import { operasyondaGorunur, type SekmeAtamaMap, type ArventoSekme } from "@/lib/arvento/operasyonlar";
import { plakaNorm } from "@/lib/supabase/queries/arvento";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import type { HaritaGeometri } from "@/lib/arvento/kml-parse";

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

// ── KML YOL-TABANLI SÜREKLİ SERME KAPLAMASI ───────────────────────────────────────────
// Serme TANIMI değişmez (hangi noktaların serme olduğu = noktaSermeMi). Değişen: serme
// noktalarını KML yol çizgisine izdüşürüp boşlukları köprüleyerek yol boyunca SÜREKLİ kaplı
// uzunluğu GEOMETRİDEN ölçmek. KML'e yakın olmayan noktalar eski omurga yöntemine düşer.
export type KmlYolHat = { noktalar: [number, number][]; kumulM: number[]; toplamM: number; bbox: [number, number, number, number] };
export type SermeGeoAyar = {
  guzergahTekrar: number; gridMesafe: number; transitHiz: number; tekrarPencereSaat: number; // fallback (eski yöntem)
  koprulukM: number;    // boşluk köprüleme mesafesi (m) — Arvento seyrek verisindeki delikler bu kadar köprülenir
  yolYakinlikM: number; // yola dik max mesafe (m) — bu içindeki serme noktası "o yola ait" sayılır
};
export type SermeGeoSonuc = { parcalar: [number, number][][]; km: number };
export type SermePt = { lat: number; lng: number; hiz?: number | null; ts?: number | null };

export const SERME_KOPRULUK_M = 55;    // öneri varsayılan (SERME_HUCRE_M=50 ile uyumlu)
export const SERME_YOL_YAKINLIK_M = 18; // öneri varsayılan (yol eni toleransı)

// KML katman satırlarından serme izdüşümü için yol çizgilerini hazırlar. tip="cizgi" polyline'lar
// alınır; çok kısa/degenerate atılır; BİREBİR/örtüşen kopyalar (aynı yolun iki kez kaydı veya
// çift kenar) tek en-uzun temsilciye indirilir → uzunluk çift sayılmaz. adKey KULLANILMAZ (ad biçimi
// tutarsız: kimi "YOL_100", kimi "OL_129=341.58"); dedup GEOMETRİK örtüşmeye göre yapılır.
export function kmlYollariHazirla<T extends { geometriler: unknown; gorunur?: boolean | null }>(
  katmanlar: T[], izinli?: (k: T) => boolean,
): KmlYolHat[] {
  const aday: KmlYolHat[] = [];
  for (const k of katmanlar) {
    if (!k.gorunur) continue; // haritadaki çizim (ekleKayitliKatmanlar) ile birebir: gizli katman ölçülmez
    if (izinli && !izinli(k)) continue;
    const geos = Array.isArray(k.geometriler) ? (k.geometriler as HaritaGeometri[]) : [];
    for (const g of geos) {
      if (g?.tip !== "cizgi" || !Array.isArray(g.noktalar) || g.noktalar.length < 2) continue;
      const noktalar = g.noktalar.filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && p[0] != null && p[1] != null);
      if (noktalar.length < 2) continue;
      const kumulM = kumulMesafe(noktalar);
      const toplamM = kumulM[kumulM.length - 1];
      if (toplamM < 5) continue; // degenerate (tek noktaya çökmüş / çok kısa)
      let minLa = Infinity, maxLa = -Infinity, minLn = Infinity, maxLn = -Infinity;
      for (const [la, ln] of noktalar) { if (la < minLa) minLa = la; if (la > maxLa) maxLa = la; if (ln < minLn) minLn = ln; if (ln > maxLn) maxLn = ln; }
      aday.push({ noktalar, kumulM, toplamM, bbox: [minLa, maxLa, minLn, maxLn] });
    }
  }
  // Dedup: yalnız BİREBİR KOPYA (aynı yolun iki kez kaydı) elenir → uzunluk çift sayılmaz. Yoğun ağda
  // FARKLI ama yakın/kesişen yolları birleştirmemek için mekânsal "bant" birleştirme YAPILMAZ; asıl çift
  // sayım koruması "her serme noktasını yalnız EN YAKIN tek yola atama"dır (sermeGeometri) — bu veride
  // paralel çift kenar yok (kopyalar 0m üst üste ya da uç uca bağlı parça). İmza: yuvarlanmış koordinat dizisi.
  const imza = (n: [number, number][]) => n.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
  const gorulen = new Set<string>();
  const tut: KmlYolHat[] = [];
  for (const c of aday) {
    const s = imza(c.noktalar);
    const sr = imza([...c.noktalar].reverse()); // ters yönde kaydedilmiş aynı çizgi de kopyadır
    if (gorulen.has(s) || gorulen.has(sr)) continue;
    gorulen.add(s);
    tut.push(c);
  }
  return tut;
}

// TEK plakanın serme noktaları → KML yollarına izdüşümlü SÜREKLİ kaplama (parça geometrisi + km).
// KML'e yakın olmayan noktalar eski omurga yöntemine (sadelesGuzergah+parcalarUzunlukKm) düşer.
// Sekme çizimi ve dashboard ölçümü İKİSİ de bunu çağırır → birebir tutar.
export function sermeGeometri(sermePts: SermePt[], yollar: KmlYolHat[], ayar: SermeGeoAyar): SermeGeoSonuc {
  const parcalar: [number, number][][] = [];
  let km = 0;
  const chainByYol = new Map<number, number[]>();
  const fallback: SermePt[] = [];
  // Her nokta → en yakın yol (dik ≤ yolYakinlikM). bbox ön-elemesi ile hızlı.
  const latBand = ayar.yolYakinlikM / METRE_DERECE;
  for (const p of sermePts) {
    if (p.lat == null || p.lng == null) continue;
    const cosL = Math.max(0.1, Math.cos((p.lat * Math.PI) / 180));
    const lngBand = ayar.yolYakinlikM / (METRE_DERECE * cosL);
    let enDik = Infinity, enYol = -1, enChain = 0;
    for (let yi = 0; yi < yollar.length; yi++) {
      const y = yollar[yi];
      if (p.lat < y.bbox[0] - latBand || p.lat > y.bbox[1] + latBand || p.lng < y.bbox[2] - lngBand || p.lng > y.bbox[3] + lngBand) continue;
      const { dikM, chainM } = noktaPolylineIzdusum(p.lat, p.lng, y.noktalar, y.kumulM);
      if (dikM < enDik) { enDik = dikM; enYol = yi; enChain = chainM; }
    }
    if (enYol >= 0 && enDik <= ayar.yolYakinlikM) {
      let arr = chainByYol.get(enYol); if (!arr) { arr = []; chainByYol.set(enYol, arr); }
      arr.push(enChain);
    } else fallback.push(p);
  }
  // Her yol için chainage'leri sırala → boşlukları köprüle → kaplı aralık(lar) → geometriden uzunluk + dilim.
  for (const [yi, chains] of chainByYol) {
    const y = yollar[yi];
    chains.sort((a, b) => a - b);
    let c0 = chains[0], onceki = chains[0];
    const kapat = (a: number, b: number) => {
      const aa = Math.max(0, a), bb = Math.min(y.toplamM, b);
      if (bb - aa < 1) return; // izole tek nokta / çok kısa → çizgi değil
      km += (bb - aa) / 1000;
      parcalar.push(polylineDilim(y.noktalar, y.kumulM, aa, bb));
    };
    for (let i = 1; i < chains.length; i++) {
      if (chains[i] - onceki > ayar.koprulukM) { kapat(c0, onceki); c0 = chains[i]; }
      onceki = chains[i];
    }
    kapat(c0, onceki);
  }
  // KML'e düşmeyen noktalar → eski omurga yöntemi (regresyon güvencesi: KML yoksa tümü buraya düşer).
  if (fallback.length >= 2) {
    const fp = sadelesGuzergah(fallback, ayar.guzergahTekrar, ayar.gridMesafe, ayar.transitHiz, ayar.tekrarPencereSaat * 3600).parcalar;
    for (const seg of fp) parcalar.push(seg);
    km += parcalarUzunlukKm(fp);
  }
  return { parcalar, km };
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
  yollar?: KmlYolHat[];                          // KML yol hatları (yoksa/boşsa tümü eski omurga yöntemine düşer)
  koprulukM?: number; yolYakinlikM?: number;     // KML izdüşüm toleransları
}): number {
  const { guzergahRows, raporlar, oncekiDamper, sekmeMap, atananSekmeler, guzergahTekrar, gridMesafe, transitHiz, tekrarPencereSaat } = params;
  const yollar = params.yollar ?? [];
  const ayar: SermeGeoAyar = {
    guzergahTekrar, gridMesafe, transitHiz, tekrarPencereSaat,
    koprulukM: params.koprulukM ?? SERME_KOPRULUK_M, yolYakinlikM: params.yolYakinlikM ?? SERME_YOL_YAKINLIK_M,
  };
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
  // 3) Plaka başına KML yol-tabanlı sürekli kaplama (KML yoksa eski omurga yöntemine düşer) → km topla.
  let km = 0;
  for (const g of byP.values()) {
    if (g.pts.length < 2) continue;
    km += sermeGeometri(g.pts, yollar, ayar).km;
  }
  return km;
}
