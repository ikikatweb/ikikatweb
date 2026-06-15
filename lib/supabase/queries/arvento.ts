// Arvento araç çalışma raporu sorguları
import { createClient } from "@/lib/supabase/client";
import type { AracArventoRapor } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Mevcut rapor tarihleri (yeni → eski), tarih seçici için
export async function getArventoTarihler(limit = 60): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_rapor")
    .select("rapor_tarihi")
    .order("rapor_tarihi", { ascending: false })
    .limit(2000);
  if (error) return [];
  const set = new Set<string>();
  for (const r of (data ?? []) as { rapor_tarihi: string }[]) set.add(r.rapor_tarihi);
  return Array.from(set).slice(0, limit);
}

// Belirli bir günün araç kayıtları
export async function getArventoRaporByTarih(tarih: string): Promise<AracArventoRapor[]> {
  if (!tarih) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_rapor")
    .select("*")
    .eq("rapor_tarihi", tarih)
    .order("mesafe_km", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as AracArventoRapor[];
}

// En güncel rapor tarihini döndür (dashboard widget için)
export async function getArventoSonTarih(): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_rapor")
    .select("rapor_tarihi")
    .order("rapor_tarihi", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { rapor_tarihi: string } | null)?.rapor_tarihi ?? null;
}
