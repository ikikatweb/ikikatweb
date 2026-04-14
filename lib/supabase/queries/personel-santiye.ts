// Personel-Şantiye çoklu atama sorguları
// Bir personel aynı anda birden fazla şantiyeye atanabilir.
// personel_santiye(personel_id, santiye_id) junction tablosu kullanılır.
import { createClient } from "@/lib/supabase/client";
import type { PersonelSantiye } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Tüm personel-şantiye atamalarını getir
export async function getPersonelSantiyeler(): Promise<PersonelSantiye[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_santiye")
    .select("*");
  if (error) throw error;
  return (data ?? []) as PersonelSantiye[];
}

// Personeli bir şantiyeye ata. Zaten atanmışsa no-op.
export async function addPersonelSantiye(
  personelId: string,
  santiyeId: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_santiye")
    .upsert(
      { personel_id: personelId, santiye_id: santiyeId },
      { onConflict: "personel_id,santiye_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

// Personeli bir şantiyeden çıkar. Personel diğer şantiyelerde kalabilir.
export async function removePersonelSantiye(
  personelId: string,
  santiyeId: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_santiye")
    .delete()
    .eq("personel_id", personelId)
    .eq("santiye_id", santiyeId);
  if (error) throw error;
}
