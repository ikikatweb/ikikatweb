// Gelen evrak CRUD sorguları
import { createClient } from "@/lib/supabase/client";
import type { GelenEvrakInsert } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getGelenEvraklar(olusturanId?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("gelen_evrak")
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url), santiyeler!left(is_adi)")
    .or("silindi.is.null,silindi.eq.false")
    .order("evrak_tarihi", { ascending: false });

  if (olusturanId) {
    query = query.eq("olusturan_id", olusturanId);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Oluşturan bilgisini API üzerinden çek (RLS bypass)
  if (data && data.length > 0) {
    const kullaniciMap = new Map<string, string>();
    try {
      const res = await fetch("/api/kullanicilar/adlar");
      if (res.ok) {
        const adlar = (await res.json()) as { id: string; ad_soyad: string }[];
        adlar.forEach((k) => kullaniciMap.set(k.id, k.ad_soyad));
      }
    } catch { /* sessiz */ }

    return data.map((e) => ({
      ...e,
      kullanicilar: e.olusturan_id ? { ad_soyad: kullaniciMap.get(e.olusturan_id) ?? "—" } : null,
    }));
  }

  return (data ?? []).map((e) => ({ ...e, kullanicilar: null }));
}

export async function createGelenEvrak(evrak: GelenEvrakInsert) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gelen_evrak")
    .insert(evrak)
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url), santiyeler!left(is_adi)")
    .single();

  if (error) throw error;

  // Push bildirim
  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    const firma = data?.firmalar?.kisa_adi || data?.firmalar?.firma_adi || "?";
    const muhatapKisa = evrak.muhatap ? String(evrak.muhatap).split("\n")[0].slice(0, 60) : "";
    bildirimGonder({
      baslik: `📥 Yeni Gelen Evrak — ${firma}`,
      govde: [muhatapKisa, evrak.konu ? String(evrak.konu).slice(0, 80) : ""].filter(Boolean).join(" · "),
      url: `/dashboard/yazismalar/gelen-evrak${evrak.evrak_sayi_no ? `?ara=${encodeURIComponent(evrak.evrak_sayi_no)}` : ""}`,
      tag: "gelen-evrak",
      kaynak_tip: "gelen-evrak",
      kaynak_id: data.id,
    });
  } catch { /* sessiz */ }

  return { ...data, kullanicilar: null };
}

export async function updateGelenEvrak(id: string, updates: Partial<GelenEvrakInsert>) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gelen_evrak")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url), santiyeler!left(is_adi)")
    .single();

  if (error) throw error;
  return { ...data, kullanicilar: null };
}

export async function softDeleteGelenEvrak(id: string, silmeNedeni: string, silenId?: string | null) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("gelen_evrak")
    .update({
      silindi: true,
      silme_nedeni: silmeNedeni,
      silen_id: silenId ?? null,
      silme_tarihi: now,
      updated_at: now,
    })
    .eq("id", id);

  if (error) throw error;
  // İlgili bildirimleri de temizle
  try {
    const { bildirimSilByKaynak } = await import("@/lib/bildirim");
    bildirimSilByKaynak("gelen-evrak", id);
  } catch { /* sessiz */ }
}

// Silinen gelen evrakları getir
export async function getSilinenGelenEvraklar(olusturanId?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("gelen_evrak")
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url), santiyeler!left(is_adi)")
    .eq("silindi", true)
    .order("silme_tarihi", { ascending: false });

  if (olusturanId) query = query.eq("olusturan_id", olusturanId);

  const { data, error } = await query;
  if (error) throw error;

  if (data && data.length > 0) {
    // Oluşturan + silen kullanıcıları tek sorguda getir
    const userIds = [
      ...new Set([
        ...data.map((e) => e.olusturan_id).filter(Boolean),
        ...data.map((e) => e.silen_id).filter(Boolean),
      ]),
    ];
    if (userIds.length > 0) {
      const { data: kullanicilar } = await supabase
        .from("kullanicilar")
        .select("id, ad_soyad")
        .in("id", userIds);
      const map = new Map<string, string>();
      (kullanicilar ?? []).forEach((k) => map.set(k.id, k.ad_soyad));
      return data.map((e) => ({
        ...e,
        kullanicilar: e.olusturan_id ? { ad_soyad: map.get(e.olusturan_id) ?? "—" } : null,
        silen_kullanici: e.silen_id ? { ad_soyad: map.get(e.silen_id) ?? "—" } : null,
      }));
    }
  }
  return (data ?? []).map((e) => ({ ...e, kullanicilar: null, silen_kullanici: null }));
}

// Geri yükle
export async function restoreGelenEvrak(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("gelen_evrak")
    .update({ silindi: false, silme_nedeni: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Kalıcı olarak sil
export async function hardDeleteGelenEvrak(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("gelen_evrak").delete().eq("id", id);
  if (error) throw error;
}
