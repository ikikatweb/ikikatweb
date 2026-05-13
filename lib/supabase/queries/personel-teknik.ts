// Personel × Şantiye bazlı teknik personel bayrağı + (opsiyonel) atanan isim.
// Sadece bilgi amaçlı rozet için kullanılır — atamalara, giriş/çıkış tarihlerine
// veya gün hesabına HİÇBİR ETKİSİ YOKTUR.
//
// Tablo şeması (Supabase SQL editor'de çalıştırılmalı):
//   CREATE TABLE IF NOT EXISTS personel_teknik (
//     personel_id UUID NOT NULL REFERENCES personel(id) ON DELETE CASCADE,
//     santiye_id UUID NOT NULL REFERENCES santiyeler(id) ON DELETE CASCADE,
//     is_teknik BOOLEAN NOT NULL DEFAULT TRUE,
//     teknik_isim TEXT NULL,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     PRIMARY KEY (personel_id, santiye_id)
//   );
//
// teknik_isim: yeni model — kullanıcı şantiyenin teknik_personeller listesinden
// bir isim seçer ve burada saklanır. Eski model (is_teknik=true/false) hâlâ
// çalışır; teknik_isim null kalır.
import { createClient } from "@/lib/supabase/client";

export type PersonelTeknikRow = {
  personel_id: string;
  santiye_id: string;
  is_teknik: boolean;
  teknik_isim?: string | null;
  created_at?: string;
};

function getSupabase() {
  return createClient();
}

function isTableMissingError(msg: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("personel_teknik") && (
    m.includes("does not exist")
    || m.includes("could not find the table")
    || m.includes("could not find a relation")
    || m.includes("schema cache")
  );
}

function isColumnMissingError(msg: string, col: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  const c = col.toLowerCase();
  // Daha esnek: kolon adı mesajda geçiyorsa ve "missing/find/column/schema/exist" kelimelerinden biri varsa
  if (!m.includes(c)) return false;
  return (
    m.includes("column")
    || m.includes("could not find")
    || m.includes("schema cache")
    || m.includes("does not exist")
    || m.includes("unknown")
    || m.includes("missing")
  );
}

// Tüm teknik personel × şantiye eşleşmelerini getir.
export async function getTeknikPersonelKayitlari(): Promise<PersonelTeknikRow[]> {
  const supabase = getSupabase();
  // İlk denemede teknik_isim ile birlikte çek
  let { data, error } = await supabase
    .from("personel_teknik")
    .select("personel_id, santiye_id, is_teknik, teknik_isim");
  if (error && isColumnMissingError(error.message, "teknik_isim")) {
    // Eski şema: teknik_isim kolonu yok → onsuz çek
    const res = await supabase.from("personel_teknik").select("personel_id, santiye_id, is_teknik");
    if (res.error) {
      if (isColumnMissingError(res.error.message, "is_teknik")) {
        // Hiç is_teknik kolonu yoksa (en eski şema) → tüm satırları true say
        const res2 = await supabase.from("personel_teknik").select("personel_id, santiye_id");
        if (res2.error) {
          if (isTableMissingError(res2.error.message)) return [];
          throw res2.error;
        }
        return (res2.data ?? []).map((r) => ({ ...r, is_teknik: true, teknik_isim: null }));
      }
      if (isTableMissingError(res.error.message)) return [];
      throw res.error;
    }
    return (res.data ?? []).map((r) => ({ ...r, teknik_isim: null })) as PersonelTeknikRow[];
  }
  if (error && isColumnMissingError(error.message, "is_teknik")) {
    const res = await supabase.from("personel_teknik").select("personel_id, santiye_id");
    if (res.error) {
      if (isTableMissingError(res.error.message)) return [];
      throw res.error;
    }
    return (res.data ?? []).map((r) => ({ ...r, is_teknik: true, teknik_isim: null }));
  }
  if (error) {
    if (isTableMissingError(error.message)) return [];
    throw error;
  }
  return (data ?? []) as PersonelTeknikRow[];
}

// Bir personeli BELİRLİ bir şantiyede teknik olarak işaretle (opsiyonel isim ile)
// veya işareti kaldır.
export async function setPersonelTeknikSantiye(
  personelId: string,
  santiyeId: string,
  isTeknik: boolean,
  teknikIsim?: string | null,
): Promise<void> {
  const supabase = getSupabase();
  // Upsert ile both true ve false durumunu kalıcı olarak işaretle, isim varsa kaydet
  const row: Record<string, unknown> = {
    personel_id: personelId,
    santiye_id: santiyeId,
    is_teknik: isTeknik,
    teknik_isim: isTeknik ? (teknikIsim ?? null) : null,
  };
  let { error } = await supabase
    .from("personel_teknik")
    .upsert(row, { onConflict: "personel_id,santiye_id" });
  if (error && isColumnMissingError(error.message, "teknik_isim")) {
    // Eski şema: teknik_isim kolonu yok → onsuz upsert
    delete row.teknik_isim;
    const res = await supabase
      .from("personel_teknik")
      .upsert(row, { onConflict: "personel_id,santiye_id" });
    error = res.error;
  }
  if (error && isColumnMissingError(error.message, "is_teknik")) {
    // En eski şema (is_teknik kolonu yok): true → insert, false → delete
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
    if (isTableMissingError(error.message)) {
      throw new Error("personel_teknik tablosu bulunamadı. Supabase'de SQL migration çalıştırılmalı.");
    }
    throw error;
  }
}
