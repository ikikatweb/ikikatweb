// İşçilik takibi sorguları - Şantiye bazlı prim takibi
import { createClient } from "@/lib/supabase/client";

function getSupabase() {
  return createClient();
}

export async function getIscilikTakibi(dahilSilinen = false) {
  const supabase = getSupabase();
  let query = supabase
    .from("iscilik_takibi")
    .select("*, santiyeler(sira_no, is_adi, is_grubu, sozlesme_bedeli, sure_uzatimi, is_suresi, is_bitim_tarihi, isyeri_teslim_tarihi, gecici_kabul_tarihi, kesin_kabul_tarihi, tasfiye_tarihi, devir_tarihi, created_at)")
    .order("created_at", { ascending: true });

  if (!dahilSilinen) {
    query = query.or("silindi.is.null,silindi.eq.false");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getSilinenIscilikTakibi() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("iscilik_takibi")
    .select("*, santiyeler(sira_no, is_adi, is_grubu, sozlesme_bedeli, sure_uzatimi, is_suresi, is_bitim_tarihi, isyeri_teslim_tarihi, gecici_kabul_tarihi, kesin_kabul_tarihi, tasfiye_tarihi, devir_tarihi, created_at)")
    .eq("silindi", true)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function upsertIscilikTakibi(
  santiyeId: string,
  updates: Record<string, unknown>
) {
  const supabase = getSupabase();

  // Mevcut kayıt var mı kontrol et
  const { data: mevcut } = await supabase
    .from("iscilik_takibi")
    .select("id")
    .eq("santiye_id", santiyeId)
    .single();

  if (mevcut) {
    const { error } = await supabase
      .from("iscilik_takibi")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", mevcut.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("iscilik_takibi")
      .insert({ santiye_id: santiyeId, ...updates });
    if (error) throw error;
  }
}

export async function ensureAktifSantiyeler() {
  const supabase = getSupabase();

  // Aktif = geçici kabul yok, kesin kabul yok, tasfiye yok, devir yok
  const { data: gercekAktif } = await supabase
    .from("santiyeler")
    .select("id")
    .is("gecici_kabul_tarihi", null)
    .is("kesin_kabul_tarihi", null)
    .is("tasfiye_tarihi", null)
    .is("devir_tarihi", null);

  const aktifIds = (gercekAktif ?? []).map((s) => s.id);

  // Mevcut takip kayıtlarını al
  const { data: mevcutKayitlar } = await supabase
    .from("iscilik_takibi")
    .select("santiye_id");

  const mevcutIds = new Set((mevcutKayitlar ?? []).map((k) => k.santiye_id));

  // Eksik şantiyeler için kayıt oluştur
  const eksikler = aktifIds.filter((id) => !mevcutIds.has(id));
  if (eksikler.length > 0) {
    const rows = eksikler.map((santiye_id) => ({ santiye_id }));
    await supabase.from("iscilik_takibi").insert(rows);
  }
}

export async function deleteIscilikTakibi(id: string) {
  const supabase = getSupabase();
  // Soft delete - çöp kutusuna taşı
  const { error } = await supabase
    .from("iscilik_takibi")
    .update({ silindi: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreIscilikTakibi(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("iscilik_takibi")
    .update({ silindi: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Tüm iscilik_aylik kayıtlarını getir (işçilik durum raporu için tarih hesabı)
export async function getTumIscilikAyliklari() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("iscilik_aylik")
    .select("iscilik_takibi_id, ait_oldugu_ay, alt_yuklenici_tutar, yuklenici_tutar");
  if (error) throw error;
  return data ?? [];
}

export async function permanentDeleteIscilikTakibi(id: string) {
  const supabase = getSupabase();
  await supabase.from("iscilik_aylik").delete().eq("iscilik_takibi_id", id);
  const { error } = await supabase.from("iscilik_takibi").delete().eq("id", id);
  if (error) throw error;
}
