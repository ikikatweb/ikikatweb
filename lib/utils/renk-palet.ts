// Firma ve iş tanımları için önceden tanımlı renk paleti
// Kullanıcı bu paletten seçim yapar, serbest renk girişi yapılmaz

export type PaletRengi = {
  hex: string;
  ad: string;
  // Açık (yumuşak) tonu — arka plan için kullanılır, koyu tonu ise kenar çizgisi/metin için
  bg: string;
};

export const RENK_PALETI: PaletRengi[] = [
  // ===== LACİVERT / MAVİ TONLARI =====
  { hex: "#0C1E3F", ad: "Gece Mavisi", bg: "#D6DCE6" },
  { hex: "#152D4A", ad: "Derin Lacivert", bg: "#D8DEE8" },
  { hex: "#1E3A5F", ad: "Lacivert", bg: "#E1E7F1" },
  { hex: "#1E3A8A", ad: "Kraliyet Lacivert", bg: "#DBEAFE" },
  { hex: "#1E40AF", ad: "Koyu Mavi", bg: "#DBEAFE" },
  { hex: "#2563EB", ad: "Mavi", bg: "#DBEAFE" },
  { hex: "#3B82F6", ad: "Açık Mavi", bg: "#EFF6FF" },
  { hex: "#60A5FA", ad: "Gök Mavisi", bg: "#EFF6FF" },
  { hex: "#93C5FD", ad: "Bebek Mavisi", bg: "#EFF6FF" },
  { hex: "#0284C7", ad: "Okyanus", bg: "#E0F2FE" },
  { hex: "#0EA5E9", ad: "Deniz Mavisi", bg: "#E0F2FE" },
  { hex: "#38BDF8", ad: "Buz Mavi", bg: "#F0F9FF" },
  // ===== TURKUAZ / PETROL =====
  { hex: "#164E63", ad: "Koyu Petrol", bg: "#CFFAFE" },
  { hex: "#0E7490", ad: "Petrol", bg: "#CFFAFE" },
  { hex: "#0891B2", ad: "Turkuaz", bg: "#CFFAFE" },
  { hex: "#06B6D4", ad: "Açık Turkuaz", bg: "#ECFEFF" },
  { hex: "#22D3EE", ad: "Camgöbeği", bg: "#ECFEFF" },
  { hex: "#0F766E", ad: "Koyu Teal", bg: "#CCFBF1" },
  { hex: "#14B8A6", ad: "Zümrüt", bg: "#CCFBF1" },
  { hex: "#2DD4BF", ad: "Mint", bg: "#F0FDFA" },
  // ===== YEŞİL TONLARI =====
  { hex: "#064E3B", ad: "Orman Yeşili", bg: "#D1FAE5" },
  { hex: "#047857", ad: "Koyu Yeşil", bg: "#D1FAE5" },
  { hex: "#059669", ad: "Yeşil", bg: "#D1FAE5" },
  { hex: "#10B981", ad: "Açık Yeşil", bg: "#D1FAE5" },
  { hex: "#34D399", ad: "Tatlı Yeşil", bg: "#ECFDF5" },
  { hex: "#166534", ad: "Koyu Çim", bg: "#DCFCE7" },
  { hex: "#16A34A", ad: "Çim", bg: "#DCFCE7" },
  { hex: "#22C55E", ad: "Açık Çim", bg: "#DCFCE7" },
  { hex: "#4D7C0F", ad: "Koyu Fıstık", bg: "#ECFCCB" },
  { hex: "#65A30D", ad: "Fıstık", bg: "#ECFCCB" },
  { hex: "#84CC16", ad: "Limon", bg: "#ECFCCB" },
  { hex: "#A3E635", ad: "Açık Limon", bg: "#F7FEE7" },
  // ===== SARI / AMBER =====
  { hex: "#713F12", ad: "Koyu Hardal", bg: "#FEF3C7" },
  { hex: "#A16207", ad: "Hardal", bg: "#FEF9C3" },
  { hex: "#CA8A04", ad: "Sarı", bg: "#FEF9C3" },
  { hex: "#EAB308", ad: "Açık Sarı", bg: "#FEF9C3" },
  { hex: "#FACC15", ad: "Altın Sarısı", bg: "#FEF9C3" },
  { hex: "#FDE047", ad: "Limon Sarısı", bg: "#FEFCE8" },
  { hex: "#B45309", ad: "Koyu Amber", bg: "#FEF3C7" },
  { hex: "#D97706", ad: "Koyu Turuncu", bg: "#FEF3C7" },
  { hex: "#F59E0B", ad: "Amber", bg: "#FEF3C7" },
  // ===== TURUNCU TONLARI =====
  { hex: "#9A3412", ad: "Kiremit", bg: "#FFEDD5" },
  { hex: "#C2410C", ad: "Bakır", bg: "#FFEDD5" },
  { hex: "#EA580C", ad: "Turuncu", bg: "#FFEDD5" },
  { hex: "#F97316", ad: "Parlak Turuncu", bg: "#FFEDD5" },
  { hex: "#FB923C", ad: "Açık Turuncu", bg: "#FFF7ED" },
  { hex: "#FDBA74", ad: "Şeftali", bg: "#FFF7ED" },
  // ===== KIRMIZI / BORDO =====
  { hex: "#450A0A", ad: "Maroon", bg: "#FEE2E2" },
  { hex: "#7F1D1D", ad: "Koyu Bordo", bg: "#FEE2E2" },
  { hex: "#991B1B", ad: "Bordo", bg: "#FEE2E2" },
  { hex: "#B91C1C", ad: "Şarap", bg: "#FEE2E2" },
  { hex: "#DC2626", ad: "Kırmızı", bg: "#FEE2E2" },
  { hex: "#EF4444", ad: "Açık Kırmızı", bg: "#FEE2E2" },
  { hex: "#F87171", ad: "Pastel Kırmızı", bg: "#FEF2F2" },
  // ===== PEMBE / FUŞYA =====
  { hex: "#831843", ad: "Mor-Kırmızı", bg: "#FCE7F3" },
  { hex: "#9D174D", ad: "Koyu Fuşya", bg: "#FCE7F3" },
  { hex: "#BE185D", ad: "Fuşya", bg: "#FCE7F3" },
  { hex: "#DB2777", ad: "Pembe", bg: "#FCE7F3" },
  { hex: "#EC4899", ad: "Açık Pembe", bg: "#FCE7F3" },
  { hex: "#F472B6", ad: "Tozpembe", bg: "#FDF2F8" },
  { hex: "#F9A8D4", ad: "Pastel Pembe", bg: "#FDF2F8" },
  // ===== MOR / MENEKŞE =====
  { hex: "#3B0764", ad: "Koyu Erguvan", bg: "#F3E8FF" },
  { hex: "#581C87", ad: "Erguvan", bg: "#F3E8FF" },
  { hex: "#6B21A8", ad: "Koyu Mor", bg: "#F3E8FF" },
  { hex: "#7E22CE", ad: "Koyu Menekşe", bg: "#F3E8FF" },
  { hex: "#9333EA", ad: "Mor", bg: "#F3E8FF" },
  { hex: "#A855F7", ad: "Açık Mor", bg: "#FAF5FF" },
  { hex: "#C084FC", ad: "Lila", bg: "#FAF5FF" },
  { hex: "#5B21B6", ad: "Koyu Ametist", bg: "#EDE9FE" },
  { hex: "#7C3AED", ad: "Menekşe", bg: "#EDE9FE" },
  { hex: "#8B5CF6", ad: "Açık Menekşe", bg: "#EDE9FE" },
  { hex: "#A78BFA", ad: "Leylak", bg: "#F5F3FF" },
  // ===== İNDİGO =====
  { hex: "#312E81", ad: "Koyu İndigo", bg: "#E0E7FF" },
  { hex: "#3730A3", ad: "İndigo", bg: "#E0E7FF" },
  { hex: "#4F46E5", ad: "Parlak İndigo", bg: "#E0E7FF" },
  { hex: "#6366F1", ad: "Açık İndigo", bg: "#E0E7FF" },
  { hex: "#818CF8", ad: "Pastel İndigo", bg: "#EEF2FF" },
  // ===== KAHVE / TABA =====
  { hex: "#451A03", ad: "Koyu Çikolata", bg: "#FEF3C7" },
  { hex: "#78350F", ad: "Çikolata", bg: "#FEF3C7" },
  { hex: "#92400E", ad: "Kahve", bg: "#FEF3C7" },
  { hex: "#A16207", ad: "Açık Kahve", bg: "#FEF9C3" },
  { hex: "#854D0E", ad: "Taba", bg: "#FEF9C3" },
  // ===== NÖTR TONLAR =====
  { hex: "#0F172A", ad: "Antrasit", bg: "#F1F5F9" },
  { hex: "#1E293B", ad: "Karbon", bg: "#F1F5F9" },
  { hex: "#334155", ad: "Çelik", bg: "#F1F5F9" },
  { hex: "#475569", ad: "Beton", bg: "#E2E8F0" },
  { hex: "#4B5563", ad: "Koyu Gri", bg: "#E5E7EB" },
  { hex: "#64748B", ad: "Gri", bg: "#F1F5F9" },
  { hex: "#6B7280", ad: "Orta Gri", bg: "#F3F4F6" },
  { hex: "#9CA3AF", ad: "Açık Gri", bg: "#F9FAFB" },
  { hex: "#000000", ad: "Siyah", bg: "#E5E7EB" },
];

// Hex rengi pastel (açık) tonuna çevir — RGB'yi beyaza doğru %85 karıştırır
function pastelOlustur(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#F1F5F9";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  // %85 beyaz + %15 orijinal renk → yumuşak pastel
  const pr = Math.round(r * 0.15 + 255 * 0.85);
  const pg = Math.round(g * 0.15 + 255 * 0.85);
  const pb = Math.round(b * 0.15 + 255 * 0.85);
  const p = (n: number) => n.toString(16).padStart(2, "0");
  return `#${p(pr)}${p(pg)}${p(pb)}`;
}

export function paletGetBg(hex: string | null | undefined): string {
  if (!hex) return "#F1F5F9";
  const found = RENK_PALETI.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
  if (found) return found.bg;
  // Palette'te yoksa otomatik pastel üret — canlıda kayıtlı eski hex değerleri için güvenli fallback
  return pastelOlustur(hex);
}
