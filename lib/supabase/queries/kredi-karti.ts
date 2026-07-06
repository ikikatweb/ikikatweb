// Kredi Kartları sorguları — elle girilen kart durum listesi (paylaşımlı).
import { createClient } from "@/lib/supabase/client";
import type { KrediKarti } from "@/lib/supabase/types";

function sb() { return createClient(); }

type KrediKartiYazi = {
  banka_adi: string | null; son4: string | null; kart_ozelligi: string | null;
  kart_sahibi: string | null; karti_kullanan: string | null;
  hesap_kesim: number | null; son_odeme: number | null;
  limit_tutar: number; guncel_borc: number; aciklama: string | null; sira: number;
};

export async function getKrediKartlar(): Promise<KrediKarti[]> {
  const { data, error } = await sb()
    .from("kredi_karti").select("*").order("sira", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KrediKarti[];
}

export async function insertKrediKarti(row: KrediKartiYazi): Promise<KrediKarti> {
  const { data, error } = await sb().from("kredi_karti").insert(row).select().single();
  if (error) throw error;
  return data as KrediKarti;
}

export async function updateKrediKarti(id: string, patch: Partial<KrediKartiYazi>): Promise<void> {
  const { error } = await sb().from("kredi_karti")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteKrediKarti(id: string): Promise<void> {
  const { error } = await sb().from("kredi_karti").delete().eq("id", id);
  if (error) throw error;
}
