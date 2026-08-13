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
  sure_uzatimli_tarih: string | null; // süre uzatımı varsa nihai bitiş tarihi (yoksa null → is_bitim_tarihi kullanılır)
};

export async function getSantiyelerAll(): Promise<SantiyeAllRow[]> {
  const supabase = getSupabase();
  const base = "id, is_adi, durum, gecici_kabul_tarihi, kesin_kabul_tarihi, tasfiye_tarihi, devir_tarihi, depo_kapasitesi, yuklenici_firma_id, isyeri_teslim_tarihi, is_suresi, is_bitim_tarihi, sure_uzatimli_tarih, teknik_personel_sayisi, teknik_personeller, calisilmayan_bas, calisilmayan_bit";
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
  // "ihaleli" / "gecici_kabul_itibar_tarihi" kolonları migration öncesi yoksa o alanları çıkarıp tekrar dene → form kilitlenmesin.
  if (error && /ihaleli|gecici_kabul_itibar_tarihi/i.test(error.message)) {
    const s2 = { ...santiye };
    delete (s2 as Record<string, unknown>).ihaleli;
    delete (s2 as Record<string, unknown>).gecici_kabul_itibar_tarihi;
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
  // "ihaleli" / "gecici_kabul_itibar_tarihi" kolonları yoksa o alanları çıkarıp tekrar dene (migration öncesi).
  if (error && /ihaleli|gecici_kabul_itibar_tarihi/i.test(error.message)) {
    const p2 = { ...payload };
    delete (p2 as Record<string, unknown>).ihaleli;
    delete (p2 as Record<string, unknown>).gecici_kabul_itibar_tarihi;
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

// İşi (şantiyeyi) kalıcı siler. Önce bu işe bağlı HERHANGİ bir veri var mı diye bakar —
// (araç/personel ataması, puantaj, işçilik, kasa, yakıt, bordro, evrak, harita katmanı vb.)
// varsa silmeyi engeller ki dolu bir iş yanlışlıkla silinmesin. İşin kendi tanım verileri
// (ortaklar, iş grubu dağılımı, gizli maliyet) ise bağımsız veri sayılmaz, iş ile birlikte silinir.
export async function deleteSantiye(id: string) {
  const supabase = getSupabase();

  // Bağlı veri kontrolü — santiye_id (veya özel kolon) ile bu işe bağlı tüm tablolar.
  // error (tablo/kolon yoksa) → o kontrol atlanır; DB'deki FK + UI fallback yine korur.
  const kontroller: { tablo: string; alan: string; label: string }[] = [
    { tablo: "araclar", alan: "santiye_id", label: "atanmış araç" },
    { tablo: "personel", alan: "santiye_id", label: "atanmış personel" },
    { tablo: "personel_santiye", alan: "santiye_id", label: "personel-şantiye ataması" },
    { tablo: "arac_puantaj", alan: "santiye_id", label: "araç puantajı" },
    { tablo: "personel_puantaj", alan: "santiye_id", label: "personel puantajı" },
    { tablo: "personel_atama_gecmisi", alan: "santiye_id", label: "personel atama geçmişi" },
    { tablo: "personel_atama_manuel_gun", alan: "santiye_id", label: "manuel puantaj günü" },
    { tablo: "personel_atama_bilgi_notu", alan: "santiye_id", label: "personel bilgi notu" },
    { tablo: "santiye_defteri", alan: "santiye_id", label: "şantiye defteri kaydı" },
    { tablo: "kasa_hareketi", alan: "santiye_id", label: "kasa hareketi" },
    { tablo: "arac_yakit", alan: "santiye_id", label: "yakıt kaydı" },
    { tablo: "yakit_alim", alan: "santiye_id", label: "yakıt alımı" },
    { tablo: "yakit_virman", alan: "gonderen_santiye_id", label: "yakıt virmanı (gönderen)" },
    { tablo: "yakit_virman", alan: "alan_santiye_id", label: "yakıt virmanı (alan)" },
    { tablo: "arac_puantaj_override", alan: "santiye_id", label: "araç puantaj düzeltmesi" },
    { tablo: "arac_bakim", alan: "santiye_id", label: "araç bakım kaydı" },
    { tablo: "gelen_evrak", alan: "santiye_id", label: "gelen evrak" },
    { tablo: "giden_evrak", alan: "santiye_id", label: "giden evrak" },
    { tablo: "arvento_katman", alan: "santiye_id", label: "harita katmanı" },
    { tablo: "personel_islem_takip", alan: "sicil_santiye_id", label: "personel işlem takibi" },
  ];

  const sonuclar = await Promise.all(
    kontroller.map(async (k) => {
      const { count, error } = await supabase
        .from(k.tablo)
        .select(k.alan, { count: "exact", head: true })
        .eq(k.alan, id);
      return error ? null : { label: k.label, count: count ?? 0 };
    }),
  );

  const engeller = sonuclar.filter(
    (r): r is { label: string; count: number } => !!r && r.count > 0,
  );

  // İşçilik takibi satırı HER iş için otomatik oluşturulur (kullanıcı verisi değil) → tek başına
  // engel değildir; işle birlikte silinir. Gerçek işçilik verisi AYLIK kayıtlardadır (iscilik_aylik) —
  // yalnızca o varsa engelle.
  let iscilikTakibiIds: string[] = [];
  try {
    const { data: itRows } = await supabase
      .from("iscilik_takibi").select("id").eq("santiye_id", id);
    iscilikTakibiIds = (itRows ?? []).map((r) => (r as { id: string }).id);
    if (iscilikTakibiIds.length > 0) {
      const { count } = await supabase
        .from("iscilik_aylik")
        .select("id", { count: "exact", head: true })
        .in("iscilik_takibi_id", iscilikTakibiIds);
      if (count && count > 0) engeller.push({ label: "işçilik (aylık) verisi", count });
    }
  } catch { /* tablo yoksa sessiz */ }

  if (engeller.length > 0) {
    const detay = engeller.map((e) => `${e.count} ${e.label}`).join(", ");
    throw new Error(
      `Bu işe bağlı veri bulunuyor (${detay}). İş silinemez — önce bu kayıtları kaldırın.`,
    );
  }

  // İşin kendi tanım/otomatik verileri — iş ile birlikte temizlenir (bağımsız veri değil).
  await supabase.from("santiye_ortaklari").delete().eq("santiye_id", id);
  await supabase.from("santiye_is_gruplari").delete().eq("santiye_id", id);
  await supabase.from("maliyet_gizli_santiye").delete().eq("santiye_id", id);
  // İşçilik takibi (otomatik satır) + aylık verisi (engel yoksa boştur) — önce çocuk, sonra üst satır.
  if (iscilikTakibiIds.length > 0) {
    await supabase.from("iscilik_aylik").delete().in("iscilik_takibi_id", iscilikTakibiIds);
    await supabase.from("iscilik_takibi").delete().eq("santiye_id", id);
  }

  const { error } = await supabase.from("santiyeler").delete().eq("id", id);
  if (error) throw error;
}

// SÖZLEŞME TARİHİ HATIRLATMASI — "Henüz Sözleşme imzalanmadı" ile boş kaydedilmiş (sozlesme_tarihi NULL)
// aktif işlerde, iş oluşturulduktan 7 GÜN sonra "sözleşme tarihini girin" ana sayfa uyarısı.
export type SozlesmeTarihiEksik = {
  santiye_id: string;
  is_adi: string;
  created_at: string;
  gunGecti: number; // 7 günlük süreyi kaç gün aştı (0 = bugün doldu)
};
export async function getSozlesmeTarihiEksikleri(): Promise<SozlesmeTarihiEksik[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("santiyeler")
    .select("id, is_adi, created_at, sozlesme_tarihi, durum")
    .eq("durum", "aktif")
    .is("sozlesme_tarihi", null);
  if (error) return [];
  const HATIRLATMA_GUN = 7;
  const bugun = Date.now();
  const sonuc: SozlesmeTarihiEksik[] = [];
  for (const s of (data ?? []) as { id: string; is_adi: string; created_at: string | null }[]) {
    if (!s.created_at) continue;
    const gecen = Math.floor((bugun - new Date(s.created_at).getTime()) / 86400000);
    if (gecen < HATIRLATMA_GUN) continue; // 7 gün dolmadı → henüz uyarma
    sonuc.push({ santiye_id: s.id, is_adi: s.is_adi, created_at: s.created_at, gunGecti: gecen - HATIRLATMA_GUN });
  }
  return sonuc.sort((a, b) => b.gunGecti - a.gunGecti);
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
