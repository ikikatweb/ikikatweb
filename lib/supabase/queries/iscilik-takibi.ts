// İşçilik takibi sorguları - Şantiye bazlı prim takibi
import { createClient } from "@/lib/supabase/client";

function getSupabase() {
  return createClient();
}

export async function getIscilikTakibi(dahilSilinen = false) {
  const supabase = getSupabase();
  let query = supabase
    .from("iscilik_takibi")
    .select("*, santiyeler(sira_no, is_adi, is_grubu, sozlesme_bedeli, sure_uzatimi, is_suresi, is_bitim_tarihi, isyeri_teslim_tarihi, gecici_kabul_tarihi, kesin_kabul_tarihi, tasfiye_tarihi, devir_tarihi, yuklenici_firma_id, created_at)")
    .order("created_at", { ascending: true });

  if (!dahilSilinen) {
    query = query.or("silindi.is.null,silindi.eq.false");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Tüm şantiyelerin keşif artışı değerlerini Map olarak getir (santiyeler listesi için)
// Pagination ile 1000+ kayıt destekle, silindi filtresi yok (her satırı oku)
export async function getKesifArtisMap(): Promise<Map<string, number>> {
  const supabase = getSupabase();
  const map = new Map<string, number>();
  const PARCA = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("iscilik_takibi")
      .select("santiye_id, kesif_artisi")
      .range(offset, offset + PARCA - 1);
    if (error) throw error;
    const parca = (data ?? []) as { santiye_id: string; kesif_artisi: number | null }[];
    for (const row of parca) {
      if (row.kesif_artisi != null && row.kesif_artisi > 0) {
        map.set(row.santiye_id, row.kesif_artisi);
      }
    }
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return map;
}

export async function getSilinenIscilikTakibi() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("iscilik_takibi")
    .select("*, santiyeler(sira_no, is_adi, is_grubu, sozlesme_bedeli, sure_uzatimi, is_suresi, is_bitim_tarihi, isyeri_teslim_tarihi, gecici_kabul_tarihi, kesin_kabul_tarihi, tasfiye_tarihi, devir_tarihi, yuklenici_firma_id, created_at)")
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

  // Push bildirim — sadece anlamlı bir DEĞER girildiğinde gönder.
  // Yeni satır açma (ensureAktifSantiyeler) veya boş değer girme → bildirim YOK.
  // Aylık tutar girişlerinden (yatan_prim, toplam_son_veri_tutari) gelen senkronizasyon →
  // bildirim YOK çünkü asıl bildirim updateAylikVeri'den (rakam + ait olduğu ay birlikte) gidiyor.
  try {
    // Aylık senkron için kullanılan türemiş alanlar — bunlar update'te varsa bildirim atma
    const TUREMIS_ALANLAR = new Set(["yatan_prim", "toplam_son_veri_tutari"]);
    // updates içinde gerçek bir değer var mı? (null/undefined/boş string ise atla)
    const anlamliAlanlar = Object.entries(updates).filter(([k, v]) => {
      if (k === "updated_at" || k === "created_at") return false;
      if (TUREMIS_ALANLAR.has(k)) return false;
      if (v === null || v === undefined) return false;
      if (typeof v === "string" && v.trim() === "") return false;
      return true;
    });
    if (anlamliAlanlar.length === 0) return; // değer yok → bildirim atılmaz

    // Alan etiketleri (kullanıcıya gösterilecek isimler)
    const ALAN_LABELLER: Record<string, string> = {
      kesif_artisi: "Keşif Artışı",
      fiyat_farki: "Fiyat Farkı",
      yatan_prim: "Yatan Prim",
      taseron_veri_isleme_tarihi: "Taşeron Veri Girişi",
      son_veri_girisi_tarihi: "Yüklenici Son Veri Girişi",
      toplam_son_veri_tutari: "Toplam Son Veri Tutarı",
      iscilik_orani: "İşçilik Oranı",
      sure_text: "Süre Uzatımı",
      baslangic_tarihi: "Başlangıç Tarihi",
    };
    // Tarih alanları (YYYY-MM-DD'yi MM.YYYY veya DD.MM.YYYY olarak göster)
    const TARIH_ALANLARI = new Set(["taseron_veri_isleme_tarihi", "son_veri_girisi_tarihi", "baslangic_tarihi"]);
    // Para alanları (binlik ayraç + TL)
    const PARA_ALANLARI = new Set(["kesif_artisi", "fiyat_farki", "yatan_prim", "toplam_son_veri_tutari"]);

    function formatDeger(alan: string, deger: unknown): string {
      if (deger === null || deger === undefined) return "—";
      // Tarih: YYYY-MM-DD veya YYYY-MM-XX → MM.YYYY (kullanıcının istediği format)
      if (TARIH_ALANLARI.has(alan) && typeof deger === "string") {
        const m = deger.match(/^(\d{4})-(\d{2})/);
        if (m) return `${m[2]}.${m[1]}`;
        return deger;
      }
      if (PARA_ALANLARI.has(alan) && typeof deger === "number") {
        return deger.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " ₺";
      }
      return String(deger);
    }

    const govdeKisimlari = anlamliAlanlar.slice(0, 3).map(([k, v]) => {
      const label = ALAN_LABELLER[k] ?? k;
      return `${label}: ${formatDeger(k, v)}`;
    });

    const { bildirimGonder } = await import("@/lib/bildirim");
    const { data: santiye } = await supabase
      .from("santiyeler")
      .select("is_adi")
      .eq("id", santiyeId)
      .maybeSingle();
    const santiyeAd = santiye?.is_adi ? String(santiye.is_adi).slice(0, 50) : "?";
    bildirimGonder({
      baslik: `📊 İşçilik Takibi — ${santiyeAd}`,
      govde: govdeKisimlari.join(" · "),
      url: "/dashboard/iscilik-takibi",
      tag: "iscilik-takibi",
      santiye_id: santiyeId,
    });
  } catch { /* sessiz */ }
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
