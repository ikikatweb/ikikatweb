// Plaka → SABİT araç rengi — TÜM sekmeler (Reglaj/Stabilize/Serme/Sıkıştırma/Tümü) için TEK merkez.
// Eskiden her bileşen kendi listesindeki SIRAYA göre renk atıyordu → aynı araç Reglaj'da camgöbeği,
// Stabilize'de mor görünebiliyordu. Burada atama oturum-boyu ortak kayıttan yapılır: bir plakaya renk
// bir kez verilir, hangi sekme sorarsa sorsun aynı döner ("008 = hep camgöbeği").
//
// Renk SEÇİMİ atanma sırasına göredir (hash DEĞİL): palet, ardışık girişler birbirinden EN UZAK ton
// olacak şekilde dizilmiştir → az araçta bile renkler net ayrılır (hash yönteminde komşu tonlar —
// kırmızı/gül, camgöbeği/gök — yan yana düşebiliyordu; kullanıcı "renkler birbirine çok yakın" dedi).
//
// ÇAKIŞMA SORUNU (çözüldü): Araç sayısı palet boyunu aşınca eski yedek formül (sıra % palet) daha önce
// VERİLMİŞ renkleri tekrar dağıtıyordu ve bu localStorage'a kalıcı yazılıyordu → bazı bilgisayarlarda
// Reglaj/Serme'deki iki greyder aynı renge düşüyordu. Artık: (1) palet 24 renk, (2) palet tükenince EN AZ
// KULLANILAN renk seçilir, (3) aracRenkSecici() ile AYNI EKRANDA görünen araçların renkleri birbirinden
// farklı olacak şekilde onarılır (onarım kalıcı kaydedilir → sekmeler arası tutarlılık korunur).

// Uydu görüntüsünde okunur parlak tonlar. SIRA ÖNEMLİ: her giriş, kendinden öncekilerden hue olarak
// olabildiğince uzak seçildi; benzer tonlar (gül≈kırmızı, gök≈mavi, menekşe≈mor) LİSTE SONUNA atıldı —
// onlara ancak 12+ araç aynı oturumda renk isterse sıra gelir. Son 8 giriş: aynı hue'ların KOYU tonları
// (parlak eşlerinden açıklık farkıyla ayrılır) — yalnız 16 araç aşılınca devreye girer.
export const ARAC_RENK_PALETI = [
  "#ef4444", // kırmızı      (0°)
  "#3b82f6", // mavi         (217°)
  "#22c55e", // yeşil        (142°)
  "#f59e0b", // amber        (38°)
  "#a855f7", // mor          (271°)
  "#06b6d4", // camgöbeği    (188°)
  "#ec4899", // pembe        (330°)
  "#84cc16", // fıstık yeşili (82°)
  "#f97316", // turuncu      (25°)
  "#14b8a6", // turkuaz      (172°)
  "#d946ef", // fuşya        (292°)
  "#eab308", // sarı         (45°)
  "#0ea5e9", // gök          (199°) — maviye yakın, sona
  "#10b981", // zümrüt       (160°) — yeşile yakın, sona
  "#f43f5e", // gül          (350°) — kırmızıya yakın, sona
  "#8b5cf6", // menekşe      (258°) — mora yakın, sona
  "#be123c", // koyu kızıl   (350° koyu)
  "#1d4ed8", // koyu mavi    (224° koyu)
  "#15803d", // koyu yeşil   (142° koyu)
  "#c2410c", // kiremit      (21° koyu)
  "#7e22ce", // koyu mor     (272° koyu)
  "#0f766e", // koyu turkuaz (175° koyu)
  "#a21caf", // koyu fuşya   (295° koyu)
  "#4d7c0f", // zeytin       (85° koyu)
] as const;

// Plaka normalizasyonu — queries/arvento.ts plakaNorm ile AYNI kural ("60 BP 842" = "60BP842").
// Buraya kopyalandı ki bu modül Supabase istemcisine bağımlılık çekmesin.
function norm(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// KALICI kayıt: plaka→renk ataması localStorage'da saklanır → sayfa yenilense / başka gün açılsa da
// aynı araç HEP aynı renk (kullanıcı renge alışıyor, değişmesin). Yeni plaka geldiğinde henüz
// KULLANILMAMIŞ en öndeki (en uzak) ton verilir ve o da kalıcı kaydedilir.
const STORAGE_KEY = "aracRenkAtama";
const atanan = new Map<string, string>();     // normPlaka → renk (tüm sekmeler ortak)
if (typeof window !== "undefined") {
  try {
    const ham = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
    for (const [p, r] of Object.entries(ham)) {
      if (typeof r === "string" && /^#[0-9a-f]{6}$/i.test(r)) atanan.set(p, r);
    }
  } catch { /* bozuk kayıt → sıfırdan başla */ }
}
function kaydet() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(atanan))); } catch { /* dolu/kapalı → yoksay */ }
}

// Renk → kaç araca verildi (paletin tükendiği durumda EN AZ kullanılanı seçmek için).
function kullanimSayaci(): Map<string, number> {
  const m = new Map<string, number>(ARAC_RENK_PALETI.map((r) => [r, 0]));
  for (const r of atanan.values()) m.set(r, (m.get(r) ?? 0) + 1);
  return m;
}

// Bir plakaya YENİ renk seç: önce hiç kullanılmamış (palet sırasıyla en uzak) ton; palet tükenmişse
// EN AZ kullanılan ton (eski "sıra % palet" formülü kullanılmış renkleri körlemesine tekrar veriyordu).
// hariç: bu seçimde kullanılmaması gereken renkler (aynı ekranda zaten görünenler).
function yeniRenkSec(haric?: Set<string>): string {
  const sayac = kullanimSayaci();
  let enIyi: string = ARAC_RENK_PALETI[0];
  let enIyiSkor = Infinity;
  for (const r of ARAC_RENK_PALETI) {
    if (haric?.has(r)) continue;
    const skor = sayac.get(r) ?? 0;
    if (skor < enIyiSkor) { enIyi = r; enIyiSkor = skor; if (skor === 0) break; } // hiç kullanılmamış → hemen al
  }
  return enIyi;
}

export function aracRengi(plaka: unknown): string {
  const p = norm(plaka);
  if (!p) return ARAC_RENK_PALETI[0];
  const ez = atanan.get(p);
  if (ez) return ez;
  const renk = yeniRenkSec();
  atanan.set(p, renk);
  kaydet();
  return renk;
}

// AYNI EKRANDA gösterilecek araçlar için renk seçici üretir: verilen listedeki hiçbir iki araç
// aynı rengi almaz (palet yettiği sürece). Çakışan araç, o listede kullanılmayan bir renge kaydırılır
// ve bu KALICI yazılır → sekmeler arası tutarlılık bozulmaz, düzeltme kalıcı olur.
// Liste dışı bir plaka sorulursa (ör. canlı konum) normal kalıcı renge düşer.
export function aracRenkSecici(plakalar: Iterable<unknown>): (plaka: unknown) => string {
  const gorunen: string[] = [];
  const gorulen = new Set<string>();
  for (const pl of plakalar) {
    const p = norm(pl);
    if (!p || gorulen.has(p)) continue;
    gorulen.add(p);
    gorunen.push(p);
  }
  const kullanilanBuEkranda = new Set<string>();
  let degisti = false;
  for (const p of gorunen) {
    let renk = atanan.get(p);
    if (!renk) {
      renk = yeniRenkSec(kullanilanBuEkranda);
      atanan.set(p, renk);
      degisti = true;
    } else if (kullanilanBuEkranda.has(renk) && kullanilanBuEkranda.size < ARAC_RENK_PALETI.length) {
      // ÇAKIŞMA: bu ekranda aynı renk zaten var → boşta olan bir renge kaydır (kalıcı)
      renk = yeniRenkSec(kullanilanBuEkranda);
      atanan.set(p, renk);
      degisti = true;
    }
    kullanilanBuEkranda.add(renk);
  }
  if (degisti) kaydet();
  return (plaka: unknown) => {
    const p = norm(plaka);
    if (!p) return ARAC_RENK_PALETI[0];
    return atanan.get(p) ?? aracRengi(p);
  };
}
