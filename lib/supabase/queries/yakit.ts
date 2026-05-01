// Yakıt yönetimi sorguları
// - Araç yakıt dağıtımı (arac_yakit)
// - Depo yakıt alımları (yakit_alim)
// - Şantiyeler arası virman (yakit_virman)
// - Araç cinsi + sayaç tipi bazlı tüketim limitleri (arac_cinsi_yakit_limit)
import { createClient } from "@/lib/supabase/client";
import type {
  AracYakit,
  YakitAlim,
  YakitVirman,
  AracCinsiYakitLimit,
} from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// ==================== ARAÇ YAKIT ====================

// Tarih aralığındaki araç yakıt kayıtlarını getir.
// santiyeIds null ise tüm şantiyeler, array ise sadece o şantiyeler.
// Dönüş: AracYakit[] (created_by_ad join'lenmiş değildir; tüketici tarafta kullanici map'le resolve edilir)
export async function getAracYakitlarByRange(
  santiyeIds: string[] | null,
  baslangic: string,
  bitis: string,
): Promise<AracYakit[]> {
  const supabase = getSupabase();
  // Supabase varsayılan 1000 satır limiti — pagination ile tamamını getir
  const PARCA = 1000;
  const tum: AracYakit[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from("arac_yakit")
      .select("*")
      .gte("tarih", baslangic)
      .lte("tarih", bitis)
      .order("tarih", { ascending: false })
      .order("saat", { ascending: false })
      .range(offset, offset + PARCA - 1);
    if (santiyeIds && santiyeIds.length > 0) {
      q = q.in("santiye_id", santiyeIds);
    }
    const { data, error } = await q;
    if (error) throw error;
    const parca = (data ?? []) as AracYakit[];
    tum.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return tum;
}

// Bir aracın tüm yakıt kayıtlarını getir (genel ortalama hesaplaması için)
export async function getTumAracYakitByArac(
  aracIds: string[],
): Promise<AracYakit[]> {
  if (aracIds.length === 0) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_yakit")
    .select("*")
    .in("arac_id", aracIds)
    .order("tarih", { ascending: true })
    .order("saat", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AracYakit[];
}

// Bir aracın en son kaydını getir (tarih+saat DESC, ilk satır)
export async function getSonAracYakit(aracId: string): Promise<AracYakit | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_yakit")
    .select("*")
    .eq("arac_id", aracId)
    .order("tarih", { ascending: false })
    .order("saat", { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as AracYakit[];
  return rows[0] ?? null;
}

export async function insertAracYakit(data: {
  arac_id: string;
  santiye_id: string;
  tarih: string;
  saat: string;
  km_saat: number;
  miktar_lt: number;
  depo_full?: boolean;
  notu: string | null;
  created_by: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("arac_yakit").insert(data);
  if (error) throw error;

  // Push bildirim — araç yakıt verme
  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    const [{ data: arac }, { data: santiye }] = await Promise.all([
      supabase.from("araclar").select("plaka, marka, model, sayac_tipi").eq("id", data.arac_id).maybeSingle(),
      supabase.from("santiyeler").select("is_adi").eq("id", data.santiye_id).maybeSingle(),
    ]);
    const aracAd = arac
      ? `${arac.plaka ?? ""} ${arac.marka ?? ""} ${arac.model ?? ""}`.trim() || "?"
      : "?";
    const santiyeAd = santiye?.is_adi ? String(santiye.is_adi).slice(0, 40) : "?";
    const birim = arac?.sayac_tipi === "saat" ? "s" : "km";
    // arac_yakit insert'inde döndürülen id yok (data tipi void), bu yüzden insert'ten select() çekmeliyiz.
    // Şimdilik bildirim gönderdiğimiz için kaynak_id'yi atlıyoruz; ileride gerekirse buraya da ekleriz.
    bildirimGonder({
      baslik: `⛽ Araç Yakıt — ${aracAd.slice(0, 50)}`,
      govde: `${data.miktar_lt.toLocaleString("tr-TR")} Lt · ${data.km_saat.toLocaleString("tr-TR")} ${birim} · ${santiyeAd}${data.depo_full ? " · Depo Full" : ""}`,
      url: `/dashboard/yakit?santiye=${data.santiye_id}`,
      tag: "yakit",
      santiye_id: data.santiye_id,
    });
  } catch { /* sessiz */ }
}

export async function updateAracYakit(id: string, data: {
  arac_id: string;
  santiye_id: string;
  tarih: string;
  km_saat: number;
  miktar_lt: number;
  depo_full?: boolean;
  notu: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("arac_yakit").update(data).eq("id", id);
  if (error) throw error;
}

export async function deleteAracYakit(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("arac_yakit").delete().eq("id", id);
  if (error) throw error;
}

// ==================== DEPO ALIM ====================

export async function getYakitAlimlarByRange(
  santiyeIds: string[] | null,
  baslangic: string,
  bitis: string,
): Promise<YakitAlim[]> {
  const supabase = getSupabase();
  const PARCA = 1000;
  const tum: YakitAlim[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from("yakit_alim")
      .select("*")
      .gte("tarih", baslangic)
      .lte("tarih", bitis)
      .order("tarih", { ascending: false })
      .order("saat", { ascending: false })
      .range(offset, offset + PARCA - 1);
    if (santiyeIds && santiyeIds.length > 0) {
      q = q.in("santiye_id", santiyeIds);
    }
    const { data, error } = await q;
    if (error) throw error;
    const parca = (data ?? []) as YakitAlim[];
    tum.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return tum;
}

export async function insertYakitAlim(data: {
  santiye_id: string;
  tarih: string;
  saat: string;
  tedarikci_firma: string;
  miktar_lt: number;
  birim_fiyat: number;
  notu: string | null;
  created_by: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("yakit_alim").insert(data);
  if (error) throw error;

  // Push bildirim
  try {
    const { bildirimGonder, formatTL } = await import("@/lib/bildirim");
    const { data: santiye } = await supabase
      .from("santiyeler")
      .select("is_adi")
      .eq("id", data.santiye_id)
      .maybeSingle();
    const santiyeAd = santiye?.is_adi ? String(santiye.is_adi).slice(0, 40) : "?";
    const toplam = data.miktar_lt * data.birim_fiyat;
    bildirimGonder({
      baslik: `⛽ Yeni Yakıt Alımı — ${santiyeAd}`,
      govde: `${data.miktar_lt.toLocaleString("tr-TR")} Lt · ${formatTL(toplam)} · ${data.tedarikci_firma}`,
      url: `/dashboard/yakit?santiye=${data.santiye_id}`,
      tag: "yakit",
    });
  } catch { /* sessiz */ }
}

export async function updateYakitAlim(id: string, data: {
  santiye_id: string;
  tarih: string;
  tedarikci_firma: string;
  miktar_lt: number;
  birim_fiyat: number;
  notu: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("yakit_alim").update(data).eq("id", id);
  if (error) throw error;
}

export async function deleteYakitAlim(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("yakit_alim").delete().eq("id", id);
  if (error) throw error;
}

// ==================== VIRMAN ====================

export async function getYakitVirmanlarByRange(
  baslangic: string,
  bitis: string,
): Promise<YakitVirman[]> {
  const supabase = getSupabase();
  const PARCA = 1000;
  const tum: YakitVirman[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("yakit_virman")
      .select("*")
      .gte("tarih", baslangic)
      .lte("tarih", bitis)
      .order("tarih", { ascending: false })
      .order("saat", { ascending: false })
      .range(offset, offset + PARCA - 1);
    if (error) throw error;
    const parca = (data ?? []) as YakitVirman[];
    tum.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return tum;
}

export async function insertYakitVirman(data: {
  gonderen_santiye_id: string;
  alan_santiye_id: string;
  tarih: string;
  saat: string;
  miktar_lt: number;
  notu: string | null;
  created_by: string | null;
}): Promise<void> {
  if (data.gonderen_santiye_id === data.alan_santiye_id) {
    throw new Error("Gönderen ve alan şantiye aynı olamaz.");
  }
  const supabase = getSupabase();
  const { error } = await supabase.from("yakit_virman").insert(data);
  if (error) throw error;

  // Push bildirim — şantiye yakıt virmanı
  try {
    const { bildirimGonder } = await import("@/lib/bildirim");
    const [{ data: gonderen }, { data: alan }] = await Promise.all([
      supabase.from("santiyeler").select("is_adi").eq("id", data.gonderen_santiye_id).maybeSingle(),
      supabase.from("santiyeler").select("is_adi").eq("id", data.alan_santiye_id).maybeSingle(),
    ]);
    const gonderenAd = gonderen?.is_adi ? String(gonderen.is_adi).slice(0, 30) : "?";
    const alanAd = alan?.is_adi ? String(alan.is_adi).slice(0, 30) : "?";
    bildirimGonder({
      baslik: `🔄 Yakıt Virmanı`,
      govde: `${data.miktar_lt.toLocaleString("tr-TR")} Lt · ${gonderenAd} → ${alanAd}`,
      url: `/dashboard/yakit`,
      tag: "yakit",
      santiye_id: data.gonderen_santiye_id,
    });
  } catch { /* sessiz */ }
}

export async function updateYakitVirman(id: string, data: {
  gonderen_santiye_id: string;
  alan_santiye_id: string;
  tarih: string;
  miktar_lt: number;
  notu: string | null;
}): Promise<void> {
  if (data.gonderen_santiye_id === data.alan_santiye_id) {
    throw new Error("Gönderen ve alan şantiye aynı olamaz.");
  }
  const supabase = getSupabase();
  const { error } = await supabase.from("yakit_virman").update(data).eq("id", id);
  if (error) throw error;
}

export async function deleteYakitVirman(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("yakit_virman").delete().eq("id", id);
  if (error) throw error;
}

// ==================== LIMIT ====================

export async function getAracCinsiYakitLimitler(): Promise<AracCinsiYakitLimit[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_cinsi_yakit_limit")
    .select("*")
    .order("arac_cinsi", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AracCinsiYakitLimit[];
}

export async function upsertAracCinsiYakitLimit(data: {
  arac_cinsi: string;
  sayac_tipi: "km" | "saat";
  alt_sinir: number;
  ust_sinir: number;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_cinsi_yakit_limit")
    .upsert(
      {
        ...data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "arac_cinsi,sayac_tipi" },
    );
  if (error) throw error;
}

export async function deleteAracCinsiYakitLimit(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_cinsi_yakit_limit")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
