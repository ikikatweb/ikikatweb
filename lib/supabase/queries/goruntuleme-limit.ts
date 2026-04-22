// Görüntüleme gün limitleri — kısıtlı kullanıcıların Kasa Defteri ve Yakıt
// sayfalarında kaç gün geriye ait verileri görebileceğini kontrol eder
import { createClient } from "@/lib/supabase/client";
import type { GoruntulemeLimit } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getGoruntulemeLimit(): Promise<GoruntulemeLimit | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("goruntuleme_limit")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as GoruntulemeLimit | null;
}

export async function upsertGoruntulemeLimit(limit: {
  kasa_gun: number;
  yakit_gun: number;
}): Promise<void> {
  const supabase = getSupabase();
  const mevcut = await getGoruntulemeLimit();
  if (mevcut) {
    const { error } = await supabase
      .from("goruntuleme_limit")
      .update({ ...limit, updated_at: new Date().toISOString() })
      .eq("id", mevcut.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("goruntuleme_limit")
      .insert(limit);
    if (error) throw error;
  }
}

// N gün öncesinin tarihini "YYYY-MM-DD" formatında döndür
export function ngunOnce(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
