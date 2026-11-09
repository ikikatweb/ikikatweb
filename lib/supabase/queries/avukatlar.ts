// AVUKATLAR — icra cevabı "Avukat Aracılığı" ile verildiğinde seçilen kişiler.
// Yönetimi İcra Dosyaları > Tanımlamalar sekmesinde. Gerekçe: sql/avukatlar.sql.
import { createClient } from "@/lib/supabase/client";
import type { Avukat } from "@/lib/supabase/types";

function sb() { return createClient(); }

/** Tümü (pasifler dâhil) — Tanımlamalar ekranı için. */
export async function getAvukatlar(): Promise<Avukat[]> {
  const { data, error } = await sb()
    .from("avukatlar").select("*")
    .order("sira", { ascending: true }).order("ad_soyad", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Avukat[];
}

/**
 * Seçim listesi için YALNIZ aktifler.
 *
 * HATA FIRLATMAZ ama SUSMAZ: cevap penceresinin tamamı avukat listesi yüzünden
 * çalışmaz hale gelmesin diye hata yutuluyor — ancak "tablo kurulmamış" ile
 * "henüz avukat eklenmemiş" AYRI döndürülüyor. İkisi tek bir boş listeye
 * indirgenince ekran "avukat yok, ekleyin" diyor, kullanıcı eklemeye çalışıyor
 * ve anlamadığı bir hata alıyordu.
 */
export async function getAktifAvukatlar(): Promise<{ liste: Avukat[]; tabloYok: boolean }> {
  const { data, error } = await sb()
    .from("avukatlar").select("*").eq("aktif", true)
    .order("sira", { ascending: true }).order("ad_soyad", { ascending: true });
  if (error) {
    console.warn("Avukat listesi okunamadı:", error.message);
    const tabloYok = /avukatlar/.test(error.message) && /does not exist|schema cache/i.test(error.message);
    return { liste: [], tabloYok };
  }
  return { liste: (data ?? []) as Avukat[], tabloYok: false };
}

export async function insertAvukat(row: Partial<Avukat>): Promise<Avukat> {
  const { data, error } = await sb().from("avukatlar").insert(row).select().single();
  if (error) throw error;
  return data as Avukat;
}

export async function updateAvukat(id: string, patch: Partial<Avukat>): Promise<void> {
  const { error } = await sb().from("avukatlar")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/**
 * SİLME DEĞİL PASİFE ALMA yeğlenir (bkz. aktif alanı): silinen avukatın bağlı
 * olduğu icra kayıtlarında avukat_id null'a düşer. Adı yine de kalır (avukat_adi
 * anlık kopya), ama iletişim bilgisi kaybolur. Arayüz bunu kullanıcıya söyler.
 */
export async function deleteAvukat(id: string): Promise<void> {
  const { error } = await sb().from("avukatlar").delete().eq("id", id);
  if (error) throw error;
}
