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

// Hız taşıyan nokta tipi. Omurga sayımında "transit" (asfaltta hızlı git-gel) geçişleri elemek için kullanılır.
type NoktaH = { lat: number; lng: number; hiz?: number | null };

// REGLAJ/SERME/SIKIŞTIRMA işi YAVAŞ yapılır (bıçak/silindir inik); bu hızın ÜSTÜ = transit (yola/asfalta
// gidiş-geliş) → omurga sayımına KATILMAZ. Greyder verisinde işin %96'sı ≤15 km/s, transit >20-45 km/s.
const HIZ_TRANSIT_ESIK = 20; // km/s

// Omurga çizgilerinin (parcalar) TOPLAM uzunluğu — KM. Bu, "haritada görünen tek çizginin uzunluğu":
// greyderin/silindirin aynı yolu git-gel taraması (tekrarlar) sayılmaz, yalnız yolun kendisi ölçülür.
// Kartlarda gösterilen "reglaj km" bununla hesaplanır (ham toplam_mesafe yerine).
export function parcalarUzunlukKm(parcalar: [number, number][][]): number {
  let metre = 0;
  for (const p of parcalar) {
    for (let i = 1; i < p.length; i++) {
      const cosL = Math.max(0.1, Math.cos(((p[i - 1][0] + p[i][0]) / 2) * Math.PI / 180));
      const dy = (p[i][0] - p[i - 1][0]) * METRE_DERECE;
      const dx = (p[i][1] - p[i - 1][1]) * METRE_DERECE * cosL;
      metre += Math.hypot(dx, dy);
    }
  }
  return metre / 1000;
}

// Rotayı SABİT ADIMLA (adimM) yol boyunca yeniden örnekler: her adimM metrede bir nokta üretir.
// Seyrek bölümleri SIKLAŞTIRIR **ve** yoğun bölümleri SEYRELTİR → sonuç GPS nokta yoğunluğundan
// BAĞIMSIZ olur. Böylece canlı (sık yoklama) ve rapor (seyrek export) rota AYNI omurgayı/reglajı verir;
// ayrıca yoğun jitter noktaları seyreltildiği için sahte "tekrar geçiş" şişmesi (ör. 900 m) ortadan kalkar.
// Çıktı yine yolun gerçek geometrisini izler (ara noktalar segment üzerinde interpolasyonla).
function sabitAdimOrnekle(pts: NoktaH[], adimM: number): NoktaH[] {
  if (pts.length < 2) return pts;
  const seg = (a: NoktaH, b: NoktaH) => {
    const cosL = Math.max(0.1, Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180));
    return Math.hypot((b.lat - a.lat) * METRE_DERECE, (b.lng - a.lng) * METRE_DERECE * cosL);
  };
  const out: NoktaH[] = [pts[0]];
  let acc = 0; // son üretilen noktadan bu yana biriken yol (m)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const segLen = seg(a, b);
    if (segLen === 0) continue;
    let next = adimM - acc; // segment başından itibaren ilk üretim mesafesi
    while (next <= segLen) {
      const t = next / segLen;
      // hızı da taşı (segment hızı, interpolasyon) → omurga sayımında transit (hızlı) geçişler elenebilsin
      const ha = a.hiz, hb = b.hiz;
      const hiz = (ha != null && hb != null) ? ha + (hb - ha) * t : (hb ?? ha ?? null);
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, hiz });
      next += adimM;
    }
    acc = segLen - (next - adimM); // segment sonundaki artık (bir sonraki segmente taşınır)
  }
  const last = pts[pts.length - 1], lo = out[out.length - 1];
  if (lo.lat !== last.lat || lo.lng !== last.lng) out.push(last); // bitiş noktasını koru
  return out;
}

// "Kapsanan yol" — aracın gün içinde DOKUNDUĞU benzersiz yol uzunluğu (KM). Yolu ~gridM ızgarasına
// oturtup, ardışık BENZERSİZ hücre kenarlarının uzunluklarını TEK kez toplar: aynı yolu git-gel taraması
// ve yan yana şeritler aynı hücrelere düştüğü için bir kez sayılır. Omurga (en uzun TEK yol) değil —
// BAĞLI olsalar bile TÜM yolların toplamıdır ("her yol bir çizgi, hepsinin toplamı"). Eşik=1 → kararlı.
export function kapsananYolKm(noktalar: { lat: number; lng: number }[], gridM = 12): number {
  const pts0 = noktalar.filter((p) => p.lat != null && p.lng != null);
  if (pts0.length < 2) return 0;
  const g = Math.max(1, gridM * 2);
  const pts = sabitAdimOrnekle(pts0, Math.max(2, g / 2));
  const ortLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cosOrt = Math.max(0.1, Math.cos((ortLat * Math.PI) / 180));
  const latStep = g / METRE_DERECE;
  const lngStep = g / (METRE_DERECE * cosOrt);
  const hucreKey = (p: { lat: number; lng: number }) => `${Math.round(p.lat / latStep)}_${Math.round(p.lng / lngStep)}`;
  const segKey = (k1: string, k2: string) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);
  // Hücre ortalama merkezleri (yan yana şeritlerin tam ortası)
  const merkezTopla = new Map<string, { lat: number; lng: number; n: number }>();
  for (const p of pts) {
    const key = hucreKey(p);
    const m = merkezTopla.get(key);
    if (m) { m.lat += p.lat; m.lng += p.lng; m.n += 1; } else merkezTopla.set(key, { lat: p.lat, lng: p.lng, n: 1 });
  }
  const merkez = (key: string): [number, number] => { const m = merkezTopla.get(key)!; return [m.lat / m.n, m.lng / m.n]; };
  // Ardışık hücreler arası BENZERSİZ kenarlar (git-gel/yan şerit tek sayılır)
  const benzersiz = new Set<string>();
  let onceki = hucreKey(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const simdi = hucreKey(pts[i]);
    if (simdi === onceki) continue;
    benzersiz.add(segKey(onceki, simdi));
    onceki = simdi;
  }
  let metre = 0;
  for (const k of benzersiz) {
    const [a, b] = k.split("|");
    const [la1, ln1] = merkez(a), [la2, ln2] = merkez(b);
    metre += Math.hypot((la2 - la1) * METRE_DERECE, (ln2 - ln1) * METRE_DERECE * cosOrt);
  }
  return metre / 1000;
}

// noktalar: zaman sırasına göre GPS noktaları.
// esik: bir grid kenarı EN AZ kaç kez geçilmişse AĞA dahil edilir (>= esik). Az geçilen sapmalar atılır.
// gridM: orta hattan sağa-sola YARIÇAP (m). Yan yana yakın şeritleri tek hatta toplar (hücre = 2×gridM).
// Çekirdek ≥eşik geçilen TÜM yol ağını (her kolu) çizer; hücre çapı (2×gridM) yan yana/git-gel şeritleri
// tek merkez hatta indirir. Koridoru elle genişletmek için "Yan Yana Çizgi Mesafesi" (gridM) artırılır.
export function sadelesGuzergah(
  noktalar: NoktaH[],
  esik: number,
  gridM = 12,
  hizEsik: number = HIZ_TRANSIT_ESIK,
): SadelesSonuc {
  return sadelesGuzergahCore(noktalar, esik, gridM, hizEsik);
}

function sadelesGuzergahCore(
  noktalar: NoktaH[],
  esik: number,
  gridM = 12,
  hizEsik: number = HIZ_TRANSIT_ESIK,
): SadelesSonuc {
  const bos: SadelesSonuc = { parcalar: [], gosterilenSegment: 0, toplamSegment: 0, maksGecis: 0 };
  const pts0 = noktalar.filter((p) => p.lat != null && p.lng != null);
  if (pts0.length < 2) return bos;
  const g = Math.max(1, gridM * 2); // hücre çapı = 2×yarıçap
  const pts = sabitAdimOrnekle(pts0, Math.max(2, g / 2));

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

  // Yönsüz kenar geçiş sayımı (ardışık hücreler arası). HIZ FİLTRESİ: geçiş HIZLI ise (hizEsik üstü =
  // asfalta/yola transit git-gel, reglaj işi değil) SAYMA. Hücre dizisi (onceki) yine ilerler ama o kenar
  // sayıma katılmaz → yalnız yavaş (işlenmiş) geçilen yollar eşiği aşıp omurgaya girer. hız yoksa (null) sayılır.
  const sayim = new Map<string, number>();
  let onceki = hucreKey(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const simdi = hucreKey(pts[i]);
    if (simdi === onceki) continue;
    const hizli = hizEsik > 0 && (pts[i].hiz ?? 0) > hizEsik;
    if (!hizli) sayim.set(segKey(onceki, simdi), (sayim.get(segKey(onceki, simdi)) ?? 0) + 1);
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

  // ── ≥eşik geçilen TÜM AĞI çiz (diameter/en-uzun-yol DEĞİL) → bir bölgedeki her yol kolu yakalanır
  // (eski yöntem yalnız en uzun kolu çiziyordu, yan kolları atıyordu). Kenarları polyline'lara dön: uç
  // (derece 1) / kavşak (derece ≥3) düğümlerinden başla, derece-2 zincirleri izle; kalan kapalı döngüler. ──
  const derece = (k: string) => komsu.get(k)?.size ?? 0;
  const kenarKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const kullanildi = new Set<string>();
  const parcalar: [number, number][][] = [];
  const izle = (bas: string) => {
    for (const ilk of (komsu.get(bas) ?? [])) {
      if (kullanildi.has(kenarKey(bas, ilk))) continue;
      const yol = [bas]; let onceki = bas, cur = ilk;
      kullanildi.add(kenarKey(onceki, cur)); yol.push(cur);
      while (derece(cur) === 2) {
        const next = [...(komsu.get(cur) ?? [])].find((n) => n !== onceki && !kullanildi.has(kenarKey(cur, n)));
        if (next === undefined) break;
        kullanildi.add(kenarKey(cur, next)); yol.push(next); onceki = cur; cur = next;
      }
      // yumuşat YOK: kısa zincirleri büzüp kapsamayı düşürüyordu; hücre merkezleri (merkez) zaten ortalanmış.
      if (yol.length >= 2) parcalar.push(yol.map(merkez));
    }
  };
  for (const k of komsu.keys()) { const d = derece(k); if (d === 1 || d >= 3) izle(k); } // uç + kavşak kolları
  for (const k of komsu.keys()) izle(k); // kalan kapalı döngüler (hepsi derece 2)

  // Çok kısa spur/gürültü parçalarını at (≤ ~1 hücre)
  const temiz = parcalar.filter((p) => p.length >= 2 && parcalarUzunlukKm([p]) > Math.max(0.012, (gridM * 1.2) / 1000));
  return { parcalar: temiz, gosterilenSegment: gosterilen, toplamSegment, maksGecis };
}
