// Bizden Haberler — yönetim (CRUD). Browser client (giriş yapmış kullanıcı, RLS authenticated).
import { createClient } from "@/lib/supabase/client";
import type { Haber, HaberInsert, HaberUpdate } from "@/lib/supabase/types";

function sb() { return createClient(); }

// Yönetim listesi (yayında olmayanlar dahil).
export async function getHaberler(): Promise<Haber[]> {
  const { data, error } = await sb()
    .from("haberler")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Haber[];
}

export async function createHaber(h: HaberInsert): Promise<void> {
  const { error } = await sb().from("haberler").insert(h);
  if (error) throw error;
}

export async function updateHaber(id: string, h: HaberUpdate): Promise<void> {
  const { error } = await sb().from("haberler").update(h).eq("id", id);
  if (error) throw error;
}

export async function deleteHaber(id: string): Promise<void> {
  const { error } = await sb().from("haberler").delete().eq("id", id);
  if (error) throw error;
}

// Haber görseli yükle (public "haberler" bucket'ına) → public URL döner. /api/upload ortak altyapısı.
export async function uploadHaberGorsel(file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `haber-${Date.now()}.${ext}`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "haberler");
  formData.append("path", path);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Görsel yüklenemedi");
  return data.url as string;
}
