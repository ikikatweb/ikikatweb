// Firma ve iş tanımları için önceden tanımlı renk paleti
// Kullanıcı bu paletten seçim yapar, serbest renk girişi yapılmaz

export type PaletRengi = {
  hex: string;
  ad: string;
  // Açık (yumuşak) tonu — arka plan için kullanılır, koyu tonu ise kenar çizgisi/metin için
  bg: string;
};

export const RENK_PALETI: PaletRengi[] = [
  // Lacivert / mavi tonları
  { hex: "#1E3A5F", ad: "Lacivert", bg: "#E1E7F1" },
  { hex: "#1E40AF", ad: "Koyu Mavi", bg: "#DBEAFE" },
  { hex: "#2563EB", ad: "Mavi", bg: "#DBEAFE" },
  { hex: "#3B82F6", ad: "Açık Mavi", bg: "#EFF6FF" },
  { hex: "#60A5FA", ad: "Gök Mavisi", bg: "#EFF6FF" },
  { hex: "#0891B2", ad: "Turkuaz", bg: "#CFFAFE" },
  { hex: "#06B6D4", ad: "Açık Turkuaz", bg: "#ECFEFF" },
  { hex: "#0F766E", ad: "Petrol", bg: "#CCFBF1" },
  { hex: "#14B8A6", ad: "Zümrüt", bg: "#CCFBF1" },
  // Yeşil tonları
  { hex: "#059669", ad: "Yeşil", bg: "#D1FAE5" },
  { hex: "#10B981", ad: "Açık Yeşil", bg: "#D1FAE5" },
  { hex: "#16A34A", ad: "Çim", bg: "#DCFCE7" },
  { hex: "#65A30D", ad: "Fıstık", bg: "#ECFCCB" },
  { hex: "#84CC16", ad: "Limon", bg: "#ECFCCB" },
  // Sarı / turuncu tonları
  { hex: "#CA8A04", ad: "Sarı", bg: "#FEF9C3" },
  { hex: "#EAB308", ad: "Açık Sarı", bg: "#FEF9C3" },
  { hex: "#F59E0B", ad: "Amber", bg: "#FEF3C7" },
  { hex: "#F97316", ad: "Koyu Turuncu", bg: "#FFEDD5" },
  { hex: "#EA580C", ad: "Turuncu", bg: "#FFEDD5" },
  { hex: "#FB923C", ad: "Açık Turuncu", bg: "#FFF7ED" },
  // Kırmızı / pembe tonları
  { hex: "#DC2626", ad: "Kırmızı", bg: "#FEE2E2" },
  { hex: "#EF4444", ad: "Açık Kırmızı", bg: "#FEE2E2" },
  { hex: "#B91C1C", ad: "Bordo", bg: "#FEE2E2" },
  { hex: "#DB2777", ad: "Pembe", bg: "#FCE7F3" },
  { hex: "#EC4899", ad: "Açık Pembe", bg: "#FCE7F3" },
  { hex: "#F472B6", ad: "Tozpembe", bg: "#FDF2F8" },
  // Mor tonları
  { hex: "#9333EA", ad: "Mor", bg: "#F3E8FF" },
  { hex: "#A855F7", ad: "Açık Mor", bg: "#FAF5FF" },
  { hex: "#7C3AED", ad: "Menekşe", bg: "#EDE9FE" },
  { hex: "#6366F1", ad: "İndigo", bg: "#E0E7FF" },
  // Kahve / nötr tonlar
  { hex: "#78350F", ad: "Koyu Kahve", bg: "#FEF3C7" },
  { hex: "#92400E", ad: "Kahve", bg: "#FEF3C7" },
  { hex: "#A16207", ad: "Hardal", bg: "#FEF9C3" },
  { hex: "#64748B", ad: "Gri", bg: "#F1F5F9" },
  { hex: "#4B5563", ad: "Koyu Gri", bg: "#E5E7EB" },
  { hex: "#334155", ad: "Çelik", bg: "#F1F5F9" },
  { hex: "#000000", ad: "Siyah", bg: "#E5E7EB" },
];

export function paletGetBg(hex: string | null | undefined): string {
  if (!hex) return "#F1F5F9";
  const found = RENK_PALETI.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
  return found?.bg ?? "#F1F5F9";
}
