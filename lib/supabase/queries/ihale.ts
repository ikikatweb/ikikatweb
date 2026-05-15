// İhale sorguları — sınır değer hesaplama
import { createClient } from "@/lib/supabase/client";
import type { Ihale, IhaleInsert, IhaleKatilimci, IhaleKatilimciInsert } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// --- İhale CRUD ---

export async function getIhaleler(): Promise<(Ihale & { katilimci_sayisi?: number; firma_adlari?: string[] })[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ihale")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const ihaleler = (data ?? []) as Ihale[];
  if (ihaleler.length === 0) return [];

  // Tüm katılımcıları çek — Supabase varsayılan 1000 satır limitini aşmak için
  // ihale_id'leri 5'erli gruplara böl, paralel sorgula.
  // (Tek .in() çağrısı çok ihale × çok firma olunca server-side max_rows'a takılıyor.)
  const ihaleIds = ihaleler.map((i) => i.id);
  const katMap = new Map<string, { firma_adi: string; teklif_tutari: number; durum: string }[]>();
  try {
    const chunkSize = 5;
    const chunks: string[][] = [];
    for (let i = 0; i < ihaleIds.length; i += chunkSize) {
      chunks.push(ihaleIds.slice(i, i + chunkSize));
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("ihale_katilimci")
          .select("ihale_id, firma_adi, teklif_tutari, durum")
          .in("ihale_id", chunk)
          .then(({ data }) => (data ?? []) as { ihale_id: string; firma_adi: string; teklif_tutari: number; durum: string }[])
      )
    );
    for (const arr of results) {
      for (const k of arr) {
        if (!katMap.has(k.ihale_id)) katMap.set(k.ihale_id, []);
        katMap.get(k.ihale_id)!.push(k);
      }
    }
  } catch { /* sessiz */ }

  return ihaleler.map((i) => {
    const kats = katMap.get(i.id) ?? [];
    let muhtemel_kazanan_tutar = i.muhtemel_kazanan_tutar;
    if (muhtemel_kazanan_tutar == null && i.muhtemel_kazanan) {
      const kazanan = kats.find((k) => k.firma_adi === i.muhtemel_kazanan && k.durum === "gecerli");
      if (kazanan) muhtemel_kazanan_tutar = kazanan.teklif_tutari;
    }
    return {
      ...i,
      muhtemel_kazanan_tutar,
      katilimci_sayisi: kats.length,
      firma_adlari: kats.map((k) => k.firma_adi),
    };
  });
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
    const savedId = (data as Ihale).id;
    bildirimGonder({
      baslik: `🏛️ Yeni İhale`,
      govde: `${ihale.idare_adi ?? "?"}${ihale.is_adi ? " · " + ihale.is_adi.slice(0, 80) : ""}`,
      // Bildirime tıklayınca: ilgili ihale yüklenip PDF otomatik açılır
      url: `/dashboard/ihale?ihale=${savedId}&pdf=1`,
      tag: "ihale",
      kaynak_tip: "ihale",
      kaynak_id: savedId,
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
  try {
    const { bildirimSilByKaynak } = await import("@/lib/bildirim");
    bildirimSilByKaynak("ihale", id);
  } catch { /* sessiz */ }
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
