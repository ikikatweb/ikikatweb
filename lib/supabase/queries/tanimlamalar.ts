// Tanımlama sorguları - Dinamik kategori bazlı sabit listeler
import { createClient } from "@/lib/supabase/client";
import type { TanimlamaInsert } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Sidebar sekme listesi (tanımlama oluştururken sekme seçimi için)
export const SEKME_LISTESI = [
  { key: "genel", label: "Genel (Tüm Sekmeler)" },
  { key: "firmalar", label: "Firmalar" },
  { key: "santiyeler", label: "Şantiyeler" },
  { key: "personel", label: "Personel" },
  { key: "araclar", label: "Araçlar" },
  { key: "yazismalar", label: "Yazışmalar" },
  { key: "puantaj", label: "Puantaj" },
  { key: "yakit", label: "Yakıt" },
  { key: "kasa-defteri", label: "Kasa Defteri" },
  { key: "santiye-defteri", label: "Şantiye Defteri" },
  { key: "yi-ufe", label: "Yi-ÜFE" },
  { key: "sigorta-muayene", label: "Sigorta & Muayene" },
  { key: "sistem", label: "Sistem Ayarları" },
];

export async function getTanimlamalar(kategori?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("tanimlamalar")
    .select("*")
    .eq("aktif", true)
    .order("sira", { ascending: true });

  if (kategori) {
    query = query.eq("kategori", kategori);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getTumTanimlamalar() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tanimlamalar")
    .select("*")
    .order("kategori", { ascending: true })
    .order("sira", { ascending: true });

  if (error) throw error;
  return data;
}

// Benzersiz kategori listesini getir
export async function getKategoriler(): Promise<{ kategori: string; sekme: string | null; adet: number }[]> {
  const data = await getTumTanimlamalar();
  if (!data) return [];
  const map = new Map<string, { sekme: string | null; adet: number }>();
  for (const t of data) {
    const mevcut = map.get(t.kategori);
    if (mevcut) {
      mevcut.adet++;
    } else {
      map.set(t.kategori, { sekme: t.sekme, adet: 1 });
    }
  }
  return Array.from(map.entries()).map(([kategori, v]) => ({ kategori, ...v }));
}

export async function createTanimlama(tanimlama: TanimlamaInsert) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tanimlamalar")
    .insert(tanimlama)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTanimlama(id: string, updates: Partial<TanimlamaInsert>) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("tanimlamalar")
    .update(updates)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteTanimlama(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("tanimlamalar")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

// Kategori bazlı değer listesi (dropdown'lar için)
export async function getDegerler(kategori: string): Promise<string[]> {
  const data = await getTanimlamalar(kategori);
  return (data ?? []).map((t) => t.deger);
}

// Muhataplar (gelen/giden evrak için) - kategori "muhatap"
export async function getMuhataplarFull(): Promise<{ id: string; deger: string; kisa_ad: string | null }[]> {
  const data = await getTanimlamalar("muhatap");
  return (data ?? []).map((t) => ({ id: t.id, deger: t.deger, kisa_ad: t.kisa_ad ?? null }));
}

// Banka muhatapları (banka yazışmaları için ayrı) - kategori "banka_muhatap"
export async function getBankaMuhataplarFull(): Promise<{ id: string; deger: string; kisa_ad: string | null }[]> {
  const data = await getTanimlamalar("banka_muhatap");
  return (data ?? []).map((t) => ({ id: t.id, deger: t.deger, kisa_ad: t.kisa_ad ?? null }));
}

// Banka hesapları - tanimlamalar kategori "banka_hesap"
// deger: hesap numarası
// kisa_ad: JSON format -> {"m":"muhatap_id","f":"firma_id"}
// Eski format (yalnız muhatap UUID) için geri dönük uyumlu
export function packHesapKisaAd(muhatapId: string | null, firmaId: string | null): string | null {
  if (!muhatapId && !firmaId) return null;
  return JSON.stringify({ m: muhatapId ?? null, f: firmaId ?? null });
}

export function unpackHesapKisaAd(kisaAd: string | null): { muhatap_id: string | null; firma_id: string | null } {
  if (!kisaAd) return { muhatap_id: null, firma_id: null };
  const trimmed = kisaAd.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { m?: string | null; f?: string | null };
      return { muhatap_id: parsed.m ?? null, firma_id: parsed.f ?? null };
    } catch {
      // JSON değilse eski formata düş
    }
  }
  // Eski format: sadece muhatap UUID
  return { muhatap_id: trimmed, firma_id: null };
}

// Acente iletişim bilgileri — kisa_ad alanında JSON
export function packAcenteKisaAd(data: { eposta?: string; telefon?: string; cep?: string; ilgili_kisi?: string }): string | null {
  const obj = { e: data.eposta || null, t: data.telefon || null, c: data.cep || null, i: data.ilgili_kisi || null };
  if (!obj.e && !obj.t && !obj.c && !obj.i) return null;
  return JSON.stringify(obj);
}

export function unpackAcenteKisaAd(kisaAd: string | null): { eposta: string; telefon: string; cep: string; ilgili_kisi: string } {
  if (!kisaAd) return { eposta: "", telefon: "", cep: "", ilgili_kisi: "" };
  try {
    const p = JSON.parse(kisaAd) as { e?: string | null; t?: string | null; c?: string | null; i?: string | null };
    return { eposta: p.e ?? "", telefon: p.t ?? "", cep: p.c ?? "", ilgili_kisi: p.i ?? "" };
  } catch {
    return { eposta: "", telefon: "", cep: "", ilgili_kisi: "" };
  }
}

export async function getBankaHesaplariFull(): Promise<{
  id: string;
  hesap_no: string;
  muhatap_id: string | null;
  muhatap_deger: string | null;
  muhatap_kisa_ad: string | null;
  firma_id: string | null;
  firma_adi: string | null;
  firma_kisa_adi: string | null;
}[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tanimlamalar")
    .select("*")
    .eq("aktif", true)
    .eq("kategori", "banka_hesap")
    .order("sira", { ascending: true });

  if (error) throw error;

  const rows = data ?? [];
  const parsedRows = rows.map((h) => ({
    raw: h,
    ids: unpackHesapKisaAd(h.kisa_ad),
  }));

  // Muhatap ve firma id'lerini topla
  const muhatapIds = [...new Set(parsedRows.map((r) => r.ids.muhatap_id).filter(Boolean) as string[])];
  const firmaIds = [...new Set(parsedRows.map((r) => r.ids.firma_id).filter(Boolean) as string[])];

  const muhataplar = new Map<string, { deger: string; kisa_ad: string | null }>();
  if (muhatapIds.length > 0) {
    const { data: mData } = await supabase
      .from("tanimlamalar")
      .select("id, deger, kisa_ad")
      .in("id", muhatapIds);
    (mData ?? []).forEach((m) => muhataplar.set(m.id, { deger: m.deger, kisa_ad: m.kisa_ad }));
  }

  const firmalar = new Map<string, { firma_adi: string; kisa_adi: string | null }>();
  if (firmaIds.length > 0) {
    const { data: fData } = await supabase
      .from("firmalar")
      .select("id, firma_adi, kisa_adi")
      .in("id", firmaIds);
    (fData ?? []).forEach((f) => firmalar.set(f.id, { firma_adi: f.firma_adi, kisa_adi: f.kisa_adi }));
  }

  return parsedRows.map(({ raw, ids }) => {
    const m = ids.muhatap_id ? muhataplar.get(ids.muhatap_id) : null;
    const f = ids.firma_id ? firmalar.get(ids.firma_id) : null;
    return {
      id: raw.id,
      hesap_no: raw.deger,
      muhatap_id: ids.muhatap_id,
      muhatap_deger: m?.deger ?? null,
      muhatap_kisa_ad: m?.kisa_ad ?? null,
      firma_id: ids.firma_id,
      firma_adi: f?.firma_adi ?? null,
      firma_kisa_adi: f?.kisa_adi ?? null,
    };
  });
}

// Talimat kişileri - tanimlamalar kategori "talimat_kisi"
// deger: Ad Soyad, kisa_ad: TC kimlik no
export async function getTalimatKisileriFull(): Promise<{
  id: string;
  ad_soyad: string;
  tc_no: string | null;
}[]> {
  const data = await getTanimlamalar("talimat_kisi");
  return (data ?? []).map((t) => ({
    id: t.id,
    ad_soyad: t.deger,
    tc_no: t.kisa_ad ?? null,
  }));
}
