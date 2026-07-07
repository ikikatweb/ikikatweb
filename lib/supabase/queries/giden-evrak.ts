// Giden evrak CRUD sorguları
import { createClient } from "@/lib/supabase/client";
import type { GidenEvrakInsert } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getGidenEvraklar(
  olusturanId?: string,
  santiyeIds?: string[],
  santiyesizDahil?: boolean,
) {
  const supabase = getSupabase();
  let query = supabase
    .from("giden_evrak")
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url), santiyeler!left(is_adi)")
    .or("silindi.is.null,silindi.eq.false")
    .order("evrak_tarihi", { ascending: false })
    .order("created_at", { ascending: false });

  // KISITLI KULLANICI: kendi yazdığı evrakları HER ZAMAN görür (şantiye fark etmez)
  //   + atanmış şantiyenin diğer yazdıklarını da görür.
  // OR mantığı: olusturan_id = me OR santiye_id IN (assigned)
  // ŞANTIYE_ADMIN: olusturanId verilmez, sadece santiye filter çalışır.
  // YÖNETİCİ: hiçbir filtre yok.
  if (olusturanId && santiyeIds !== undefined) {
    // Kısıtlı: OR
    const parcalar: string[] = [`olusturan_id.eq.${olusturanId}`];
    if (santiyeIds.length > 0) {
      const idList = santiyeIds.map((id) => `"${id}"`).join(",");
      parcalar.push(`santiye_id.in.(${idList})`);
    }
    if (santiyesizDahil) {
      parcalar.push(`santiye_id.is.null`);
    }
    query = query.or(parcalar.join(","));
  } else if (olusturanId) {
    // Kısıtlı + şantiye filtre yok (yönetici user mu? olmamalı ama güvenli)
    query = query.eq("olusturan_id", olusturanId);
  } else if (santiyeIds !== undefined) {
    // Şantiye admin
    if (santiyesizDahil) {
      if (santiyeIds.length > 0) {
        const idList = santiyeIds.map((id) => `"${id}"`).join(",");
        query = query.or(`santiye_id.in.(${idList}),santiye_id.is.null`);
      } else {
        query = query.is("santiye_id", null);
      }
    } else {
      if (santiyeIds.length > 0) {
        query = query.in("santiye_id", santiyeIds);
      } else {
        query = query.eq("santiye_id", "00000000-0000-0000-0000-000000000000");
      }
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  if (data && data.length > 0) {
    // RLS bypass için API route üzerinden kullanıcı adlarını çek
    // (kısıtlı kullanıcı diğer kullanıcıların adlarını direkt çekemez)
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

export async function createGidenEvrak(evrak: GidenEvrakInsert) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("giden_evrak")
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
      baslik: `📤 Yeni Giden Evrak — ${firma}`,
      govde: [muhatapKisa, evrak.konu ? String(evrak.konu).slice(0, 80) : ""].filter(Boolean).join(" · "),
      url: `/dashboard/yazismalar/giden-evrak?yazdir=${data.id}`,
      tag: "giden-evrak",
      santiye_id: evrak.santiye_id ?? null,
      kaynak_tip: "giden-evrak",
      kaynak_id: data.id,
    });
  } catch { /* sessiz */ }

  return { ...data, kullanicilar: null };
}

export async function updateGidenEvrak(id: string, updates: Partial<GidenEvrakInsert>) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("giden_evrak")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url), santiyeler!left(is_adi)")
    .single();

  if (error) throw error;
  return { ...data, kullanicilar: null };
}

export async function softDeleteGidenEvrak(id: string, silmeNedeni: string, silenId?: string | null) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("giden_evrak")
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
    bildirimSilByKaynak("giden-evrak", id);
  } catch { /* sessiz */ }
}

// Silinen giden evrakları getir
export async function getSilinenGidenEvraklar(olusturanId?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("giden_evrak")
    .select("*, firmalar!left(firma_adi, kisa_adi, adres, antet_url, kase_url), santiyeler!left(is_adi)")
    .eq("silindi", true)
    .order("silme_tarihi", { ascending: false });

  if (olusturanId) query = query.eq("olusturan_id", olusturanId);

  const { data, error } = await query;
  if (error) throw error;

  if (data && data.length > 0) {
    // RLS bypass için API route üzerinden kullanıcı adlarını çek (kısıtlı kullanıcı direkt çekemez → aksi halde isimler "—" görünür)
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
      silen_kullanici: e.silen_id ? { ad_soyad: map.get(e.silen_id) ?? "—" } : null,
    }));
  }
  return (data ?? []).map((e) => ({ ...e, kullanicilar: null, silen_kullanici: null }));
}

// Geri yükle (silindi = false)
export async function restoreGidenEvrak(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("giden_evrak")
    .update({ silindi: false, silme_nedeni: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Kalıcı olarak sil
export async function hardDeleteGidenEvrak(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("giden_evrak").delete().eq("id", id);
  if (error) throw error;
}

export async function getGidenEvrakSayiNo(firmaId: string, muhatapId: string | null, muhatap?: string | null): Promise<string> {
  const res = await fetch("/api/giden-evrak-sayi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firma_id: firmaId, muhatap_id: muhatapId, muhatap: muhatap ?? null }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sayı üretilemedi");
  return data.evrak_sayi_no;
}
