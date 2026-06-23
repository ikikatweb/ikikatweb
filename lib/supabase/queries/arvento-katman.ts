// Arvento haritalarına eklenen kalıcı katmanlar (NetCAD/KML çizgileri vb.).
// Tanımlamalar'dan yüklenir, tüm Arvento haritalarında referans olarak çizilir.
// Tablo: arvento_harita_katmani (geometriler jsonb olarak WGS84 lat/lng saklanır).
import { createClient } from "@/lib/supabase/client";
import type { HaritaGeometri } from "@/lib/arvento/kml-parse";

export type HaritaKatman = {
  id: string;
  ad: string;
  renk: string;
  kalinlik: number;
  gorunur: boolean;
  santiye_id: string | null; // hangi şantiyeye ait (yüklerken atanır)
  geometriler: HaritaGeometri[];
  created_at: string;
};

export type SantiyeSecenek = { id: string; is_adi: string; il: string | null };

const TABLO = "arvento_harita_katmani";

// KML atamak + İL İZNİ için şantiye listesi (sıra no'ya göre). il = elle girilen override (yoksa null →
// çağıran taraf şantiye adından otomatik bulur). il kolonu yoksa null döner (geriye uyumlu).
export async function getSantiyeSecenekleri(): Promise<SantiyeSecenek[]> {
  const supabase = createClient();
  const sec = async (kolonlar: string) => supabase.from("santiyeler").select(kolonlar).order("sira_no", { ascending: true });
  let { data, error } = await sec("id, is_adi, sira_no, il");
  if (error) ({ data, error } = await sec("id, is_adi, sira_no")); // il kolonu henüz eklenmemişse
  if (error) return [];
  return (data ?? []).map((s) => {
    const r = s as unknown as { id: string; is_adi: string; il?: string | null };
    return { id: r.id, is_adi: r.is_adi, il: r.il ?? null };
  });
}

// Şantiyenin il'ini elle ayarla (override). il="" → null (otomatik tahmine dön).
export async function setSantiyeIl(santiyeId: string, il: string | null): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("santiyeler").update({ il: il || null }).eq("id", santiyeId);
  if (error) throw error;
}

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

export async function ekleHaritaKatman(k: { ad: string; renk: string; geometriler: HaritaGeometri[]; santiyeId: string | null }): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(TABLO)
    .insert({ ad: k.ad, renk: k.renk, geometriler: k.geometriler, gorunur: true, santiye_id: k.santiyeId });
  if (error) throw error;
}

export async function silHaritaKatman(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLO).delete().eq("id", id);
  if (error) throw error;
}

export async function guncelleHaritaKatman(
  id: string,
  alanlar: Partial<Pick<HaritaKatman, "ad" | "renk" | "kalinlik" | "gorunur" | "santiye_id">>,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLO).update(alanlar).eq("id", id);
  if (error) throw error;
}
