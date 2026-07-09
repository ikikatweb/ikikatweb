// Plaka → SABİT araç rengi — TÜM sekmeler (Reglaj/Stabilize/Serme/Sıkıştırma/Tümü) için TEK merkez.
// Eskiden her bileşen kendi listesindeki SIRAYA göre renk atıyordu → aynı araç Reglaj'da camgöbeği,
// Stabilize'de mor görünebiliyordu. Burada atama oturum-boyu ortak kayıttan yapılır: bir plakaya renk
// bir kez verilir, hangi sekme sorarsa sorsun aynı döner ("008 = hep camgöbeği").
//
// Renk SEÇİMİ atanma sırasına göredir (hash DEĞİL): palet, ardışık girişler birbirinden EN UZAK ton
// olacak şekilde dizilmiştir → az araçta bile renkler net ayrılır (hash yönteminde komşu tonlar —
// kırmızı/gül, camgöbeği/gök — yan yana düşebiliyordu; kullanıcı "renkler birbirine çok yakın" dedi).

// Uydu görüntüsünde okunur parlak tonlar. SIRA ÖNEMLİ: her giriş, kendinden öncekilerden hue olarak
// olabildiğince uzak seçildi; benzer tonlar (gül≈kırmızı, gök≈mavi, menekşe≈mor) LİSTE SONUNA atıldı —
// onlara ancak 12+ araç aynı oturumda renk isterse sıra gelir.
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
const kullanilan = new Set<string>();         // verilmiş renkler (yeni plakaya kullanılmamışı seç)
if (typeof window !== "undefined") {
  try {
    const ham = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
    for (const [p, r] of Object.entries(ham)) {
      if (typeof r === "string" && /^#[0-9a-f]{6}$/i.test(r)) { atanan.set(p, r); kullanilan.add(r); }
    }
  } catch { /* bozuk kayıt → sıfırdan başla */ }
}
function kaydet() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(atanan))); } catch { /* dolu/kapalı → yoksay */ }
}

export function aracRengi(plaka: unknown): string {
  const p = norm(plaka);
  if (!p) return ARAC_RENK_PALETI[0];
  const ez = atanan.get(p);
  if (ez) return ez;
  // Önce hiç kullanılmamış en öndeki (en uzak) ton; palet doluysa sıra döngüsel devam eder.
  const renk = ARAC_RENK_PALETI.find((r) => !kullanilan.has(r)) ?? ARAC_RENK_PALETI[atanan.size % ARAC_RENK_PALETI.length];
  atanan.set(p, renk);
  kullanilan.add(renk);
  kaydet();
  return renk;
}
