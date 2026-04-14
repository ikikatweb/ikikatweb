// Araç Özet Rapor sorguları
// - Kira bedeli geçmişi (en güncel tarife + önceki tarife)
// - Aylık puantaj override'ları
import { createClient } from "@/lib/supabase/client";
import type { AracKiraBedeli, AracPuantajOverride } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Belirtilen araçlar için tüm kira bedeli geçmişini getir
// Her araç için: [aktif, önceki, ...] şeklinde en yeniden eskiye sıralanmış
export async function getAracKiraBedelleri(
  aracIds: string[]
): Promise<Map<string, AracKiraBedeli[]>> {
  if (aracIds.length === 0) return new Map();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_kira_bedeli")
    .select("*")
    .in("arac_id", aracIds)
    .order("gecerli_tarih", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const m = new Map<string, AracKiraBedeli[]>();
  for (const r of (data ?? []) as AracKiraBedeli[]) {
    if (!m.has(r.arac_id)) m.set(r.arac_id, []);
    m.get(r.arac_id)!.push(r);
  }
  return m;
}

// Yeni kira bedeli kaydet (geçmişe yeni satır ekler)
export async function upsertAracKiraBedeli(
  aracId: string,
  aylikBedel: number,
  gecerliTarih: string,
  kullaniciId?: string | null
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_kira_bedeli")
    .insert({
      arac_id: aracId,
      aylik_bedel: aylikBedel,
      gecerli_tarih: gecerliTarih,
      created_by: kullaniciId ?? null,
    });
  if (error) throw error;
}

// Mevcut kira bedeli kaydını güncelle
export async function updateAracKiraBedeli(
  id: string,
  aylikBedel: number,
  gecerliTarih: string
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_kira_bedeli")
    .update({
      aylik_bedel: aylikBedel,
      gecerli_tarih: gecerliTarih,
    })
    .eq("id", id);
  if (error) throw error;
}

// Kira bedeli kaydını sil
export async function deleteAracKiraBedeli(id: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_kira_bedeli")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Belirtilen ay için özet override'ları getir (santiye_id + yil + ay bazında)
export async function getAracOzetOverrides(
  santiyeId: string,
  yil: number,
  ay: number
): Promise<Map<string, AracPuantajOverride>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_puantaj_override")
    .select("*")
    .eq("santiye_id", santiyeId)
    .eq("yil", yil)
    .eq("ay", ay);

  if (error) throw error;

  const m = new Map<string, AracPuantajOverride>();
  for (const r of (data ?? []) as AracPuantajOverride[]) {
    m.set(r.arac_id, r);
  }
  return m;
}

// Tarih aralığı içinde (birden fazla ay olabilir) tüm override'ları getir.
// Dönüş: arac_id -> [override1, override2, ...] (her ay için ayrı kayıt)
export async function getAracOzetOverridesByRange(
  santiyeId: string,
  baslangicYil: number,
  baslangicAy: number,
  bitisYil: number,
  bitisAy: number
): Promise<Map<string, AracPuantajOverride[]>> {
  const supabase = getSupabase();
  // yil*12+ay bazlı aralık
  const baslangicKey = baslangicYil * 12 + baslangicAy;
  const bitisKey = bitisYil * 12 + bitisAy;
  const { data, error } = await supabase
    .from("arac_puantaj_override")
    .select("*")
    .eq("santiye_id", santiyeId);

  if (error) throw error;

  const m = new Map<string, AracPuantajOverride[]>();
  for (const r of (data ?? []) as AracPuantajOverride[]) {
    const key = r.yil * 12 + r.ay;
    if (key < baslangicKey || key > bitisKey) continue;
    if (!m.has(r.arac_id)) m.set(r.arac_id, []);
    m.get(r.arac_id)!.push(r);
  }
  return m;
}

// Override kaydı: upsert (arac_id + santiye_id + donem_baslangic UNIQUE)
// donemBaslangic ile aynı aracın aynı ayda farklı kira dönemleri ayrı override alabilir.
export async function upsertAracOzetOverride(
  aracId: string,
  santiyeId: string,
  yil: number,
  ay: number,
  donemBaslangic: string,
  alanlar: {
    calisti?: number | null;
    yarim_gun?: number | null;
    calismadi?: number | null;
    arizali?: number | null;
    operator_yok?: number | null;
    tatil?: number | null;
  },
  kullaniciId?: string | null
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("arac_puantaj_override")
    .upsert(
      {
        arac_id: aracId,
        santiye_id: santiyeId,
        yil,
        ay,
        donem_baslangic: donemBaslangic,
        ...alanlar,
        updated_at: new Date().toISOString(),
        updated_by: kullaniciId ?? null,
      },
      { onConflict: "arac_id,santiye_id,donem_baslangic" }
    );
  if (error) throw error;
}
