// Şantiye CRUD sorguları - Proje/iş yönetimi işlemleri
import { createClient } from "@/lib/supabase/client";
import type { SantiyeInsert, SantiyeUpdate, SantiyeOrtagi, SantiyeIsGrubu } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

export async function getSantiyeler() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("*, firmalar!left(firma_adi, sira_no, renk)")
    .order("sira_no", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getSantiyelerBasic() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("id, is_adi, durum")
    .eq("durum", "aktif")
    .order("is_adi", { ascending: true });

  if (error) throw error;
  return data;
}

export type SantiyeAllRow = {
  id: string; is_adi: string; durum: string;
  gecici_kabul_tarihi: string | null; kesin_kabul_tarihi: string | null; tasfiye_tarihi: string | null; devir_tarihi: string | null;
  depo_kapasitesi: number | null; yuklenici_firma_id: string | null; isyeri_teslim_tarihi: string | null;
  is_suresi: number | null; is_bitim_tarihi: string | null; teknik_personel_sayisi: number | null; teknik_personeller: string[] | null;
  calisilmayan_bas: string | null; calisilmayan_bit: string | null; ihaleli?: boolean | null;
};

export async function getSantiyelerAll(): Promise<SantiyeAllRow[]> {
  const supabase = getSupabase();
  const base = "id, is_adi, durum, gecici_kabul_tarihi, kesin_kabul_tarihi, tasfiye_tarihi, devir_tarihi, depo_kapasitesi, yuklenici_firma_id, isyeri_teslim_tarihi, is_suresi, is_bitim_tarihi, teknik_personel_sayisi, teknik_personeller, calisilmayan_bas, calisilmayan_bit";
  // ihaleli kolonu henüz eklenmemiş olabilir (tipli client tanımaz) → varsa al, yoksa fallback.
  const r1 = await supabase.from("santiyeler").select(base + ", ihaleli").order("is_adi", { ascending: true });
  const r = r1.error ? await supabase.from("santiyeler").select(base).order("is_adi", { ascending: true }) : r1;
  if (r.error) throw r.error;
  return (r.data ?? []) as unknown as SantiyeAllRow[];
}

export async function getSantiyeById(id: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("*, firmalar!left(firma_adi, sira_no, renk)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function createSantiye(santiye: SantiyeInsert) {
  const supabase = getSupabase();
  let { data, error } = await supabase.from("santiyeler").insert(santiye).select().single();
  // "ihaleli" kolonu henüz eklenmemişse (migration çalışmadan) o alanı çıkarıp tekrar dene → form kilitlenmesin.
  if (error && /ihaleli/i.test(error.message)) {
    const s2 = { ...santiye }; delete (s2 as Record<string, unknown>).ihaleli;
    ({ data, error } = await supabase.from("santiyeler").insert(s2).select().single());
  }
  if (error) throw error;

  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    bildirimGonder({
      baslik: `🏗️ Yeni İş Deneyim Belgesi`,
      govde: String(santiye.is_adi ?? "").slice(0, 150),
      url: "/dashboard/yonetim/santiyeler",
      tag: "santiye",
      kaynak_tip: "santiye",
      kaynak_id: data.id,
    });
  } catch { /* sessiz */ }

  return data;
}

export async function updateSantiye(id: string, santiye: SantiyeUpdate) {
  const supabase = getSupabase();
  // Bildirim diff'i için ESKİ değerleri güncellemeden ÖNCE al.
  const anahtarAlanlar = ["is_adi", "sozlesme_bedeli", "durum", "gecici_kabul_tarihi", "kesin_kabul_tarihi", "tasfiye_tarihi", "sozlesme_tarihi"];
  let eski: Record<string, unknown> = {};
  try {
    const { data: onceki } = await supabase.from("santiyeler").select(anahtarAlanlar.join(",")).eq("id", id).maybeSingle();
    eski = (onceki ?? {}) as unknown as Record<string, unknown>;
  } catch { /* sessiz */ }

  const payload = { ...santiye, updated_at: new Date().toISOString() };
  let { data, error } = await supabase.from("santiyeler").update(payload).eq("id", id).select().single();
  // "ihaleli" kolonu yoksa o alanı çıkarıp tekrar dene → İş Deneyim kaydetme kilitlenmesin (migration öncesi).
  if (error && /ihaleli/i.test(error.message)) {
    const p2 = { ...payload }; delete (p2 as Record<string, unknown>).ihaleli;
    ({ data, error } = await supabase.from("santiyeler").update(p2).eq("id", id).select().single());
  }
  if (error) throw error;

  // Update bildirimi — HANGİ alan değişti, ESKİ → YENİ değeriyle. Sadece anahtar alanlar (form kaydet)
  // için; inline tek-alan edit spam etmesin. Gerçekten DEĞİŞMEYEN alan gösterilmez.
  try {
    const ETIKET: Record<string, string> = {
      is_adi: "İş Adı", sozlesme_bedeli: "Sözleşme Bedeli", durum: "Durum",
      gecici_kabul_tarihi: "Geçici Kabul", kesin_kabul_tarihi: "Kesin Kabul",
      tasfiye_tarihi: "Tasfiye", sozlesme_tarihi: "Sözleşme Tarihi",
    };
    const TARIH = new Set(["gecici_kabul_tarihi", "kesin_kabul_tarihi", "tasfiye_tarihi", "sozlesme_tarihi"]);
    const { bildirimGonder, formatTL, formatTarih } = await import("@/lib/bildirim");
    const fmt = (k: string, v: unknown): string => {
      if (v === null || v === undefined || v === "") return "—";
      if (k === "sozlesme_bedeli" && typeof v === "number") return formatTL(v);
      if (TARIH.has(k)) return formatTarih(String(v));
      return String(v);
    };
    const degisenler = anahtarAlanlar.filter(
      (k) => k in santiye && String(eski[k] ?? "") !== String((santiye as Record<string, unknown>)[k] ?? ""),
    );
    if (degisenler.length > 0 && data?.is_adi) {
      const detay = degisenler.map((k) => `${ETIKET[k]}: ${fmt(k, eski[k])} → ${fmt(k, (santiye as Record<string, unknown>)[k])}`).join(" · ");
      bildirimGonder({
        baslik: `🏗️ İş Deneyim Güncellendi — ${String(data.is_adi).slice(0, 60)}`,
        govde: detay.slice(0, 250),
        url: "/dashboard/yonetim/santiyeler",
        tag: "santiye",
      });
    }
  } catch { /* sessiz */ }

  return data;
}

export async function toggleSantiyeDurum(id: string, durum: "aktif" | "tamamlandi" | "tasfiye") {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("santiyeler")
    .update({ durum, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export async function uploadSantiyeFile(
  file: File,
  santiyeId: string,
  type: "gecici_kabul" | "kesin_kabul" | "is_deneyim"
) {
  const ext = file.name.split(".").pop();
  // Dosya yoluna timestamp ekle — aynı isim → cache miss + her yükleme yeni URL.
  // Eski dosya isimleri (örn. "gecici_kabul.pdf") storage'da kalabilir,
  // ama URL artık "gecici_kabul-{timestamp}.pdf" olacağından browser cache problem olmaz.
  const timestamp = Date.now();
  const filePath = `${santiyeId}/${type}-${timestamp}.${ext}`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "santiyeler");
  formData.append("path", filePath);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");

  return data.url;
}

// Ortak girişim ortakları
// Tüm şantiyelerin ortaklarını getir (liste sayfası için)
export async function getTumOrtaklar(): Promise<(SantiyeOrtagi & { firmalar?: { firma_adi: string } })[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_ortaklari")
    .select("*, firmalar!left(firma_adi, sira_no, renk)");
  if (error) throw error;
  return (data ?? []) as (SantiyeOrtagi & { firmalar?: { firma_adi: string } })[];
}

export async function getOrtaklar(santiyeId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_ortaklari")
    .select("*, firmalar!left(firma_adi, sira_no, renk)")
    .eq("santiye_id", santiyeId)
    .order("is_pilot", { ascending: false });

  if (error) throw error;
  return data;
}

export async function saveOrtaklar(
  santiyeId: string,
  ortaklar: { firma_id: string; oran: number; is_pilot: boolean }[]
) {
  const supabase = getSupabase();

  // Mevcut ortakları sil
  await supabase.from("santiye_ortaklari").delete().eq("santiye_id", santiyeId);

  if (ortaklar.length === 0) return;

  // Yenilerini ekle
  const rows = ortaklar.map((o) => ({ ...o, santiye_id: santiyeId }));
  const { error } = await supabase.from("santiye_ortaklari").insert(rows);

  if (error) throw error;
}

// ==================== İŞ GRUBU DAĞILIMI ====================

export async function getTumSantiyeIsGruplari(): Promise<SantiyeIsGrubu[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_is_gruplari")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SantiyeIsGrubu[];
}

export async function getSantiyeIsGruplari(santiyeId: string): Promise<SantiyeIsGrubu[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiye_is_gruplari")
    .select("*")
    .eq("santiye_id", santiyeId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SantiyeIsGrubu[];
}

export async function saveSantiyeIsGruplari(
  santiyeId: string,
  rows: { is_grubu: string; tutar: number }[],
): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("santiye_is_gruplari").delete().eq("santiye_id", santiyeId);
  if (rows.length === 0) return;
  const insertRows = rows.map((r) => ({ santiye_id: santiyeId, ...r }));
  const { error } = await supabase.from("santiye_is_gruplari").insert(insertRows);
  if (error) throw error;
}
