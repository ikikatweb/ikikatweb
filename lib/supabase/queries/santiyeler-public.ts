// SUNUCU TARAFI (service-role) — herkese açık ana sayfa (app/page.tsx) için İş Deneyim projelerini çeker.
// Yalnız PROJE ADI + KATEGORİ (is_grubu = "İş Tanımları") + tarih sinyalleri okunur (mali veri OKUNMAZ).
//
// Devam/Tamamlanan: GEÇİCİ KABUL TARİHİ doluysa TAMAMLANAN, boşsa DEVAM EDEN. Tasfiye HARİÇ.
// Kategori: santiyeler.is_grubu (tahmin YOK). Grup SIRASI: Tanımlamalar → "is_tanimlari" listesindeki sıra.
// Grup İÇİ sıra: en son biten iş üstte (geçici kabul / sözleşme tarihine göre azalan).
import { createClient } from "@supabase/supabase-js";

export type Proje = { ad: string; kategori: string; siraTarih: string | null };
export type ProjelerGruplu = { devam: Proje[]; tamamlanan: Proje[]; grupSirasi: string[] };

export async function getProjelerGruplu(): Promise<ProjelerGruplu> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { devam: [], tamamlanan: [], grupSirasi: [] };
  try {
    const sb = createClient(url, key);
    const baseSec = "is_adi, is_grubu, gecici_kabul_tarihi, sozlesme_tarihi, tasfiye_tarihi, sira_no";
    // ihaleli kolonu henüz eklenmemiş olabilir → varsa al, yoksa fallback (tümü ihaleli sayılır).
    const [projeIlk, grupRes] = await Promise.all([
      sb.from("santiyeler").select(baseSec + ", ihaleli").order("sira_no", { ascending: true }),
      sb.from("tanimlamalar").select("deger, sira").eq("kategori", "is_tanimlari").eq("aktif", true).order("sira", { ascending: true }),
    ]);
    const projeRes = projeIlk.error
      ? await sb.from("santiyeler").select(baseSec).order("sira_no", { ascending: true })
      : projeIlk;
    const grupSirasi = (grupRes.data ?? []).map((g) => (g as { deger: string }).deger).filter(Boolean);
    if (projeRes.error || !projeRes.data) return { devam: [], tamamlanan: [], grupSirasi };
    const devam: Proje[] = [];
    const tamamlanan: Proje[] = [];
    for (const r of projeRes.data as { is_adi: string | null; is_grubu: string | null; gecici_kabul_tarihi: string | null; sozlesme_tarihi: string | null; tasfiye_tarihi: string | null; ihaleli?: boolean | null }[]) {
      const ad = (r.is_adi ?? "").trim();
      if (!ad) continue;
      if (r.tasfiye_tarihi) continue;
      if (r.ihaleli === false) continue; // ihaleli olmayan iş → ana sayfa Projelerimiz'de gösterilmez
      const kategori = (r.is_grubu ?? "").trim() || "Diğer";
      const bitmis = r.gecici_kabul_tarihi && String(r.gecici_kabul_tarihi).trim() !== "";
      if (bitmis) tamamlanan.push({ ad, kategori, siraTarih: r.gecici_kabul_tarihi });
      else devam.push({ ad, kategori, siraTarih: r.sozlesme_tarihi ?? null });
    }
    return { devam, tamamlanan, grupSirasi };
  } catch {
    return { devam: [], tamamlanan: [], grupSirasi: [] };
  }
}
