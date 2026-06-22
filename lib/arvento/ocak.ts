// Stabilize ocağı (yükleme noktası) tespiti + damper sınıflama.
//
// Mantık: Kamyonlar ocağa gelip YÜKLER, sonra serme alanına gidip DAMPER İNDİRİR (gerçek damper).
// Ocağa uğramadan (yüklemeden) inen damper = ARIZA (sahada arıza nedeniyle kaldırılan/indirilen damper).
// "Mükerrer" ayrı bir kavram (aynı boşaltmanın art arda tetiklenmesi) ve bağımsız işaretlenir.

export type LatLng = { lat: number; lng: number };
type Nokta = { lat?: number | null; lng?: number | null; saat?: string | null };

// İki konum arası mesafe (metre) — küçük mesafeler için düz (equirectangular) yaklaşım yeterli.
export function mesafeMetre(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 111320;
  const cosL = Math.max(0.1, Math.cos(((lat1 + lat2) / 2) * Math.PI / 180));
  const dx = (lng2 - lng1) * R * cosL;
  const dy = (lat2 - lat1) * R;
  return Math.hypot(dx, dy);
}

// "HH:MM:SS" / "HH:MM" → gün içi saniye. Yoksa null.
export function saatSn(saat: string | null | undefined): number | null {
  if (!saat) return null;
  const p = saat.split(":").map((x) => parseInt(x, 10));
  if (p.length < 2 || p.some((n) => !Number.isFinite(n))) return null;
  return p[0] * 3600 + p[1] * 60 + (p[2] ?? 0);
}

// Rotadan İZOLE GPS çöp noktalarını ayıklar: zamana göre sıralı dizide HEM önceki HEM sonraki
// komşusundan da > esikKm uzak olan nokta = tek başına sapan hatalı GPS okuması (ör. 731 km öteye
// "ışınlanan" nokta). Yasal yayılımı (uzun yol; ardışık noktalar < ~2 km) korur. ≤2 nokta → dokunma.
export function rotaTemizle<T extends Nokta>(noktalar: T[], esikKm = 20): T[] {
  const idx = noktalar.map((p, i) => ({ p, i })).filter((x) => x.p.lat != null && x.p.lng != null);
  if (idx.length <= 2) return noktalar;
  const sirali = idx.map((x) => ({ ...x, sn: saatSn(x.p.saat) })).sort((a, b) => (a.sn ?? 0) - (b.sn ?? 0));
  const esikM = esikKm * 1000;
  const cop = new Set<T>();
  for (let k = 0; k < sirali.length; k++) {
    const o = sirali[k].p;
    const prev = k > 0 ? sirali[k - 1].p : null;
    const next = k < sirali.length - 1 ? sirali[k + 1].p : null;
    const dPrev = prev ? mesafeMetre(prev.lat as number, prev.lng as number, o.lat as number, o.lng as number) : Infinity;
    const dNext = next ? mesafeMetre(o.lat as number, o.lng as number, next.lat as number, next.lng as number) : Infinity;
    if (dPrev > esikM && dNext > esikM) cop.add(o); // iki komşusundan da çok uzak → izole çöp
  }
  if (cop.size === 0) return noktalar;
  return noktalar.filter((p) => !cop.has(p));
}

// Otomatik ocak tespiti: kamyon rotalarını ~gridM'lik hücrelere böler, EN ÇOK ARACIN uğradığı
// (eşitlikte en çok noktanın olduğu) hücrenin merkezini döndürür. Ocak, tüm kamyonların her
// turda uğradığı ortak noktadır → en yüksek "farklı araç" yoğunluğu oradadır. Başlangıç tahminidir;
// kullanıcı haritadan düzeltebilir. Veri yoksa null.
export function ocakTespit(rotalar: Nokta[][], gridM = 40): LatLng | null {
  let refLat = 0, n = 0;
  for (const r of rotalar) for (const p of r) if (p.lat != null) { refLat += p.lat; n++; }
  if (!n) return null;
  refLat /= n;
  const dLat = gridM / 111320;
  const dLng = gridM / (111320 * Math.max(0.1, Math.cos((refLat * Math.PI) / 180)));
  const hucre = new Map<string, { araclar: Set<number>; sayi: number; sumLat: number; sumLng: number }>();
  rotalar.forEach((r, ti) => {
    for (const p of r) {
      if (p.lat == null || p.lng == null) continue;
      const key = `${Math.round(p.lat / dLat)}_${Math.round(p.lng / dLng)}`;
      let c = hucre.get(key);
      if (!c) { c = { araclar: new Set(), sayi: 0, sumLat: 0, sumLng: 0 }; hucre.set(key, c); }
      c.araclar.add(ti); c.sayi++; c.sumLat += p.lat; c.sumLng += p.lng;
    }
  });
  let best: { sayi: number; sumLat: number; sumLng: number } | null = null;
  let bestScore = -1;
  for (const c of hucre.values()) {
    const score = c.araclar.size * 1_000_000 + c.sayi; // önce en çok ARAÇ, sonra en çok nokta
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best ? { lat: best.sumLat / best.sayi, lng: best.sumLng / best.sayi } : null;
}

// Bir kamyonun damper olaylarını ocak ziyaretine göre sınıflar. Her olaya iki bayrak ekler:
//  - ariza: O aralıkta rota VAR ama ocağa uğramamış → yüklemeden inmiş (KESİN arıza, gizlenir).
//  - dogrulanmamis: O aralıkta rota YOK (ör. sabah GPS başlamadan) → "gerçek" sayılır AMA doğrulanamadı.
//    (Arvento'dan tam gün rota çekilince doğrulanıp gerçek/arıza olarak kesinleşir.)
// Gerçek (doğrulanmış) = ne ariza ne dogrulanmamis. Mükerrer olaylar diziye girmez (zaten dışlanmış).
export function arizaIsaretle<T extends Nokta & { mukerrer?: boolean }>(
  olaylar: T[],
  rota: Nokta[],
  ocak: LatLng | null,
  yaricapM: number,
): (T & { ariza: boolean; dogrulanmamis: boolean })[] {
  if (!ocak || yaricapM <= 0) return olaylar.map((o) => ({ ...o, ariza: false, dogrulanmamis: false }));
  const rotaSn = rota
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ sn: saatSn(p.saat), lat: p.lat as number, lng: p.lng as number }))
    .filter((p): p is { sn: number; lat: number; lng: number } => p.sn != null)
    .sort((a, b) => a.sn - b.sn);
  const sirali = olaylar
    .map((o) => ({ o, sn: saatSn(o.saat) }))
    .sort((a, b) => (a.sn ?? 0) - (b.sn ?? 0));
  const arizaSet = new Set<T>();
  const dogrulanmamisSet = new Set<T>();
  let sonGercekSn = -1; // -1 → ilk pencere gün başından
  for (const { o, sn } of sirali) {
    if (o.mukerrer) continue;        // mükerrer zaten dışlandı
    if (sn == null) continue;        // zamansız olay → işaretleme (gerçek say)
    const altSn = sonGercekSn < 0 ? 0 : sonGercekSn;
    const pencere = rotaSn.filter((p) => p.sn > altSn && p.sn <= sn);
    if (pencere.length === 0) {
      // O aralıkta rota verisi YOK → ocağa uğrayıp uğramadığını doğrulayamıyoruz → gerçek say AMA
      // doğrulanmamış işaretle (Arvento tam-gün rotası çekilince kesinleşecek).
      dogrulanmamisSet.add(o);
      sonGercekSn = sn;
      continue;
    }
    const ugradi = pencere.some((p) => mesafeMetre(p.lat, p.lng, ocak.lat, ocak.lng) <= yaricapM);
    if (ugradi) sonGercekSn = sn;    // ocağa uğramış → gerçek (doğrulanmış)
    else arizaSet.add(o);            // rota var, ocağa uğramamış → KESİN arıza
  }
  return olaylar.map((o) => ({ ...o, ariza: arizaSet.has(o), dogrulanmamis: dogrulanmamisSet.has(o) }));
}
