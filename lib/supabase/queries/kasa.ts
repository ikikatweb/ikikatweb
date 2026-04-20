// Kasa Defteri sorguları — personel harcama takibi
import { createClient } from "@/lib/supabase/client";
import type { KasaHareketi } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getKasaHareketleri(): Promise<KasaHareketi[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kasa_hareketi")
    .select("*")
    .order("tarih", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as KasaHareketi[];
}

// Tarih aralığına göre kasa hareketlerini getir — büyük veri setlerinde hızlı yükleme için
export async function getKasaHareketleriByRange(baslangic: string, bitis: string): Promise<KasaHareketi[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kasa_hareketi")
    .select("*")
    .gte("tarih", baslangic)
    .lte("tarih", bitis)
    .order("tarih", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as KasaHareketi[];
}

// Bir tarihe kadar olan kümülatif nakit bakiyeleri — kullanıcı bazlı devir hesabı için hızlı
// Sadece personel_id, tip, tutar alanları çekilir (minimal payload)
export async function getKasaDevirBakiyeleri(bitisTarihi: string): Promise<Map<string, number>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kasa_hareketi")
    .select("personel_id, tip, tutar")
    .eq("odeme_yontemi", "nakit")
    .lte("tarih", bitisTarihi);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const h of (data ?? []) as { personel_id: string; tip: string; tutar: number }[]) {
    const prev = map.get(h.personel_id) ?? 0;
    map.set(h.personel_id, prev + (h.tip === "gelir" ? h.tutar : -h.tutar));
  }
  return map;
}

export async function insertKasaHareketi(data: {
  personel_id: string;
  santiye_id: string;
  tarih: string;
  tip: "gelir" | "gider";
  odeme_yontemi: "nakit" | "kart";
  kategori: string | null;
  tutar: number;
  aciklama: string | null;
  slip_url: string | null;
  created_by: string | null;
}): Promise<KasaHareketi> {
  const supabase = getSupabase();
  const { data: result, error } = await supabase
    .from("kasa_hareketi")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return result as KasaHareketi;
}

export async function updateKasaHareketi(id: string, data: {
  personel_id: string;
  santiye_id: string;
  tarih: string;
  tip: "gelir" | "gider";
  odeme_yontemi: "nakit" | "kart";
  kategori: string | null;
  tutar: number;
  aciklama: string | null;
  slip_url: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("kasa_hareketi")
    .update(data)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteKasaHareketi(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("kasa_hareketi")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function uploadSlip(file: File, hareketId: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const filePath = `${hareketId}/slip.${ext}`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "kasa-slipleri");
  formData.append("path", filePath);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Slip yüklenemedi");
  return data.url;
}
