// Şantiye Defteri sorguları — günlük kayıt takibi
import { createClient } from "@/lib/supabase/client";
import type { SantiyeDefteri, SantiyeDefterKayit } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Defter kaydı olan şantiye ID'lerini getir (filtre dropdown'u için)
export async function getDefterliSantiyeIds(): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_defteri")
    .select("santiye_id");
  if (error) throw error;
  const set = new Set<string>();
  for (const r of (data ?? []) as { santiye_id: string }[]) set.add(r.santiye_id);
  return Array.from(set);
}

// Defter — tarih aralığı
export async function getDefterler(
  santiyeId: string,
  baslangic: string,
  bitis: string
): Promise<SantiyeDefteri[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_defteri")
    .select("*")
    .eq("santiye_id", santiyeId)
    .gte("tarih", baslangic)
    .lte("tarih", bitis)
    .order("tarih", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SantiyeDefteri[];
}

// Tek güne ait defter
export async function getDefterByTarih(
  santiyeId: string,
  tarih: string
): Promise<SantiyeDefteri | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_defteri")
    .select("*")
    .eq("santiye_id", santiyeId)
    .eq("tarih", tarih)
    .maybeSingle();
  if (error) throw error;
  return data as SantiyeDefteri | null;
}

// Sonraki sayfa numarası
export async function getNextSayfaNo(santiyeId: string): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_defteri")
    .select("sayfa_no")
    .eq("santiye_id", santiyeId)
    .order("sayfa_no", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (data && data.length > 0) return (data[0].sayfa_no ?? 0) + 1;
  return 1;
}

// Defter oluştur
export async function insertDefter(defter: {
  santiye_id: string;
  tarih: string;
  sayfa_no: number;
  hava_durumu: string | null;
  sicaklik: string | null;
  created_by: string | null;
}): Promise<SantiyeDefteri> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_defteri")
    .insert(defter)
    .select()
    .single();
  if (error) throw error;
  return data as SantiyeDefteri;
}

// Defter güncelle (hava durumu, sıcaklık)
export async function updateDefter(
  id: string,
  updates: { hava_durumu?: string | null; sicaklik?: string | null }
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("santiye_defteri")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Kayıtlar — deftere ait
export async function getKayitlar(defterId: string): Promise<SantiyeDefterKayit[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_defteri_kayit")
    .select("*")
    .eq("defter_id", defterId)
    .order("sira", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SantiyeDefterKayit[];
}

// Kayıt ekle
export async function insertKayit(kayit: {
  defter_id: string;
  yazan_id: string;
  icerik: string;
  sira: number;
}): Promise<SantiyeDefterKayit> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_defteri_kayit")
    .insert(kayit)
    .select()
    .single();
  if (error) throw error;
  return data as SantiyeDefterKayit;
}

// Kayıt güncelle
export async function updateKayit(
  id: string,
  icerik: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("santiye_defteri_kayit")
    .update({ icerik, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Kayıt sil
export async function deleteKayit(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("santiye_defteri_kayit")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Defter sil (CASCADE ile kayıtlar da silinir)
export async function deleteDefter(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("santiye_defteri")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
