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
  // Önce zaten var mı kontrol et — varsa bildirim gönderme
  const { data: mevcut } = await supabase
    .from("personel_santiye")
    .select("personel_id")
    .eq("personel_id", personelId)
    .eq("santiye_id", santiyeId)
    .maybeSingle();
  const yeniAtama = !mevcut;

  const { error } = await supabase
    .from("personel_santiye")
    .upsert(
      { personel_id: personelId, santiye_id: santiyeId },
      { onConflict: "personel_id,santiye_id", ignoreDuplicates: true },
    );
  if (error) throw error;

  // Push bildirim — sadece yeni atama ise (zaten varsa spam olmasın)
  if (!yeniAtama) return;
  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    const [{ data: personel }, { data: santiye }] = await Promise.all([
      supabase.from("personel").select("ad_soyad, gorev").eq("id", personelId).maybeSingle(),
      supabase.from("santiyeler").select("is_adi").eq("id", santiyeId).maybeSingle(),
    ]);
    const personelAd = personel?.ad_soyad ?? "—";
    const gorev = personel?.gorev ? ` · ${personel.gorev}` : "";
    const santiyeAd = santiye?.is_adi ? String(santiye.is_adi).slice(0, 60) : "—";
    bildirimGonder({
      baslik: `👷 Personel Atandı — ${personelAd}${gorev}`,
      govde: `${santiyeAd} şantiyesine atandı`,
      url: "/dashboard/puantaj/personel",
      tag: "personel",
    });
  } catch { /* sessiz */ }
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

  // Push bildirim — şantiyeden çıkarıldı
  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    const [{ data: personel }, { data: santiye }] = await Promise.all([
      supabase.from("personel").select("ad_soyad").eq("id", personelId).maybeSingle(),
      supabase.from("santiyeler").select("is_adi").eq("id", santiyeId).maybeSingle(),
    ]);
    const personelAd = personel?.ad_soyad ?? "—";
    const santiyeAd = santiye?.is_adi ? String(santiye.is_adi).slice(0, 60) : "—";
    bildirimGonder({
      baslik: `👷 Personel Şantiyeden Çıkarıldı — ${personelAd}`,
      govde: `${santiyeAd}`,
      url: "/dashboard/puantaj/personel",
      tag: "personel",
    });
  } catch { /* sessiz */ }
}
