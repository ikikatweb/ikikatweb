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
  const ihaleler = (data ?? []) as Ihale[];

  // Eski kayıtlarda muhtemel_kazanan_tutar boş olabilir (kolon henüz yoksa veya
  // kayıt eski mantıkla atılmışsa). Doldurmak için katılımcılardan dinamik bul:
  // Her ihale için kazanan firma adına eşleşen ilk katılımcının teklif tutarını al.
  const eksikIds = ihaleler
    .filter((i) => i.muhtemel_kazanan && (i.muhtemel_kazanan_tutar == null))
    .map((i) => i.id);
  if (eksikIds.length === 0) return ihaleler;

  try {
    const { data: katData } = await supabase
      .from("ihale_katilimci")
      .select("ihale_id, firma_adi, teklif_tutari, durum, sira")
      .in("ihale_id", eksikIds);
    if (!katData) return ihaleler;
    const katMap = new Map<string, { firma_adi: string; teklif_tutari: number; durum: string }[]>();
    for (const k of katData as { ihale_id: string; firma_adi: string; teklif_tutari: number; durum: string }[]) {
      if (!katMap.has(k.ihale_id)) katMap.set(k.ihale_id, []);
      katMap.get(k.ihale_id)!.push(k);
    }
    return ihaleler.map((i) => {
      if (i.muhtemel_kazanan_tutar != null || !i.muhtemel_kazanan) return i;
      const kats = katMap.get(i.id) ?? [];
      // Kazanan firma adına eşleşen ilk katılımcının teklif tutarı
      const kazanan = kats.find((k) => k.firma_adi === i.muhtemel_kazanan && k.durum === "gecerli");
      if (kazanan) return { ...i, muhtemel_kazanan_tutar: kazanan.teklif_tutari };
      return i;
    });
  } catch {
    return ihaleler;
  }
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

  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    bildirimGonder({
      baslik: `🏛️ Yeni İhale`,
      govde: `${ihale.idare_adi ?? "?"}${ihale.is_adi ? " · " + ihale.is_adi.slice(0, 80) : ""}`,
      url: "/dashboard/ihale",
      tag: "ihale",
    });
  } catch { /* sessiz */ }

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
