// Banka yazışmaları CRUD sorguları
import { createClient } from "@/lib/supabase/client";
import type { BankaYazismaInsert } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getBankaYazismalari(olusturanId?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("banka_yazismalari")
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url)")
    .or("silindi.is.null,silindi.eq.false")
    .order("evrak_tarihi", { ascending: false });

  if (olusturanId) {
    query = query.eq("olusturan_id", olusturanId);
  }

  const { data, error } = await query;
  if (error) throw error;

  if (data && data.length > 0) {
    // RLS bypass için API üzerinden kullanıcı adlarını çek
    const map = new Map<string, string>();
    try {
      const res = await fetch("/api/kullanicilar/adlar");
      if (res.ok) {
        const adlar = (await res.json()) as { id: string; ad_soyad: string }[];
        adlar.forEach((k) => map.set(k.id, k.ad_soyad));
      }
    } catch { /* sessiz */ }

    return data.map((e) => ({
      ...e,
      kullanicilar: e.olusturan_id ? { ad_soyad: map.get(e.olusturan_id) ?? "—" } : null,
    }));
  }
  return (data ?? []).map((e) => ({ ...e, kullanicilar: null }));
}

export async function createBankaYazisma(yazisma: BankaYazismaInsert) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("banka_yazismalari")
    .insert(yazisma)
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url)")
    .single();

  if (error) throw error;

  // Push bildirim
  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    const firma = data?.firmalar?.kisa_adi || data?.firmalar?.firma_adi || "?";
    const banka = yazisma.muhatap ? String(yazisma.muhatap).split("\n").slice(-1)[0].slice(0, 50) : "";
    bildirimGonder({
      baslik: `🏦 Yeni Banka Yazışması — ${firma}`,
      govde: [banka, yazisma.konu ? String(yazisma.konu).slice(0, 80) : ""].filter(Boolean).join(" · "),
      url: `/dashboard/yazismalar/banka-yazismalari${yazisma.evrak_sayi_no ? `?ara=${encodeURIComponent(yazisma.evrak_sayi_no)}` : ""}`,
      tag: "banka-yazismalari",
    });
  } catch { /* sessiz */ }

  return { ...data, kullanicilar: null };
}

export async function updateBankaYazisma(id: string, updates: Partial<BankaYazismaInsert>) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("banka_yazismalari")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url)")
    .single();

  if (error) throw error;
  return { ...data, kullanicilar: null };
}

export async function softDeleteBankaYazisma(id: string, silmeNedeni: string, silenId?: string | null) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("banka_yazismalari")
    .update({
      silindi: true,
      silme_nedeni: silmeNedeni,
      silen_id: silenId ?? null,
      silme_tarihi: now,
      updated_at: now,
    })
    .eq("id", id);
  if (error) throw error;
}

// Silinen banka yazışmalarını getir
export async function getSilinenBankaYazismalari(olusturanId?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("banka_yazismalari")
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url)")
    .eq("silindi", true)
    .order("silme_tarihi", { ascending: false });

  if (olusturanId) query = query.eq("olusturan_id", olusturanId);

  const { data, error } = await query;
  if (error) throw error;

  if (data && data.length > 0) {
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
export async function restoreBankaYazisma(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("banka_yazismalari")
    .update({ silindi: false, silme_nedeni: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Kalıcı olarak sil
export async function hardDeleteBankaYazisma(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("banka_yazismalari").delete().eq("id", id);
  if (error) throw error;
}

export async function getBankaYazismaSayiNo(firmaId: string, muhatapId: string | null): Promise<string> {
  const res = await fetch("/api/banka-yazisma-sayi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firma_id: firmaId, muhatap_id: muhatapId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sayı üretilemedi");
  return data.evrak_sayi_no;
}
