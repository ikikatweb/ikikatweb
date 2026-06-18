// Güzergah sadeleştirme — OMURGA yöntemi.
// Greyder aynı yolu defalarca git-gel tarar; ham GPS izi sürekli ileri-geri gidip kendi
// üstüne biner. Bu yardımcı yolu küçük bir ızgaraya oturtup, "kaç kez geçildi"yi sayar ve
// çizgiyi greyderin ZAMAN sırasına göre değil, yolun bir ucundan diğer ucuna giden TEK
// omurga (en uzun yol) olarak çıkarır. Böylece git-gel zikzakı kalkar, yan yana şeritler
// orta hatta iner, az geçilen sapmalar (eşik altı) atılır.
//
// Reglaj / Stabilize / Serme / Sıkıştırma / Tümü haritaları aynı sadeleştirmeyi kullanır.

export type SadelesSonuc = {
  parcalar: [number, number][][]; // çizilecek omurga çizgileri (her bağlı bölge için bir omurga)
  gosterilenSegment: number;      // eşiği geçen (kullanılan) grid kenarı sayısı
  toplamSegment: number;          // benzersiz grid kenarı sayısı (tümü)
  maksGecis: number;              // en çok geçilen kenarın geçiş sayısı
};

const METRE_DERECE = 111320; // 1 derece ~ 111.32 km (yaklaşık)

// Bir parçayı (hareketli ortalama ile) yumuşatır.
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

// Seyrek GPS noktalarını ~adimM aralıkla yeniden örnekler (yan yana/tekrar geçişlerin aynı
// hücrelere düşmesi için).
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

// Dijkstra: bas düğümünden en uzak düğüm + önceki-düğüm haritası (yol geri izleme için).
function enUzak(bas: string, komsu: Map<string, Set<string>>, dist: (a: string, b: string) => number) {
  const d = new Map<string, number>([[bas, 0]]);
  const prev = new Map<string, string>();
  const pq: [number, string][] = [[0, bas]];
  while (pq.length) {
    pq.sort((x, y) => x[0] - y[0]);
    const [du, u] = pq.shift()!;
    if (du > (d.get(u) ?? Infinity)) continue;
    for (const v of komsu.get(u) ?? []) {
      const nd = du + dist(u, v);
      if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, u); pq.push([nd, v]); }
    }
  }
  let far = bas, fd = 0;
  for (const [n, dd] of d) if (dd > fd) { fd = dd; far = n; }
  return { far, prev };
}

// noktalar: zaman sırasına göre GPS noktaları.
// esik: bir grid kenarı EN AZ kaç kez geçilmişse omurgaya dahil edilir (>= esik). Az geçilen sapmalar atılır.
// gridM: orta hattan sağa-sola YARIÇAP (m). Yan yana yakın şeritleri tek hatta toplar (hücre = 2×gridM).
export function sadelesGuzergah(
  noktalar: { lat: number; lng: number }[],
  esik: number,
  gridM = 12,
): SadelesSonuc {
  const bos: SadelesSonuc = { parcalar: [], gosterilenSegment: 0, toplamSegment: 0, maksGecis: 0 };
  const pts0 = noktalar.filter((p) => p.lat != null && p.lng != null);
  if (pts0.length < 2) return bos;
  const g = Math.max(1, gridM * 2); // hücre çapı = 2×yarıçap
  const pts = yogunlastir(pts0, Math.max(2, g / 2));

  const ortLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cosOrt = Math.max(0.1, Math.cos((ortLat * Math.PI) / 180));
  const latStep = g / METRE_DERECE;
  const lngStep = g / (METRE_DERECE * cosOrt);
  const hucreKey = (p: { lat: number; lng: number }) => `${Math.round(p.lat / latStep)}_${Math.round(p.lng / lngStep)}`;
  const segKey = (k1: string, k2: string) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);

  // Hücre ORTALAMA merkezleri (yan yana şeritlerin tam ortası)
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

  // Yönsüz kenar geçiş sayımı (ardışık hücreler arası)
  const sayim = new Map<string, number>();
  let onceki = hucreKey(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const simdi = hucreKey(pts[i]);
    if (simdi === onceki) continue;
    sayim.set(segKey(onceki, simdi), (sayim.get(segKey(onceki, simdi)) ?? 0) + 1);
    onceki = simdi;
  }
  const toplamSegment = sayim.size;
  const maksGecis = Array.from(sayim.values()).reduce((m, v) => Math.max(m, v), 0);
  const alt = Math.max(1, esik);

  // Komşuluk grafiği — sadece eşiği geçen kenarlar (az geçilen sapmalar grafa girmez → silinir)
  const komsu = new Map<string, Set<string>>();
  const ekle = (a: string, b: string) => { if (!komsu.has(a)) komsu.set(a, new Set()); komsu.get(a)!.add(b); };
  let gosterilen = 0;
  for (const [k, cnt] of sayim) {
    if (cnt < alt) continue;
    gosterilen++;
    const [a, b] = k.split("|");
    ekle(a, b); ekle(b, a);
  }
  if (komsu.size === 0) return { parcalar: [], gosterilenSegment: 0, toplamSegment, maksGecis };

  const dist = (a: string, b: string) => {
    const [la1, ln1] = merkez(a), [la2, ln2] = merkez(b);
    return Math.hypot((la2 - la1) * METRE_DERECE, (ln2 - ln1) * METRE_DERECE * cosOrt);
  };

  // Her bağlı bölge için omurga (en uzun yol) çıkar
  const ziyaret = new Set<string>();
  const parcalar: [number, number][][] = [];
  for (const bas of komsu.keys()) {
    if (ziyaret.has(bas)) continue;
    // bileşeni topla (DFS)
    const bilesen: string[] = [];
    const yigin = [bas];
    ziyaret.add(bas);
    while (yigin.length) {
      const u = yigin.pop()!;
      bilesen.push(u);
      for (const v of komsu.get(u) ?? []) if (!ziyaret.has(v)) { ziyaret.add(v); yigin.push(v); }
    }
    if (bilesen.length < 3) continue; // çok küçük gürültü bölgesi → atla
    // Çift-Dijkstra ile diameter (yolun iki ucu) ve aralarındaki yol
    const u1 = enUzak(bilesen[0], komsu, dist).far;
    const r = enUzak(u1, komsu, dist);
    const u2 = r.far;
    const yol: string[] = [];
    let cur: string | undefined = u2;
    while (cur !== undefined) { yol.push(cur); cur = r.prev.get(cur); }
    if (yol.length > 1) parcalar.push(yumusat(yol.map(merkez)));
  }

  return { parcalar, gosterilenSegment: gosterilen, toplamSegment, maksGecis };
}
