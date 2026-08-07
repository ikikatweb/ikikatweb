// SUNUCU TARAFI (service-role) — herkese açık ana sayfa için yayındaki haberleri çeker.
import { createClient } from "@supabase/supabase-js";
import type { Haber } from "@/lib/supabase/types";

export async function getHaberlerPublic(limit = 50): Promise<Haber[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const sb = createClient(url, key);
    const { data, error } = await sb
      .from("haberler")
      .select("id, baslik, ozet, icerik, gorsel_url, yayinda, created_at, created_by")
      .eq("yayinda", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as Haber[];
  } catch {
    return [];
  }
}
