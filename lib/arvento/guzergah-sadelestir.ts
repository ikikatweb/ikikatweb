// Güzergah sadeleştirme — az geçilen sapmaları gizleyip çok geçilen ana hattı bırakır.
// Greyder gibi araçlar reglaj yaparken aynı hattı defalarca tarar. Bu yardımcı yolu küçük
// bir ızgaraya (grid) oturtup her parçanın kaç kez geçildiğini SAYAR; çizimi ise GERÇEK GPS
// koordinatlarıyla yapar (grid sadece sayım için — köşeli grid hattı çizilmez). Eşiği geçen
// (>= esik) bölgeler gerçek hattıyla çizilir, altındakiler atlanır (boş kalır).
//
// Reglaj / Stabilize / Serme / Sıkıştırma haritaları aynı sadeleştirmeyi kullanır.

export type SadelesSonuc = {
  parcalar: [number, number][][]; // çizilecek GERÇEK hat parçaları (eşiği geçenler; kopuk olabilir)
  gosterilenSegment: number;      // eşiği geçen benzersiz grid segmenti sayısı
  toplamSegment: number;          // benzersiz grid segmenti sayısı (tümü)
  maksGecis: number;              // en çok geçilen segmentin geçiş sayısı
};

const METRE_DERECE = 111320; // 1 derece ~ 111.32 km (yaklaşık)

// Seyrek GPS noktalarını ~adimM aralıkla yeniden örnekler (ardışık noktalar arasına ara
// noktalar ekler). Mesafe Bilgisi noktaları çok seyrek olabilir (yüzlerce m); yoğunlaştırmazsak
// aynı yoldan farklı zamanlardaki geçişler farklı ızgara hücrelerine düşer, tekrar sayılamaz.
// Bir parçayı (hareketli ortalama ile) yumuşatır — merkez hattının köşeliliğini giderir.
function yumusat(parca: [number, number][], pencere = 2): [number, number][] {
  if (parca.length <= 2) return parca;
  const out: [number, number][] = [];
  for (let i = 0; i < parca.length; i++) {
    let sl = 0, sg = 0, c = 0;
    for (let j = Math.max(0, i - pencere); j <= Math.min(parca.length - 1, i + pencere); j++) { sl += parca[j][0]; sg += parca[j][1]; c++; }
    out.push([sl / c, sg / c]);
  }
  return out;
}

function yogunlastir(pts: { lat: number; lng: number }[], adimM: number): { lat: number; lng: number }[] {
  if (pts.length < 2) return pts;
  const out: { lat: number; lng: number }[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const cosL = Math.max(0.1, Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180));
    const dx = (b.lng - a.lng) * METRE_DERECE * cosL;
    const dy = (b.lat - a.lat) * METRE_DERECE;
    const n = Math.min(2000, Math.max(1, Math.round(Math.hypot(dx, dy) / adimM)));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  return out;
}

// noktalar: zaman sırasına göre GPS noktaları.
// esik: bir yol parçası EN AZ kaç kez geçilmişse çizilir (>= esik). esik<=1 → tüm geçilen yol.
// gridM: ızgara çözünürlüğü / "yan yana çizgi mesafesi" (m) — bu mesafeden yakın geçişler aynı sayılır.
export function sadelesGuzergah(
  noktalar: { lat: number; lng: number }[],
  esik: number,
  gridM = 12,
  kopruM = 30,
): SadelesSonuc {
  const bos: SadelesSonuc = { parcalar: [], gosterilenSegment: 0, toplamSegment: 0, maksGecis: 0 };
  const pts0 = noktalar.filter((p) => p.lat != null && p.lng != null);
  if (pts0.length < 2) return bos;
  // gridM = orta hattan sağa-sola YARIÇAP; ızgara hücresi = 2×yarıçap (toplam bant genişliği)
  const g = Math.max(1, gridM * 2);
  const adim = Math.max(2, g / 2);
  const pts = yogunlastir(pts0, adim);

  const ortLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cosOrt = Math.max(0.1, Math.cos((ortLat * Math.PI) / 180));
  const latStep = g / METRE_DERECE;
  const lngStep = g / (METRE_DERECE * cosOrt);
  // iki nokta arası yaklaşık mesafe (m)
  const mesafeM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.hypot((b.lat - a.lat) * METRE_DERECE, (b.lng - a.lng) * METRE_DERECE * cosOrt);
  const hucreKey = (p: { lat: number; lng: number }) => `${Math.round(p.lat / latStep)}_${Math.round(p.lng / lngStep)}`;

  // 1) Yönsüz segment geçiş sayımı (grid hücreleri arası)
  const sayim = new Map<string, number>();
  const segKey = (k1: string, k2: string) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);
  let onceki = hucreKey(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const simdi = hucreKey(pts[i]);
    if (simdi === onceki) continue;
    const k = segKey(onceki, simdi);
    sayim.set(k, (sayim.get(k) ?? 0) + 1);
    onceki = simdi;
  }
  const toplamSegment = sayim.size;
  const maksGecis = Array.from(sayim.values()).reduce((m, v) => Math.max(m, v), 0);
  const alt = Math.max(1, esik);

  // 1b) Hücre ORTALAMA merkezleri — bir hücreye düşen tüm yan yana şeritlerin tam ortası.
  //     Çizimde bu merkez kullanılır → yan yana N çizgi TEK orta hatta iner (üst üste değil).
  const merkezTopla = new Map<string, { lat: number; lng: number; n: number }>();
  for (const p of pts) {
    const key = hucreKey(p);
    const m = merkezTopla.get(key);
    if (m) { m.lat += p.lat; m.lng += p.lng; m.n += 1; }
    else merkezTopla.set(key, { lat: p.lat, lng: p.lng, n: 1 });
  }
  const merkez = (key: string): [number, number] => {
    const m = merkezTopla.get(key)!;
    return [m.lat / m.n, m.lng / m.n];
  };

  // 2) Hattı gez; eşiği geçen ardışık hücrelerin ORTA noktalarını biriktir. Ana hat
  //    boyunca eşik-altı delikleri kopruM'den kısaysa KÖPRÜLE (gidiş-geliş tek hatta insin);
  //    uzun sapmalarda parçayı böl. Sonra parça yumuşatılır → tek pürüzsüz orta çizgi.
  const parcalar: [number, number][][] = [];
  const gosterilen = new Set<string>();
  let cur: [number, number][] = [];
  let bosMesafe = 0;
  let prevKey = hucreKey(pts[0]);
  const bitir = () => { if (cur.length > 1) parcalar.push(yumusat(cur)); cur = []; bosMesafe = 0; };
  for (let i = 1; i < pts.length; i++) {
    const curKey = hucreKey(pts[i]);
    if (curKey === prevKey) continue; // aynı hücre içinde ilerleme yok
    const k = segKey(prevKey, curKey);
    if ((sayim.get(k) ?? 0) >= alt) {
      gosterilen.add(k);
      if (cur.length === 0) cur.push(merkez(prevKey));
      cur.push(merkez(curKey));
      bosMesafe = 0;
    } else if (cur.length > 0 && bosMesafe < kopruM) {
      bosMesafe += mesafeM(pts[i - 1], pts[i]); // kısa delik → köprüle
      cur.push(merkez(curKey));
    } else {
      bitir(); // uzun sapma / hat dışı → parçayı kapat
    }
    prevKey = curKey;
  }
  bitir();

  return { parcalar, gosterilenSegment: gosterilen.size, toplamSegment, maksGecis };
}
