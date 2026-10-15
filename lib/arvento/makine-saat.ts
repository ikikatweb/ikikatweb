// İŞ MAKİNESİ ÇALIŞMA SAATİ — projeksiyon.
//
// Arvento makineler için saat vermiyor; anlık `odometre` alanı KİLOMETRE. Saat bilgisi yalnız
// GÜNLÜK raporlarda var (arac_arvento_rapor.kontak_sn / rolanti_sn). Bu yüzden makinenin
// göstergesi son elle okumadan ileriye doğru yürütülür:
//
//   gösterge = son okuma + (okumadan beri kontak saati) × katsayı
//
// Katsayı makineye özel, çünkü kontak makinenin kendi sayacından fazla sayıyor: makine
// kontaktayken sayaç saymayabilir (yük yokken, rölantide). 15.10.2026 ölçümü:
// 34-00-15-13879 → 0,90 · 60-00-10-0011 → 0,77. Her yeni okumada yeniden hesaplanır.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Günlük raporun çalışma süresi — gunluk-metrik.ts'teki makineSn ile AYNI kural:
 *  max(kontak, rölanti), ilk→son kontak penceresiyle sınırlı. */
export function raporCalismaSn(r: {
  kontak_sn: number | null; rolanti_sn: number | null;
  ilk_kontak: string | null; son_kontak: string | null;
}): number {
  let c = Math.max(r.kontak_sn ?? 0, r.rolanti_sn ?? 0);
  const sn = (s: string | null) => {
    if (!s) return null;
    const [h, d, sa] = s.split(":").map(Number);
    return Number.isFinite(h) ? h * 3600 + (d || 0) * 60 + (sa || 0) : null;
  };
  const a = sn(r.ilk_kontak), b = sn(r.son_kontak);
  if (a != null && b != null && b - a > 0) c = Math.min(c, b - a);
  return c;
}

/** Bir plakanın verilen tarihten BUGÜNE kadar biriken kontak saati. */
export async function kontakSaati(
  sb: SupabaseClient,
  plaka: string,
  baslangicTarihi: string,   // "YYYY-MM-DD"
): Promise<{ saat: number; gun: number }> {
  const { data } = await sb
    .from("arac_arvento_rapor")
    .select("kontak_sn, rolanti_sn, ilk_kontak, son_kontak")
    .eq("plaka", plaka)
    .gte("rapor_tarihi", baslangicTarihi);
  const satirlar = (data ?? []) as Parameters<typeof raporCalismaSn>[0][];
  const sn = satirlar.reduce((t, r) => t + raporCalismaSn(r), 0);
  return { saat: sn / 3600, gun: satirlar.length };
}

/**
 * Yeni okumadan katsayı çıkarır: makinenin kendi sayacı ne kadar ilerlediyse,
 * aynı dönemde Arvento ne kadar kontak saydıysa oranı.
 *
 * Güvenlik payları: çok kısa dönem ya da çok az çalışma güvenilir oran vermez; böyle
 * durumlarda null döner ve ESKİ katsayı korunur (yanlış katsayı, katsayısızlıktan kötüdür).
 */
export function katsayiHesapla(
  oncekiOkuma: number | null,
  yeniOkuma: number,
  kontakSaat: number,
): number | null {
  if (oncekiOkuma == null) return null;
  const ilerleme = yeniOkuma - oncekiOkuma;
  if (ilerleme <= 0) return null;          // sayaç geri gitmiş / hiç çalışmamış
  if (kontakSaat < 5) return null;         // dönem çok kısa, oran gürültü olur
  const k = ilerleme / kontakSaat;
  if (k <= 0.2 || k > 1.5) return null;    // makul aralık dışı → okuma ya da eşleşme hatalı
  return Math.round(k * 1000) / 1000;
}

/** Projeksiyon: son okumadan beri çalışılan saati ekler. Katsayı yoksa 1 kabul edilir. */
export function projeksiyon(
  sonOkuma: number | null,
  kontakSaat: number,
  katsayi: number | null,
): number | null {
  if (sonOkuma == null) return null;
  return Math.round(sonOkuma + kontakSaat * (katsayi ?? 1));
}
