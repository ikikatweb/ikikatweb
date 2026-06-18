// Arvento haritalarına eklenen kalıcı katmanlar (NetCAD/KML çizgileri vb.).
// Tanımlamalar'dan yüklenir, tüm Arvento haritalarında referans olarak çizilir.
// Tablo: arvento_harita_katmani (geometriler jsonb olarak WGS84 lat/lng saklanır).
import { createClient } from "@/lib/supabase/client";
import type { HaritaGeometri } from "@/lib/arvento/kml-parse";

export type HaritaKatman = {
  id: string;
  ad: string;
  renk: string;
  gorunur: boolean;
  geometriler: HaritaGeometri[];
  created_at: string;
};

const TABLO = "arvento_harita_katmani";

// Tüm katmanları getir (eski → yeni). Tablo yoksa/erişilemezse boş döner ki haritalar bozulmasın.
export async function getHaritaKatmanlari(): Promise<HaritaKatman[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLO)
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as HaritaKatman[];
}

export async function ekleHaritaKatman(k: { ad: string; renk: string; geometriler: HaritaGeometri[] }): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(TABLO)
    .insert({ ad: k.ad, renk: k.renk, geometriler: k.geometriler, gorunur: true });
  if (error) throw error;
}

export async function silHaritaKatman(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLO).delete().eq("id", id);
  if (error) throw error;
}

export async function guncelleHaritaKatman(
  id: string,
  alanlar: Partial<Pick<HaritaKatman, "ad" | "renk" | "gorunur">>,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLO).update(alanlar).eq("id", id);
  if (error) throw error;
}
