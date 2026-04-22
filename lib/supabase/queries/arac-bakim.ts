// Araç bakım & tamirat sorguları
import { createClient } from "@/lib/supabase/client";
import type { AracBakim, AracBakimWithArac } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getAracBakimlar(): Promise<AracBakimWithArac[]> {
  const supabase = getSupabase();
  // Pagination ile 1000+ kayıt destekle — personel join ile yaptıran adı direkt gelir
  const PARCA = 1000;
  const tum: AracBakimWithArac[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("arac_bakim")
      .select("*, araclar(plaka, marka, model, guncel_gosterge, sayac_tipi, cinsi), personel:yaptiran_id(ad_soyad)")
      .order("bakim_tarihi", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + PARCA - 1);
    if (error) throw error;
    const parca = (data ?? []) as (AracBakimWithArac & { personel?: { ad_soyad: string } | null })[];
    tum.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  if (tum.length === 0) return tum;

  // İşlemi giriş yapan kullanıcı adını API üzerinden çöz (created_by)
  const kullaniciMap = new Map<string, string>();
  try {
    const res = await fetch("/api/kullanicilar/adlar");
    if (res.ok) {
      const adlar = (await res.json()) as { id: string; ad_soyad: string }[];
      for (const k of adlar) kullaniciMap.set(k.id, k.ad_soyad);
    }
  } catch { /* sessiz */ }

  return tum.map((b) => {
    const rec = b as AracBakimWithArac & { personel?: { ad_soyad: string } | null };
    return {
      ...rec,
      yaptiran_ad: rec.personel?.ad_soyad ?? rec.yaptiran_adi ?? null,
      isleme_giren_ad: rec.created_by ? kullaniciMap.get(rec.created_by) ?? null : null,
    } as AracBakimWithArac;
  });
}

export async function insertAracBakim(data: {
  arac_id: string;
  tip?: "bakim" | "tamirat";
  bakim_tarihi: string;
  yaptiran_id?: string | null;
  yaptiran_adi?: string | null;
  servis_tamirci?: string | null;
  tutar?: number | null;
  km?: number | null;
  detay?: string | null;
  sonraki_bakim_km?: number | null;
  sonraki_bakim_tarihi?: string | null;
  fatura_url?: string | null;
  fatura_urls?: string[] | null;
  is_foto_urls?: string[] | null;
  created_by?: string | null;
}): Promise<AracBakim> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("arac_bakim")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return row as AracBakim;
}

export async function updateAracBakim(
  id: string,
  updates: Partial<Omit<AracBakim, "id" | "created_at" | "updated_at">>,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_bakim")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAracBakim(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("arac_bakim").delete().eq("id", id);
  if (error) throw error;
}

export type BakimDosyaKategori = "fatura" | "is-foto";

export async function uploadBakimDosya(file: File, bakimId: string, kategori: BakimDosyaKategori = "fatura"): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const suffix = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const safeName = file.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40);
  const path = `${bakimId}/${kategori}/${suffix}-${safeName || "dosya"}.${ext}`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "arac-bakim");
  formData.append("path", path);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");
  return data.url;
}

// Birden fazla dosyayı sırayla yükler (kategorili), hepsinin URL'lerini döner
export async function uploadBakimDosyalar(files: File[], bakimId: string, kategori: BakimDosyaKategori = "fatura"): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    const u = await uploadBakimDosya(f, bakimId, kategori);
    urls.push(u);
  }
  return urls;
}
