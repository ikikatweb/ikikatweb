// ŞİRKETE AÇILAN icra takipleri — sorgular (paylaşımlı tablo).
//
// public.icra ile karıştırılmasın: orada şirket ÜÇÜNCÜ ŞAHIS (işveren), burada BORÇLU.
// Ayrı tablo olmasının gerekçesi sql/icra_sirket_takip.sql başında yazılı.
import { createClient } from "@/lib/supabase/client";
import type { IcraSirketTakip } from "@/lib/supabase/types";

function sb() { return createClient(); }

export async function getIcraSirketTakipler(): Promise<IcraSirketTakip[]> {
  const { data, error } = await sb()
    .from("icra_sirket_takip").select("*")
    .order("teblig_tarihi", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as IcraSirketTakip[];
}

export async function insertIcraSirketTakip(row: Partial<IcraSirketTakip>): Promise<IcraSirketTakip> {
  const { data, error } = await sb().from("icra_sirket_takip").insert(row).select().single();
  if (error) throw error;
  return data as IcraSirketTakip;
}

export async function updateIcraSirketTakip(id: string, patch: Partial<IcraSirketTakip>): Promise<void> {
  const { error } = await sb().from("icra_sirket_takip")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteIcraSirketTakip(id: string): Promise<void> {
  const { error } = await sb().from("icra_sirket_takip").delete().eq("id", id);
  if (error) throw error;
}
