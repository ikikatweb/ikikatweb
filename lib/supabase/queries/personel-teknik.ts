// Personel × Şantiye bazlı teknik personel bayrağı.
// Sadece bilgi amaçlı rozet için kullanılır — atamalara, giriş/çıkış tarihlerine
// veya gün hesabına HİÇBİR ETKİSİ YOKTUR.
//
// Tablo şeması (Supabase SQL editor'de çalıştırılmalı):
//   CREATE TABLE IF NOT EXISTS personel_teknik (
//     personel_id UUID NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
//     santiye_id UUID NOT NULL REFERENCES santiyeler(id) ON DELETE CASCADE,
//     is_teknik BOOLEAN NOT NULL DEFAULT TRUE,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     PRIMARY KEY (personel_id, santiye_id)
//   );
//
// Bir satır "kullanıcı açıkça işaretledi/kaldırdı" demektir.
// is_teknik=true  → bu personel bu şantiyede TEKNİK
// is_teknik=false → bu personel bu şantiyede AÇIKÇA teknik DEĞİL (fallback'i ezer)
// Satır yok      → eski atama-bazlı fallback geçerli (tablo hiç kullanılmadıysa)
import { createClient } from "@/lib/supabase/client";

export type PersonelTeknikRow = {
  personel_id: string;
  santiye_id: string;
  is_teknik: boolean;
  created_at?: string;
};

function getSupabase() {
  return createClient();
}

function isTableMissingError(msg: string): boolean {
  return /relation .*personel_teknik.* does not exist/i.test(msg)
    || /could not find the table.*personel_teknik/i.test(msg)
    || /table .*personel_teknik.* does not exist/i.test(msg);
}

function isColumnMissingError(msg: string): boolean {
  return /column .*is_teknik/i.test(msg);
}

// Tüm teknik personel × şantiye eşleşmelerini getir.
// is_teknik kolonu yoksa fallback: her satır true sayılır.
export async function getTeknikPersonelKayitlari(): Promise<PersonelTeknikRow[]> {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from("personel_teknik")
    .select("personel_id, santiye_id, is_teknik");
  if (error && isColumnMissingError(error.message)) {
    // Eski şema: is_teknik kolonu yok → tüm satırları true say
    const res = await supabase.from("personel_teknik").select("personel_id, santiye_id");
    if (res.error) {
      if (isTableMissingError(res.error.message)) return [];
      throw res.error;
    }
    return (res.data ?? []).map((r) => ({ ...r, is_teknik: true }));
  }
  if (error) {
    if (isTableMissingError(error.message)) return [];
    throw error;
  }
  return (data ?? []) as PersonelTeknikRow[];
}

// Bir personeli BELİRLİ bir şantiyede teknik olarak işaretle veya işareti kaldır.
// Tablo'ya açık bir satır yazar — fallback artık o (personel, şantiye) için devre dışı.
// Atamalara, giriş/çıkış tarihlerine ASLA dokunmaz.
export async function setPersonelTeknikSantiye(
  personelId: string,
  santiyeId: string,
  isTeknik: boolean,
): Promise<void> {
  const supabase = getSupabase();
  // Upsert ile both true ve false durumunu kalıcı olarak işaretle
  let { error } = await supabase
    .from("personel_teknik")
    .upsert(
      { personel_id: personelId, santiye_id: santiyeId, is_teknik: isTeknik },
      { onConflict: "personel_id,santiye_id" },
    );
  if (error && isColumnMissingError(error.message)) {
    // Eski şema (is_teknik kolonu yok): true → insert, false → delete
    if (isTeknik) {
      const res = await supabase
        .from("personel_teknik")
        .upsert({ personel_id: personelId, santiye_id: santiyeId }, { onConflict: "personel_id,santiye_id" });
      error = res.error;
    } else {
      const res = await supabase
        .from("personel_teknik")
        .delete()
        .eq("personel_id", personelId)
        .eq("santiye_id", santiyeId);
      error = res.error;
    }
  }
  if (error) {
    if (isTableMissingError(error.message)) return; // tablo yoksa sessizce geç
    throw error;
  }
}
