// Yi-ÜFE sorguları - Endeks verilerinin CRUD işlemleri
import { createClient } from "@/lib/supabase/client";
import type { YiUfeInsert } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getYiUfeVerileri() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("yi_ufe")
    .select("*")
    .order("yil", { ascending: true })
    .order("ay", { ascending: true });

  if (error) throw error;
  return data;
}

export async function upsertYiUfe(veriler: YiUfeInsert[]) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("yi_ufe")
    .upsert(veriler, { onConflict: "yil,ay" })
    .select();

  if (error) throw error;
  return data;
}

// Tek bir Yi-ÜFE kaydını güncelle veya ekle
export async function upsertTekYiUfe(yil: number, ay: number, endeks: number) {
  const supabase = getSupabase();
  // Mevcut kayıt var mı?
  const { data: mevcut } = await supabase
    .from("yi_ufe")
    .select("id")
    .eq("yil", yil)
    .eq("ay", ay)
    .maybeSingle();

  if (mevcut) {
    const { error } = await supabase
      .from("yi_ufe")
      .update({ endeks })
      .eq("id", mevcut.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("yi_ufe")
      .insert({ yil, ay, endeks });
    if (error) throw error;
  }
}
