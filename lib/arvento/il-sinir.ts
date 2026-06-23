// İL SINIRI bazlı izin çekirdeği.
// - İl sınırları: /tr-iller.json (FeatureCollection; properties.name = il adı, geometry Polygon/MultiPolygon).
// - Bir noktanın (lat,lng) hangi ilde olduğunu nokta-poligon (ray casting) ile bulur.
// - Şantiye adından il çıkarımı (ör. "Samsun Vezirköprü…" → Samsun) + alternatif yazım alias'ları.
// GeoJSON koordinatları [lng, lat] sırasındadır.

type Halka = number[][];        // [ [lng,lat], ... ]
type Poligon = Halka[];         // [dışHalka, delik1, delik2, ...]
export type IlPoligon = {
  ad: string;
  poligonlar: Poligon[];        // MultiPolygon → birden çok; Polygon → tek
  minLat: number; maxLat: number; minLng: number; maxLng: number;
};

type GeoJson = { features: { properties: { name: string }; geometry: { type: string; coordinates: unknown } }[] };

// FeatureCollection → IlPoligon[] (bbox ile birlikte).
export function illeriYukle(geo: GeoJson): IlPoligon[] {
  const out: IlPoligon[] = [];
  for (const f of geo.features ?? []) {
    const ad = f.properties?.name;
    if (!ad) continue;
    const poligonlar: Poligon[] = f.geometry.type === "MultiPolygon"
      ? (f.geometry.coordinates as Poligon[])
      : [f.geometry.coordinates as Poligon];
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const pol of poligonlar) for (const [lng, lat] of pol[0] ?? []) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    }
    out.push({ ad, poligonlar, minLat, maxLat, minLng, maxLng });
  }
  return out;
}

// Nokta bir halkanın içinde mi — ray casting (lng=x, lat=y).
function halkaIcinde(lng: number, lat: number, halka: Halka): boolean {
  let ic = false;
  for (let i = 0, j = halka.length - 1; i < halka.length; j = i++) {
    const xi = halka[i][0], yi = halka[i][1], xj = halka[j][0], yj = halka[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) ic = !ic;
  }
  return ic;
}

// Nokta il sınırı içinde mi (bbox ön-eleme + dış halka içinde & deliklerde değil).
export function noktaIlinde(lat: number, lng: number, il: IlPoligon): boolean {
  if (lat < il.minLat || lat > il.maxLat || lng < il.minLng || lng > il.maxLng) return false;
  for (const pol of il.poligonlar) {
    if (!pol.length) continue;
    if (!halkaIcinde(lng, lat, pol[0])) continue;      // dış halka içinde değil → bu poligon değil
    let delikte = false;
    for (let h = 1; h < pol.length; h++) if (halkaIcinde(lng, lat, pol[h])) { delikte = true; break; }
    if (!delikte) return true;
  }
  return false;
}

// Nokta verilen iller arasında hangisinde (yoksa null). İlk eşleşeni döndürür.
export function noktaHangiIl(lat: number, lng: number, iller: IlPoligon[]): string | null {
  for (const il of iller) if (noktaIlinde(lat, lng, il)) return il.ad;
  return null;
}

// Nokta, izinli illerden HERHANGİ birinde mi?
export function noktaIzinli(lat: number, lng: number, izinliIller: IlPoligon[]): boolean {
  for (const il of izinliIller) if (noktaIlinde(lat, lng, il)) return true;
  return false;
}

// Verilen noktalardan EN AZ BİRİ izinli illerde mi? (seyreltme ile hızlı — rota/KML için)
export function herhangiIzinli(noktalar: { lat: number | null; lng: number | null }[], izinliIller: IlPoligon[]): boolean {
  const n = noktalar.length;
  if (!n || !izinliIller.length) return false;
  const adim = Math.max(1, Math.floor(n / 120)); // en çok ~120 nokta test et
  for (let i = 0; i < n; i += adim) {
    const p = noktalar[i];
    if (p && p.lat != null && p.lng != null && noktaIzinli(p.lat, p.lng, izinliIller)) return true;
  }
  return false;
}

// ── İl adı normalizasyonu + şantiye adından il çıkarımı ───────────────────────
// Alternatif yazımlar → tr-iller.json'daki resmi ad.
const ALIAS: Record<string, string> = {
  afyonkarahisar: "Afyon", icel: "Mersin", urfa: "Şanlıurfa", antep: "Gaziantep",
  maras: "Kahramanmaraş", kmaras: "Kahramanmaraş", hakkâri: "Hakkari",
};

export function ilNormalize(s: string): string {
  return (s || "").toLocaleLowerCase("tr").replace(/i̇/g, "i").replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" } as Record<string, string>)[c] || c).replace(/[^a-z]/g, "");
}

// Şantiye adında geçen İLK il adını döndür (kelime bazında, 81 il + alias). Yoksa null.
export function adtanIl(isAdi: string, ilAdlari: string[]): string | null {
  const ilNorm = new Map<string, string>();        // normalize → resmi ad
  for (const ad of ilAdlari) ilNorm.set(ilNormalize(ad), ad);
  for (const [k, v] of Object.entries(ALIAS)) ilNorm.set(ilNormalize(k), v);
  for (const kelime of (isAdi || "").split(/[\s,./-]+/)) {
    const n = ilNormalize(kelime);
    if (n && ilNorm.has(n)) return ilNorm.get(n)!;
  }
  return null;
}
