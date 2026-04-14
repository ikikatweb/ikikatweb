// Şantiye CRUD sorguları - Proje/iş yönetimi işlemleri
import { createClient } from "@/lib/supabase/client";
import type { SantiyeInsert, SantiyeUpdate, SantiyeOrtagi, SantiyeIsGrubu } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getSantiyeler() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("*, firmalar(firma_adi, sira_no)")
    .order("sira_no", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getSantiyelerBasic() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("id, is_adi, durum")
    .eq("durum", "aktif")
    .order("is_adi", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getSantiyelerAll() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("id, is_adi, durum, gecici_kabul_tarihi, tasfiye_tarihi, devir_tarihi")
    .order("is_adi", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getSantiyeById(id: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("*, firmalar(firma_adi, sira_no)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function createSantiye(santiye: SantiyeInsert) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .insert(santiye)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSantiye(id: string, santiye: SantiyeUpdate) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .update({ ...santiye, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function toggleSantiyeDurum(id: string, durum: "aktif" | "tamamlandi" | "tasfiye") {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("santiyeler")
    .update({ durum, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export async function uploadSantiyeFile(
  file: File,
  santiyeId: string,
  type: "gecici_kabul" | "kesin_kabul" | "is_deneyim"
) {
  const ext = file.name.split(".").pop();
  const filePath = `${santiyeId}/${type}.${ext}`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "santiyeler");
  formData.append("path", filePath);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");

  return data.url;
}

// Ortak girişim ortakları
// Tüm şantiyelerin ortaklarını getir (liste sayfası için)
export async function getTumOrtaklar(): Promise<(SantiyeOrtagi & { firmalar?: { firma_adi: string } })[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_ortaklari")
    .select("*, firmalar(firma_adi, sira_no)");
  if (error) throw error;
  return (data ?? []) as (SantiyeOrtagi & { firmalar?: { firma_adi: string } })[];
}

export async function getOrtaklar(santiyeId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_ortaklari")
    .select("*, firmalar(firma_adi, sira_no)")
    .eq("santiye_id", santiyeId)
    .order("is_pilot", { ascending: false });

  if (error) throw error;
  return data;
}

export async function saveOrtaklar(
  santiyeId: string,
  ortaklar: { firma_id: string; oran: number; is_pilot: boolean }[]
) {
  const supabase = getSupabase();

  // Mevcut ortakları sil
  await supabase.from("santiye_ortaklari").delete().eq("santiye_id", santiyeId);

  if (ortaklar.length === 0) return;

  // Yenilerini ekle
  const rows = ortaklar.map((o) => ({ ...o, santiye_id: santiyeId }));
  const { error } = await supabase.from("santiye_ortaklari").insert(rows);

  if (error) throw error;
}

// ==================== İŞ GRUBU DAĞILIMI ====================

export async function getTumSantiyeIsGruplari(): Promise<SantiyeIsGrubu[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_is_gruplari")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SantiyeIsGrubu[];
}

export async function getSantiyeIsGruplari(santiyeId: string): Promise<SantiyeIsGrubu[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_is_gruplari")
    .select("*")
    .eq("santiye_id", santiyeId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SantiyeIsGrubu[];
}

export async function saveSantiyeIsGruplari(
  santiyeId: string,
  rows: { is_grubu: string; tutar: number }[],
): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("santiye_is_gruplari").delete().eq("santiye_id", santiyeId);
  if (rows.length === 0) return;
  const insertRows = rows.map((r) => ({ santiye_id: santiyeId, ...r }));
  const { error } = await supabase.from("santiye_is_gruplari").insert(insertRows);
  if (error) throw error;
}
