// Kasa Defteri sorguları — personel harcama takibi
import { createClient } from "@/lib/supabase/client";
import type { KasaHareketi, KasaHareketLimit } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getKasaHareketleri(): Promise<KasaHareketi[]> {
  const supabase = getSupabase();
  // Supabase default 1000 satır limitini pagination ile aş (tüm geçmiş kayıtlar gelsin)
  const PARCA = 1000;
  const tumRows: KasaHareketi[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("kasa_hareketi")
      .select("*")
      .order("tarih", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + PARCA - 1);
    if (error) throw error;
    const parca = (data ?? []) as KasaHareketi[];
    tumRows.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return tumRows;
}

// Tarih aralığına göre kasa hareketlerini getir — pagination ile tüm veriyi çek
export async function getKasaHareketleriByRange(baslangic: string, bitis: string): Promise<KasaHareketi[]> {
  const supabase = getSupabase();
  const PARCA = 1000;
  const tumRows: KasaHareketi[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("kasa_hareketi")
      .select("*")
      .gte("tarih", baslangic)
      .lte("tarih", bitis)
      .order("tarih", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + PARCA - 1);
    if (error) throw error;
    const parca = (data ?? []) as KasaHareketi[];
    tumRows.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return tumRows;
}

// Bir tarihe kadar olan kümülatif nakit bakiyeleri — kullanıcı bazlı devir hesabı
// Server-side aggregate eden API route üzerinden tek istekte alınır.
// (Eski client-side pagination versiyonu çok yavaştı — binlerce satırı 1000'lik
// parçalarla çekiyordu. Yeni API service role ile tek seferde aggregate döner.)
export async function getKasaDevirBakiyeleri(bitisTarihi: string): Promise<Map<string, number>> {
  try {
    const res = await fetch(`/api/kasa-devir-bakiye?bitis=${bitisTarihi}`, {
      // Tarayıcı cache'ini bypass et — her seferinde fresh hesap (gerekirse SWR/React Query ile cache'lenir)
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Devir bakiye API hatası");
    const obj = (await res.json()) as Record<string, number>;
    return new Map(Object.entries(obj));
  } catch (err) {
    console.warn("getKasaDevirBakiyeleri (API) hatası, fallback'e geçiliyor:", err);
    // Fallback: client-side pagination (eski yöntem) — API route henüz deploy edilmemişse
    const supabase = getSupabase();
    const PARCA = 1000;
    const map = new Map<string, number>();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("kasa_hareketi")
        .select("personel_id, tip, tutar")
        .eq("odeme_yontemi", "nakit")
        .lte("tarih", bitisTarihi)
        .range(offset, offset + PARCA - 1);
      if (error) throw error;
      const parca = (data ?? []) as { personel_id: string; tip: string; tutar: number }[];
      for (const h of parca) {
        const prev = map.get(h.personel_id) ?? 0;
        map.set(h.personel_id, prev + (h.tip === "gelir" ? h.tutar : -h.tutar));
      }
      if (parca.length < PARCA) break;
      offset += PARCA;
      if (offset > 100000) break;
    }
    return map;
  }
}

export async function insertKasaHareketi(data: {
  personel_id: string;
  santiye_id: string;
  tarih: string;
  tip: "gelir" | "gider";
  odeme_yontemi: "nakit" | "kart";
  kategori: string | null;
  tutar: number;
  aciklama: string | null;
  slip_url: string | null;
  created_by: string | null;
}): Promise<KasaHareketi> {
  const supabase = getSupabase();
  const { data: result, error } = await supabase
    .from("kasa_hareketi")
    .insert(data)
    .select()
    .single();
  if (error) throw error;

  // Push bildirim — yöneticilere (kaydı giren hariç)
  try {
    const { bildirimGonder, formatTL } = await import("@/lib/bildirim");
    const tip = data.tip === "gelir" ? "Gelir" : "Gider";
    const odeme = data.odeme_yontemi === "nakit" ? "Nakit" : "Kart";
    bildirimGonder({
      baslik: `💰 Yeni Kasa ${tip} — ${formatTL(data.tutar)}`,
      govde: `${odeme}${data.kategori ? " · " + data.kategori : ""}${data.aciklama ? " · " + data.aciklama.slice(0, 80) : ""}`,
      url: `/dashboard/kasa-defteri?personel=${data.personel_id}`,
      tag: "kasa",
      kaynak_tip: "kasa",
      kaynak_id: data.id,
    });
  } catch { /* sessiz */ }

  return result as KasaHareketi;
}

export async function updateKasaHareketi(id: string, data: {
  personel_id: string;
  santiye_id: string;
  tarih: string;
  tip: "gelir" | "gider";
  odeme_yontemi: "nakit" | "kart";
  kategori: string | null;
  tutar: number;
  aciklama: string | null;
  slip_url: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("kasa_hareketi")
    .update(data)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteKasaHareketi(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("kasa_hareketi")
    .delete()
    .eq("id", id);
  if (error) throw error;
  // İlgili bildirimleri de temizle
  try {
    const { bildirimSilByKaynak } = await import("@/lib/bildirim");
    bildirimSilByKaynak("kasa", id);
  } catch { /* sessiz */ }
}

export async function uploadSlip(file: File, hareketId: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const filePath = `${hareketId}/slip.${ext}`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "kasa-slipleri");
  formData.append("path", filePath);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Slip yüklenemedi");
  return data.url;
}

// ==================== KASA HAREKET ÜST LİMİT ====================
// Tek satırlı yapı — DB'de sadece bir satır beklenir

export async function getKasaHareketLimit(): Promise<KasaHareketLimit | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("kasa_hareketi_limit")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as KasaHareketLimit | null;
}

export async function upsertKasaHareketLimit(limit: {
  ust_sinir_nakit: number;
  ust_sinir_kart: number;
}): Promise<void> {
  const supabase = getSupabase();
  const mevcut = await getKasaHareketLimit();
  if (mevcut) {
    const { error } = await supabase
      .from("kasa_hareketi_limit")
      .update({ ...limit, updated_at: new Date().toISOString() })
      .eq("id", mevcut.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("kasa_hareketi_limit")
      .insert(limit);
    if (error) throw error;
  }
}
