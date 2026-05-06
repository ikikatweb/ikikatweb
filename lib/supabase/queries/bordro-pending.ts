// Bordro mail kuyruğu — paylaşımlı DB tablosu.
// localStorage yerine DB kullanılır → tüm adminler aynı kuyruğu görür.
import { createClient } from "@/lib/supabase/client";

function getSupabase() {
  return createClient();
}

export type BordroPendingDB = {
  id: string;
  tip: "giris" | "cikis" | "transfer";
  personel_ad: string;
  personel_tc: string | null;
  personel_gorev: string | null;
  santiye_ad: string | null;
  once_santiye_ad: string | null;
  tarih: string; // YYYY-MM-DD
  firma_id: string | null;
  created_by: string | null;
  created_by_ad: string | null;
  created_at: string;
};

export type BordroPendingInsert = Omit<BordroPendingDB, "id" | "created_at">;

export async function getPendingMailler(): Promise<BordroPendingDB[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bordro_pending_mail")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    // Tablo henüz yoksa sessizce boş dön
    return [];
  }
  return (data ?? []) as BordroPendingDB[];
}

export async function insertPendingMail(p: BordroPendingInsert): Promise<BordroPendingDB | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bordro_pending_mail")
    .insert(p)
    .select()
    .single();
  if (error) {
    console.error("[insertPendingMail] hata:", error);
    return null;
  }
  return data as BordroPendingDB;
}

export async function deletePendingMail(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("bordro_pending_mail")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function deletePendingMailler(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("bordro_pending_mail")
    .delete()
    .in("id", ids);
  if (error) throw error;
}
