// Ödeme Planı sorguları — elle girilen ileriye dönük nakit planı (paylaşımlı).
// İki tablo: satırlar (tarih/açıklama/gider/gelir) + yan kasa listesi (etiket/tutar).
import { createClient } from "@/lib/supabase/client";
import type { OdemePlaniSatir, OdemePlaniKasa } from "@/lib/supabase/types";

function sb() { return createClient(); }

// ---------- Satırlar ----------
export async function getOdemePlaniSatirlar(): Promise<OdemePlaniSatir[]> {
  const { data, error } = await sb()
    .from("odeme_plani_satir").select("*")
    .order("tarih", { ascending: true }).order("sira", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OdemePlaniSatir[];
}

export async function insertOdemePlaniSatir(row: {
  tarih: string; aciklama: string | null; gider: number; gelir: number; sira: number;
}): Promise<OdemePlaniSatir> {
  const { data, error } = await sb().from("odeme_plani_satir").insert(row).select().single();
  if (error) throw error;
  return data as OdemePlaniSatir;
}

export async function updateOdemePlaniSatir(id: string, patch: Partial<{
  tarih: string; aciklama: string | null; gider: number; gelir: number; sira: number;
}>): Promise<void> {
  const { error } = await sb().from("odeme_plani_satir")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteOdemePlaniSatir(id: string): Promise<void> {
  const { error } = await sb().from("odeme_plani_satir").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Yan kasa listesi ----------
export async function getOdemePlaniKasa(): Promise<OdemePlaniKasa[]> {
  const { data, error } = await sb()
    .from("odeme_plani_kasa").select("*").order("sira", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OdemePlaniKasa[];
}

export async function insertOdemePlaniKasa(row: {
  etiket: string | null; tutar: number; sira: number;
}): Promise<OdemePlaniKasa> {
  const { data, error } = await sb().from("odeme_plani_kasa").insert(row).select().single();
  if (error) throw error;
  return data as OdemePlaniKasa;
}

export async function updateOdemePlaniKasa(id: string, patch: Partial<{
  etiket: string | null; tutar: number; sira: number;
}>): Promise<void> {
  const { error } = await sb().from("odeme_plani_kasa")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteOdemePlaniKasa(id: string): Promise<void> {
  const { error } = await sb().from("odeme_plani_kasa").delete().eq("id", id);
  if (error) throw error;
}
