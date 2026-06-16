// Arvento araç çalışma raporu sorguları
import { createClient } from "@/lib/supabase/client";
import type { AracArventoRapor } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Mevcut rapor tarihleri (yeni → eski), tarih seçici için
export async function getArventoTarihler(limit = 60): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_rapor")
    .select("rapor_tarihi")
    .order("rapor_tarihi", { ascending: false })
    .limit(2000);
  if (error) return [];
  const set = new Set<string>();
  for (const r of (data ?? []) as { rapor_tarihi: string }[]) set.add(r.rapor_tarihi);
  return Array.from(set).slice(0, limit);
}

// Belirli bir günün araç kayıtları
export async function getArventoRaporByTarih(tarih: string): Promise<AracArventoRapor[]> {
  if (!tarih) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_rapor")
    .select("*")
    .eq("rapor_tarihi", tarih)
    .order("mesafe_km", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as AracArventoRapor[];
}

// Plaka başına GENEL ORTALAMA (tüm günler) — km ve damper indirme ortalaması
export type ArventoOrtalama = { ortKm: number; ortDamper: number; gun: number };
export async function getArventoOrtalamalar(): Promise<Map<string, ArventoOrtalama>> {
  const supabase = getSupabase();
  const PARCA = 1000;
  let offset = 0;
  const topla = new Map<string, { km: number; damper: number; gun: number }>();
  while (true) {
    const { data, error } = await supabase
      .from("arac_arvento_rapor")
      .select("plaka, mesafe_km, damper_sayisi")
      .range(offset, offset + PARCA - 1);
    if (error) break;
    const parca = (data ?? []) as { plaka: string; mesafe_km: number | null; damper_sayisi: number | null }[];
    for (const r of parca) {
      const k = r.plaka;
      const t = topla.get(k) ?? { km: 0, damper: 0, gun: 0 };
      t.km += r.mesafe_km ?? 0;
      t.damper += r.damper_sayisi ?? 0;
      t.gun += 1;
      topla.set(k, t);
    }
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  const out = new Map<string, ArventoOrtalama>();
  for (const [k, t] of topla) {
    out.set(k, { ortKm: t.gun ? t.km / t.gun : 0, ortDamper: t.gun ? t.damper / t.gun : 0, gun: t.gun });
  }
  return out;
}

// Plaka normalizasyonu (Arvento ile araclar tablosu plakalarını eşleştirmek için)
export function plakaNorm(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Plaka → Şantiye eşlemesi: araç puantajdan (o tarihteki kayıt), yoksa aracın atanmış şantiyesi.
export type PlakaSantiye = { santiyeId: string | null; santiyeAdi: string; marka: string | null; model: string | null };
export async function getPlakaSantiyeMap(tarih: string): Promise<Map<string, PlakaSantiye>> {
  const supabase = getSupabase();
  const out = new Map<string, PlakaSantiye>();
  const [araclarRes, santiyelerRes, puantajRes] = await Promise.all([
    supabase.from("araclar").select("id, plaka, santiye_id, marka, model"),
    supabase.from("santiyeler").select("id, is_adi"),
    tarih ? supabase.from("arac_puantaj").select("arac_id, santiye_id").eq("tarih", tarih) : Promise.resolve({ data: [] }),
  ]);
  const araclar = (araclarRes.data ?? []) as { id: string; plaka: string; santiye_id: string | null; marka: string | null; model: string | null }[];
  const santiyeler = (santiyelerRes.data ?? []) as { id: string; is_adi: string }[];
  const puantaj = (puantajRes.data ?? []) as { arac_id: string; santiye_id: string }[];
  const sAd = new Map(santiyeler.map((s) => [s.id, s.is_adi]));
  // O tarihte araç hangi şantiyede puantajlı (ilk kayıt)
  const puMap = new Map<string, string>();
  for (const p of puantaj) if (p.arac_id && !puMap.has(p.arac_id)) puMap.set(p.arac_id, p.santiye_id);
  for (const a of araclar) {
    const sid = puMap.get(a.id) ?? a.santiye_id ?? null;
    out.set(plakaNorm(a.plaka), { santiyeId: sid, santiyeAdi: sid ? (sAd.get(sid) ?? "—") : "Atanmamış", marka: a.marka, model: a.model });
  }
  return out;
}

// En güncel rapor tarihini döndür (dashboard widget için)
export async function getArventoSonTarih(): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_rapor")
    .select("rapor_tarihi")
    .order("rapor_tarihi", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { rapor_tarihi: string } | null)?.rapor_tarihi ?? null;
}
