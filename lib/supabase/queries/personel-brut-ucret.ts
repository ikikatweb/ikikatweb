// Personel Brüt Ücret Geçmişi sorguları
// Tıpkı arac_kira_bedeli mantığında: her değişiklik yeni satır olarak kaydedilir,
// belirli bir tarih/ay için geçerli ücret latest gecerli_tarih <= o tarih kuralıyla bulunur.
import { createClient } from "@/lib/supabase/client";
import type { PersonelBrutUcret } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Tüm personellerin brüt ücret geçmişini getir (bordro / iscilik-takibi sayfaları için)
export async function getTumPersonelBrutUcretler(): Promise<PersonelBrutUcret[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_brut_ucret")
    .select("*")
    .order("gecerli_tarih", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    // Tablo henüz yoksa sessizce boş dön (migration çalıştırılana kadar)
    return [];
  }
  return (data ?? []) as PersonelBrutUcret[];
}

// Tek personelin brüt ücret geçmişi
export async function getPersonelBrutUcretler(
  personelId: string,
): Promise<PersonelBrutUcret[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_brut_ucret")
    .select("*")
    .eq("personel_id", personelId)
    .order("gecerli_tarih", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as PersonelBrutUcret[];
}

// Yeni brüt ücret kaydı ekle (geçmişe yeni satır)
export async function insertPersonelBrutUcret(
  personelId: string,
  ucret: number,
  gecerliTarih: string,
  kullaniciId?: string | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_brut_ucret")
    .insert({
      personel_id: personelId,
      ucret,
      gecerli_tarih: gecerliTarih,
      created_by: kullaniciId ?? null,
    });
  if (error) throw error;
}

// Mevcut bir kaydı güncelle
export async function updatePersonelBrutUcret(
  id: string,
  ucret: number,
  gecerliTarih: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_brut_ucret")
    .update({ ucret, gecerli_tarih: gecerliTarih })
    .eq("id", id);
  if (error) throw error;
}

// Kaydı sil
export async function deletePersonelBrutUcret(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_brut_ucret")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Yardımcı: belirli bir personel × ay için geçerli brüt ücreti bul.
// ayStr: "YYYY-MM"
// Kural: gecerli_tarih <= ayın son günü olan en güncel kayıt.
// Eğer hiç kayıt yoksa veya hiçbiri ay sonuna kadar geçerli değilse 0 döner.
export function brutUcretForAy(
  history: PersonelBrutUcret[],
  personelId: string,
  ayStr: string,
): number {
  const [yil, ay] = ayStr.split("-").map(Number);
  const sonGun = new Date(yil, ay, 0).getDate();
  const limit = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
  let enUygun: PersonelBrutUcret | null = null;
  for (const h of history) {
    if (h.personel_id !== personelId) continue;
    if (h.gecerli_tarih > limit) continue;
    if (!enUygun || h.gecerli_tarih > enUygun.gecerli_tarih) {
      enUygun = h;
    }
  }
  return enUygun?.ucret ?? 0;
}
