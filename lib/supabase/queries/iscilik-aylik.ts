// İşçilik takibi aylık veri sorguları
import { createClient } from "@/lib/supabase/client";

function getSupabase() {
  return createClient();
}

export async function getAylikVeriler(iscilikTakibiId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("iscilik_aylik")
    .select("*")
    .eq("iscilik_takibi_id", iscilikTakibiId)
    .order("sira_no", { ascending: true });

  if (error) throw error;
  return data;
}

export async function createAylikVeri(
  iscilikTakibiId: string,
  siraNo: number,
  aitOlduguAy: string
) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("iscilik_aylik")
    .insert({
      iscilik_takibi_id: iscilikTakibiId,
      sira_no: siraNo,
      ait_oldugu_ay: aitOlduguAy,
      alt_yuklenici_tutar: 0,
      yuklenici_tutar: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateAylikVeri(
  id: string,
  updates: Record<string, unknown>
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("iscilik_aylik")
    .update(updates)
    .eq("id", id);

  if (error) throw error;

  // Bildirim — sadece gerçek bir rakam girişinde, ait_oldugu_ay ile birlikte
  try {
    // Anlamlı tutar değişikliği var mı kontrol et
    const tutarAlanlari: { key: string; label: string }[] = [
      { key: "alt_yuklenici_tutar", label: "Taşeron Veri Girişi" },
      { key: "yuklenici_tutar", label: "Yüklenici Veri Girişi" },
    ];
    const girilenTutarlar = tutarAlanlari.filter(({ key }) => {
      const v = updates[key];
      return typeof v === "number" && v > 0;
    });
    if (girilenTutarlar.length === 0) return; // sıfır veya tutar yok → bildirim atma

    // Aylık satırı + üst takip + şantiye bilgisini çek
    const { data: aylikRow } = await supabase
      .from("iscilik_aylik")
      .select("ait_oldugu_ay, iscilik_takibi_id, alt_yuklenici_tutar, yuklenici_tutar")
      .eq("id", id)
      .maybeSingle();
    if (!aylikRow) return;

    const { data: takip } = await supabase
      .from("iscilik_takibi")
      .select("santiye_id, santiyeler(is_adi)")
      .eq("id", aylikRow.iscilik_takibi_id)
      .maybeSingle();
    const santiye = (takip as { santiyeler?: { is_adi?: string } } | null)?.santiyeler;
    const santiyeAd = santiye?.is_adi ? String(santiye.is_adi).slice(0, 50) : "?";
    const santiyeId = (takip as { santiye_id?: string } | null)?.santiye_id;

    // Bildirim gövdesi — girilen tutarlar + ait olduğu ay
    const formatTL = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " ₺";
    const govdeKisimlari = girilenTutarlar.map(({ key, label }) => {
      const v = (updates[key] as number);
      return `${label}: ${formatTL(v)}`;
    });
    govdeKisimlari.push(`Ay: ${aylikRow.ait_oldugu_ay}`);

    const { bildirimGonder } = await import("@/lib/bildirim");
    bildirimGonder({
      baslik: `📊 İşçilik Takibi — ${santiyeAd}`,
      govde: govdeKisimlari.join(" · "),
      url: "/dashboard/iscilik-takibi",
      tag: "iscilik-takibi",
      santiye_id: santiyeId ?? null,
    });
  } catch { /* sessiz */ }
}

export async function deleteAylikVeri(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("iscilik_aylik")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
