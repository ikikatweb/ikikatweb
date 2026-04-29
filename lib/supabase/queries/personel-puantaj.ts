// Personel Puantaj sorguları
// Bir personel bir tarihte sadece 1 şantiyede puantajlanabilir (UNIQUE personel_id+tarih)
import { createClient } from "@/lib/supabase/client";
import type { PersonelPuantaj, PersonelPuantajDurum } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Bir ay için belirli şantiyenin puantaj kayıtlarını getir
// Her kayda created_by'ın çözülmüş ad_soyad'ı (created_by_ad) eklenir
export async function getPersonelPuantajByAySantiye(
  santiyeId: string,
  yil: number,
  ay: number
): Promise<PersonelPuantaj[]> {
  const supabase = getSupabase();
  const baslangic = `${yil}-${String(ay).padStart(2, "0")}-01`;
  const sonrakiAy = ay === 12 ? 1 : ay + 1;
  const sonrakiYil = ay === 12 ? yil + 1 : yil;
  const bitis = `${sonrakiYil}-${String(sonrakiAy).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("personel_puantaj")
    .select("*")
    .eq("santiye_id", santiyeId)
    .gte("tarih", baslangic)
    .lt("tarih", bitis);

  if (error) throw error;
  const rows = (data ?? []) as PersonelPuantaj[];
  if (rows.length === 0) return rows;

  // created_by id'lerinden kullanıcı ad_soyad'larını çek
  // RLS bypass için API endpoint kullan (service role key ile çalışır) — direkt
  // supabase.from("kullanicilar") sorgusu RLS politikasına takılıp boş döner.
  const map = new Map<string, string>();
  try {
    const res = await fetch("/api/kullanicilar/adlar");
    if (res.ok) {
      const tumKullanicilar = (await res.json()) as { id: string; ad_soyad: string }[];
      for (const k of tumKullanicilar) map.set(k.id, k.ad_soyad);
    }
  } catch { /* sessiz */ }
  return rows.map((p) => ({
    ...p,
    created_by_ad: p.created_by ? map.get(p.created_by) ?? null : null,
  }));
}

// Belirtilen ay içinde, BAŞKA şantiyelerdeki TÜM personel puantajlarını getir.
// Race condition'a karşı: personelIds null verilirse tüm personelin çakışmaları getirilir.
export async function getDigerSantiyePersonelCakismalari(
  personelIds: string[] | null,
  yil: number,
  ay: number,
  haricSantiyeId: string
): Promise<{ personel_id: string; tarih: string; santiye_id: string; santiye_adi: string }[]> {
  const supabase = getSupabase();
  const baslangic = `${yil}-${String(ay).padStart(2, "0")}-01`;
  const sonrakiAy = ay === 12 ? 1 : ay + 1;
  const sonrakiYil = ay === 12 ? yil + 1 : yil;
  const bitis = `${sonrakiYil}-${String(sonrakiAy).padStart(2, "0")}-01`;

  let query = supabase
    .from("personel_puantaj")
    .select("personel_id, tarih, santiye_id, santiyeler(is_adi)")
    .neq("santiye_id", haricSantiyeId)
    .gte("tarih", baslangic)
    .lt("tarih", bitis);

  if (personelIds && personelIds.length > 0) {
    query = query.in("personel_id", personelIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((r) => {
    const s = r as unknown as {
      personel_id: string;
      tarih: string;
      santiye_id: string;
      santiyeler?: { is_adi: string } | null;
    };
    return {
      personel_id: s.personel_id,
      tarih: s.tarih,
      santiye_id: s.santiye_id,
      santiye_adi: s.santiyeler?.is_adi ?? "?",
    };
  });
}

// Belirli bir personelin belirli tarihteki TÜM puantaj kayıtlarını (multi-row safe) getir
export async function getPersonelPuantajKayitlari(
  personelId: string,
  tarih: string
): Promise<{ id: string; santiye_id: string; santiye_adi: string }[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("personel_puantaj")
    .select("id, santiye_id, santiyeler(is_adi)")
    .eq("personel_id", personelId)
    .eq("tarih", tarih);

  if (error) throw error;
  return (data ?? []).map((r) => {
    const s = r as unknown as {
      id: string;
      santiye_id: string;
      santiyeler?: { is_adi: string } | null;
    };
    return {
      id: s.id,
      santiye_id: s.santiye_id,
      santiye_adi: s.santiyeler?.is_adi ?? "?",
    };
  });
}

// Puantaj ekle veya güncelle.
// - Başka şantiyede kayıt varsa REDDET (aynı gün aynı personel sadece 1 şantiyede)
// - Aynı şantiyede kayıt varsa UPDATE
// - Yoksa INSERT
// Ayrıca personel pasif ise ve pasif_tarihi'nden sonraki bir güne puantaj işlenmeye çalışılıyorsa REDDET.
export async function upsertPersonelPuantaj(
  personelId: string,
  santiyeId: string,
  tarih: string,
  durum: PersonelPuantajDurum,
  mesaiSaat: number | null,
  aciklama: string | null,
  kullaniciId?: string | null
) {
  const supabase = getSupabase();

  // Pasif personel guard
  const { data: personelRow, error: pErr } = await supabase
    .from("personel")
    .select("durum, pasif_tarihi, ad_soyad")
    .eq("id", personelId)
    .single();
  if (pErr) throw pErr;
  if (personelRow && personelRow.durum === "pasif" && personelRow.pasif_tarihi) {
    if (tarih > personelRow.pasif_tarihi) {
      throw new Error(
        `"${personelRow.ad_soyad}" personeli ${personelRow.pasif_tarihi} tarihinde pasife alındı. Bu tarihten sonrasına puantaj işlenemez.`
      );
    }
  }

  // Önce aynı personel + tarih için mevcut tüm kayıtları kontrol et
  const mevcut = await getPersonelPuantajKayitlari(personelId, tarih);

  // Başka şantiyelerde kayıt varsa REDDET
  const baskaSantiyeler = mevcut.filter((k) => k.santiye_id !== santiyeId);
  if (baskaSantiyeler.length > 0) {
    const isim = baskaSantiyeler.map((k) => k.santiye_adi).join(", ");
    throw new Error(
      `Bu personel ${tarih} tarihinde "${isim}" şantiyesinde puantajlı. Aynı personel aynı gün sadece 1 şantiyede olabilir.`
    );
  }

  // Bu şantiyede kayıt varsa güncelle
  const buSantiyedeki = mevcut.find((k) => k.santiye_id === santiyeId);
  if (buSantiyedeki) {
    const { error } = await supabase
      .from("personel_puantaj")
      .update({
        durum,
        mesai_saat: mesaiSaat,
        aciklama: aciklama ?? null,
        created_by: kullaniciId ?? null,
      })
      .eq("id", buSantiyedeki.id);
    if (error) throw error;
    return;
  }

  // Hiç kayıt yok -> yeni insert
  const { error } = await supabase
    .from("personel_puantaj")
    .insert({
      personel_id: personelId,
      santiye_id: santiyeId,
      tarih,
      durum,
      mesai_saat: mesaiSaat,
      aciklama: aciklama ?? null,
      created_by: kullaniciId ?? null,
    });
  if (error) throw error;

  // Push bildirim — her 10 girişte 1 (gün içinde sayaç)
  try {
    const { bildirimGonderHerNdaBir, formatTarih } = await import("@/lib/bildirim");
    const { data: santiye } = await supabase
      .from("santiyeler")
      .select("is_adi")
      .eq("id", santiyeId)
      .maybeSingle();
    const santiyeAd = santiye?.is_adi ? String(santiye.is_adi).slice(0, 40) : "?";
    const personelAd = personelRow?.ad_soyad ? String(personelRow.ad_soyad).slice(0, 40) : "?";
    const [yilStr, ayStr] = tarih.split("-");
    bildirimGonderHerNdaBir("personel-puantaj", 10, {
      baslik: `👷 Personel Puantaj — ${santiyeAd}`,
      govde: `${personelAd} · ${formatTarih(tarih)} · ${durum}${mesaiSaat ? ` · ${mesaiSaat} sa mesai` : ""}`,
      url: `/dashboard/puantaj/personel?santiye=${santiyeId}&yil=${yilStr}&ay=${parseInt(ayStr, 10)}`,
      tag: "personel-puantaj",
    });
  } catch { /* sessiz */ }
}

// Puantajı sil (toggle off)
export async function deletePersonelPuantaj(personelId: string, tarih: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("personel_puantaj")
    .delete()
    .eq("personel_id", personelId)
    .eq("tarih", tarih);
  if (error) throw error;
}
