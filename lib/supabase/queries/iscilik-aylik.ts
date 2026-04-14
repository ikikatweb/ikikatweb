// İşçilik takibi aylık veri sorguları
import { createClient } from "@/lib/supabase/client";

function getSupabase() {
  return createClient();
}

export async function getAylikVeriler(iscilikTakibiId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("iscilik_aylik")
    .select("*")
    .eq("iscilik_takibi_id", iscilikTakibiId)
    .order("sira_no", { ascending: true });

  if (error) throw error;
  return data;
}

export async function createAylikVeri(
  iscilikTakibiId: string,
  siraNo: number,
  aitOlduguAy: string
) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("iscilik_aylik")
    .insert({
      iscilik_takibi_id: iscilikTakibiId,
      sira_no: siraNo,
      ait_oldugu_ay: aitOlduguAy,
      alt_yuklenici_tutar: 0,
      yuklenici_tutar: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateAylikVeri(
  id: string,
  updates: Record<string, unknown>
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("iscilik_aylik")
    .update(updates)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteAylikVeri(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("iscilik_aylik")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
