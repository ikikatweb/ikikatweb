// Personel × Şantiye bazlı teknik personel bayrağı.
// Sadece bilgi amaçlı rozet için kullanılır — atamalara, giriş/çıkış tarihlerine
// veya gün hesabına HİÇBİR ETKİSİ YOKTUR.
//
// Tablo şeması (Supabase'de manuel oluşturulmalı):
//   CREATE TABLE IF NOT EXISTS personel_teknik (
//     personel_id UUID NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
//     santiye_id UUID NOT NULL REFERENCES santiyeler(id) ON DELETE CASCADE,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     PRIMARY KEY (personel_id, santiye_id)
//   );
import { createClient } from "@/lib/supabase/client";

export type PersonelTeknikRow = {
  personel_id: string;
  santiye_id: string;
  created_at?: string;
};

function getSupabase() {
  return createClient();
}

// Tablo yoksa kabul edilen hata mesajı pattern'i
function isTableMissingError(msg: string): boolean {
  return /relation .*personel_teknik.* does not exist/i.test(msg)
    || /could not find the table.*personel_teknik/i.test(msg)
    || /table .*personel_teknik.* does not exist/i.test(msg);
}

// Tüm teknik personel × şantiye eşleşmelerini getir.
// Tablo yoksa boş array döndürür (sessizce).
export async function getTeknikPersonelKayitlari(): Promise<PersonelTeknikRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_teknik")
    .select("personel_id, santiye_id");
  if (error) {
    if (isTableMissingError(error.message)) return [];
    throw error;
  }
  return data ?? [];
}

// Bir personeli BELİRLİ bir şantiyede teknik olarak işaretle veya işareti kaldır.
// Atamalara, giriş/çıkış tarihlerine ASLA dokunmaz.
export async function setPersonelTeknikSantiye(
  personelId: string,
  santiyeId: string,
  isTeknik: boolean,
): Promise<void> {
  const supabase = getSupabase();
  if (isTeknik) {
    // Upsert — varsa atla, yoksa ekle
    const { error } = await supabase
      .from("personel_teknik")
      .upsert({ personel_id: personelId, santiye_id: santiyeId }, { onConflict: "personel_id,santiye_id" });
    if (error) {
      if (isTableMissingError(error.message)) return; // tablo yoksa sessizce geç
      throw error;
    }
  } else {
    const { error } = await supabase
      .from("personel_teknik")
      .delete()
      .eq("personel_id", personelId)
      .eq("santiye_id", santiyeId);
    if (error) {
      if (isTableMissingError(error.message)) return;
      throw error;
    }
  }
}
