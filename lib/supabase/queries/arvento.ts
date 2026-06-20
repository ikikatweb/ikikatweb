// Arvento araç çalışma raporu sorguları
import { createClient } from "@/lib/supabase/client";
import type { AracArventoRapor, AracArventoGuzergah } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// ===== Güzergah (Mesafe Bilgisi / rota) sorguları =====

// Güzergah verisi olan tarihler (yeni → eski)
export async function getGuzergahTarihler(limit = 60): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_guzergah")
    .select("rapor_tarihi")
    .order("rapor_tarihi", { ascending: false })
    .limit(2000);
  if (error) return [];
  const set = new Set<string>();
  for (const r of (data ?? []) as { rapor_tarihi: string }[]) set.add(r.rapor_tarihi);
  return Array.from(set).slice(0, limit);
}

// Belirli bir günün tüm güzergah kayıtları (plaka bazında)
export async function getGuzergahByTarih(tarih: string): Promise<AracArventoGuzergah[]> {
  if (!tarih) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_guzergah")
    .select("*")
    .eq("rapor_tarihi", tarih)
    .order("plaka");
  if (error) throw error;
  return (data ?? []) as AracArventoGuzergah[];
}

// Tarih aralığındaki güzergahlar — aynı plakanın TÜM günlerinin noktaları birleştirilir
// (dönem boyunca aracın gittiği tüm yollar tek güzergah olarak). bas===bitis → tek gün.
export async function getGuzergahByRange(bas: string, bitis: string): Promise<AracArventoGuzergah[]> {
  if (!bas || !bitis) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_guzergah")
    .select("*")
    .gte("rapor_tarihi", bas)
    .lte("rapor_tarihi", bitis)
    .order("rapor_tarihi")
    .order("plaka");
  if (error) throw error;
  const rows = (data ?? []) as AracArventoGuzergah[];
  const m = new Map<string, AracArventoGuzergah>();
  for (const r of rows) {
    const ex = m.get(r.plaka);
    if (!ex) {
      m.set(r.plaka, { ...r, noktalar: [...(r.noktalar ?? [])] });
    } else {
      ex.noktalar = [...ex.noktalar, ...(r.noktalar ?? [])];
      ex.toplam_mesafe = (ex.toplam_mesafe ?? 0) + (r.toplam_mesafe ?? 0);
      ex.nokta_sayisi = (ex.nokta_sayisi ?? 0) + (r.noktalar?.length ?? 0);
      if (!ex.arac_sinifi && r.arac_sinifi) ex.arac_sinifi = r.arac_sinifi;
      if (!ex.marka && r.marka) ex.marka = r.marka;
      if (!ex.model && r.model) ex.model = r.model;
    }
  }
  return Array.from(m.values());
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

// Tarih aralığındaki tüm araç kayıtları (çok günlük damper toplamı için)
export async function getArventoRaporByRange(bas: string, bitis: string): Promise<AracArventoRapor[]> {
  if (!bas || !bitis) return [];
  const supabase = getSupabase();
  const PARCA = 1000;
  let offset = 0;
  const tum: AracArventoRapor[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("arac_arvento_rapor")
      .select("*")
      .gte("rapor_tarihi", bas)
      .lte("rapor_tarihi", bitis)
      .order("rapor_tarihi", { ascending: true })
      .range(offset, offset + PARCA - 1);
    if (error) throw error;
    const parca = (data ?? []) as AracArventoRapor[];
    tum.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return tum;
}

// Rapor verisinin (km/çalışma/damper) bu tarih aralığında EN SON yazıldığı an.
// Rapor senkronu her yazımda created_at'i günceller → haritada "Son güncelleme" olarak gösterilir
// (canlı konumun değil, RAPOR verisinin tazeliği). Veri yoksa null.
export async function getArventoRaporSonGuncelleme(bas: string, bitis: string): Promise<Date | null> {
  if (!bas || !bitis) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("arac_arvento_rapor")
    .select("created_at")
    .gte("rapor_tarihi", bas)
    .lte("rapor_tarihi", bitis)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.created_at) return null;
  const d = new Date(data.created_at as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Plaka başına GENEL ORTALAMA (tüm günler) — km ve damper indirme ortalaması
export type ArventoOrtalama = { ortKm: number; ortDamper: number; gun: number; surucu: string | null };
export async function getArventoOrtalamalar(): Promise<Map<string, ArventoOrtalama>> {
  const supabase = getSupabase();
  const PARCA = 1000;
  let offset = 0;
  const topla = new Map<string, { km: number; damper: number; gun: number; surucu: string | null }>();
  while (true) {
    const { data, error } = await supabase
      .from("arac_arvento_rapor")
      .select("plaka, mesafe_km, damper_sayisi, surucu")
      .range(offset, offset + PARCA - 1);
    if (error) break;
    const parca = (data ?? []) as { plaka: string; mesafe_km: number | null; damper_sayisi: number | null; surucu: string | null }[];
    for (const r of parca) {
      const k = r.plaka;
      const t = topla.get(k) ?? { km: 0, damper: 0, gun: 0, surucu: null };
      t.km += r.mesafe_km ?? 0;
      t.damper += r.damper_sayisi ?? 0;
      t.gun += 1;
      if (!t.surucu && r.surucu) t.surucu = r.surucu; // temsilî şoför (fallback)
      topla.set(k, t);
    }
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  const out = new Map<string, ArventoOrtalama>();
  for (const [k, t] of topla) {
    out.set(k, { ortKm: t.gun ? t.km / t.gun : 0, ortDamper: t.gun ? t.damper / t.gun : 0, gun: t.gun, surucu: t.surucu });
  }
  return out;
}

// Ortalama hesabı için HAM günlük kayıtlar (plaka × gün bazında km/damper).
// Client tarafında km eşiği gibi filtrelerle ortalama yeniden hesaplanabilsin diye
// günleri aggregate ETMEDEN döner.
export type ArventoHamKayit = { plaka: string; mesafe_km: number | null; damper_sayisi: number | null; surucu: string | null };
export async function getArventoHamKayitlar(): Promise<ArventoHamKayit[]> {
  const supabase = getSupabase();
  const PARCA = 1000;
  let offset = 0;
  const tum: ArventoHamKayit[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("arac_arvento_rapor")
      .select("plaka, mesafe_km, damper_sayisi, surucu")
      .range(offset, offset + PARCA - 1);
    if (error) break;
    const parca = (data ?? []) as ArventoHamKayit[];
    tum.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 100000) break;
  }
  return tum;
}

// Ham kayıtlardan plaka başına ortalama hesapla.
// kmEsik > 0 ise, mesafe_km > kmEsik olan GÜNLER ortalamaya HİÇ katılmaz (outlier eleme).
export function hesaplaOrtalamalar(
  ham: ArventoHamKayit[],
  kmEsik = 0,
): Map<string, ArventoOrtalama> {
  const topla = new Map<string, { km: number; damper: number; gun: number; surucu: string | null }>();
  for (const r of ham) {
    const km = r.mesafe_km ?? 0;
    // Eşik aşıldıysa bu günü tamamen atla (ne km'ye ne gün sayısına eklenir)
    if (kmEsik > 0 && km > kmEsik) continue;
    const t = topla.get(r.plaka) ?? { km: 0, damper: 0, gun: 0, surucu: null };
    t.km += km;
    t.damper += r.damper_sayisi ?? 0;
    t.gun += 1;
    if (!t.surucu && r.surucu) t.surucu = r.surucu;
    topla.set(r.plaka, t);
  }
  const out = new Map<string, ArventoOrtalama>();
  for (const [k, t] of topla) {
    out.set(k, { ortKm: t.gun ? t.km / t.gun : 0, ortDamper: t.gun ? t.damper / t.gun : 0, gun: t.gun, surucu: t.surucu });
  }
  return out;
}

// Plaka normalizasyonu (Arvento ile araclar tablosu plakalarını eşleştirmek için)
export function plakaNorm(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Plaka → Şantiye eşlemesi: araç puantajdan (o tarihteki kayıt), yoksa aracın atanmış şantiyesi.
export type PlakaSantiye = { santiyeId: string | null; santiyeAdi: string; marka: string | null; model: string | null; cinsi: string | null; sayacTipi: "km" | "saat" | null; sekmeler: string[] | null };
export async function getPlakaSantiyeMap(tarih: string): Promise<Map<string, PlakaSantiye>> {
  const supabase = getSupabase();
  const out = new Map<string, PlakaSantiye>();
  const [araclarRes, santiyelerRes, puantajRes] = await Promise.all([
    supabase.from("araclar").select("id, plaka, santiye_id, marka, model, cinsi, sayac_tipi, arvento_sekmeler"),
    supabase.from("santiyeler").select("id, is_adi"),
    tarih ? supabase.from("arac_puantaj").select("arac_id, santiye_id").eq("tarih", tarih) : Promise.resolve({ data: [] }),
  ]);
  const araclar = (araclarRes.data ?? []) as { id: string; plaka: string; santiye_id: string | null; marka: string | null; model: string | null; cinsi: string | null; sayac_tipi: "km" | "saat" | null; arvento_sekmeler: string[] | null }[];
  const santiyeler = (santiyelerRes.data ?? []) as { id: string; is_adi: string }[];
  const puantaj = (puantajRes.data ?? []) as { arac_id: string; santiye_id: string }[];
  const sAd = new Map(santiyeler.map((s) => [s.id, s.is_adi]));
  // O tarihte araç hangi şantiyede puantajlı (ilk kayıt)
  const puMap = new Map<string, string>();
  for (const p of puantaj) if (p.arac_id && !puMap.has(p.arac_id)) puMap.set(p.arac_id, p.santiye_id);
  for (const a of araclar) {
    const sid = puMap.get(a.id) ?? a.santiye_id ?? null;
    out.set(plakaNorm(a.plaka), { santiyeId: sid, santiyeAdi: sid ? (sAd.get(sid) ?? "—") : "Atanmamış", marka: a.marka, model: a.model, cinsi: a.cinsi, sayacTipi: a.sayac_tipi, sekmeler: Array.isArray(a.arvento_sekmeler) ? a.arvento_sekmeler : null });
  }
  return out;
}

// Atama tablosu için TÜM araçlar (plaka, sınıf, mevcut sekme ataması).
export type AracAtama = { id: string; plaka: string; marka: string | null; model: string | null; cinsi: string | null; sayacTipi: "km" | "saat" | null; sekmeler: string[] | null };
export async function getAraclarAtama(): Promise<AracAtama[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("araclar")
    .select("id, plaka, marka, model, cinsi, sayac_tipi, arvento_sekmeler")
    .eq("tip", "ozmal") // yalnız özmal araçlar (kiralıklar hariç)
    .order("plaka");
  const rows = (data ?? []) as { id: string; plaka: string; marka: string | null; model: string | null; cinsi: string | null; sayac_tipi: "km" | "saat" | null; arvento_sekmeler: string[] | null }[];
  return rows.map((a) => ({ id: a.id, plaka: a.plaka, marka: a.marka, model: a.model, cinsi: a.cinsi, sayacTipi: a.sayac_tipi, sekmeler: Array.isArray(a.arvento_sekmeler) ? a.arvento_sekmeler : null }));
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
