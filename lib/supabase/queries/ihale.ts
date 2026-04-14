// İhale sorguları — sınır değer hesaplama
import { createClient } from "@/lib/supabase/client";
import type { Ihale, IhaleInsert, IhaleKatilimci, IhaleKatilimciInsert } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// --- İhale CRUD ---

export async function getIhaleler(): Promise<Ihale[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ihale")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Ihale[];
}

export async function getIhaleById(id: string): Promise<Ihale> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ihale")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Ihale;
}

export async function insertIhale(ihale: IhaleInsert): Promise<Ihale> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ihale")
    .insert(ihale)
    .select()
    .single();
  if (error) throw error;
  return data as Ihale;
}

export async function updateIhale(id: string, updates: Partial<IhaleInsert>): Promise<Ihale> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ihale")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Ihale;
}

export async function deleteIhale(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("ihale").delete().eq("id", id);
  if (error) throw error;
}

// --- Katılımcılar ---

export async function getKatilimcilar(ihaleId: string): Promise<IhaleKatilimci[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ihale_katilimci")
    .select("*")
    .eq("ihale_id", ihaleId)
    .order("sira", { ascending: true });
  if (error) throw error;
  return (data ?? []) as IhaleKatilimci[];
}

export async function insertKatilimcilar(
  ihaleId: string,
  katilimcilar: Omit<IhaleKatilimciInsert, "ihale_id">[]
): Promise<IhaleKatilimci[]> {
  const supabase = getSupabase();
  const rows = katilimcilar.map((k) => ({ ...k, ihale_id: ihaleId }));
  const { data, error } = await supabase
    .from("ihale_katilimci")
    .insert(rows)
    .select();
  if (error) throw error;
  return (data ?? []) as IhaleKatilimci[];
}

export async function deleteKatilimcilar(ihaleId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("ihale_katilimci")
    .delete()
    .eq("ihale_id", ihaleId);
  if (error) throw error;
}
