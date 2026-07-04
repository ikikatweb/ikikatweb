// İcra takibi sorguları — elle girilen icra dosyaları (paylaşımlı).
import { createClient } from "@/lib/supabase/client";
import type { IcraKayit } from "@/lib/supabase/types";

function sb() { return createClient(); }

export async function getIcraKayitlar(): Promise<IcraKayit[]> {
  const { data, error } = await sb()
    .from("icra").select("*")
    .order("sira", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as IcraKayit[];
}

export async function insertIcraKayit(row: Partial<IcraKayit>): Promise<IcraKayit> {
  const { data, error } = await sb().from("icra").insert(row).select().single();
  if (error) throw error;
  return data as IcraKayit;
}

export async function updateIcraKayit(id: string, patch: Partial<IcraKayit>): Promise<void> {
  const { error } = await sb().from("icra")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteIcraKayit(id: string): Promise<void> {
  const { error } = await sb().from("icra").delete().eq("id", id);
  if (error) throw error;
}
