// Arvento Tanımlamalar — eşik ayarları ORTAK (kullanıcı bazlı değil): tüm kullanıcılar
// aynı değerleri görür. Tek satırlık global kayıt (id='global'). Düzenleme yetkisi olan
// kullanıcılar değiştirebilir; diğerleri sadece görür.
import { createClient } from "@/lib/supabase/client";

export type ArventoAyarlar = {
  kmEsik: number;
  mukerrerDk: number;
  mukerrerYaricap: number; // mükerrer damper yarıçapı (m) — dakika ile BİRLİKTE şart
  canliYenilemeSn: number; // Canlı sekmesi otomatik yenileme aralığı (saniye)
  raporCekmeDk: number;    // Gerçek çalışma raporunun çekilme aralığı (dakika)
  guzergahTekrar: number;
  tekrarPencereSaat: number; // güzergah tekrar SÜRESİ (saat): eşik kadar geçiş bu süre içinde olursa yol çizilir; 0 = kapalı (zaman şartı yok). Ondalık olabilir (1.5 = 90 dk)
  gridMesafe: number;
  silindirTekrar: number;
  transitHiz: number; // REGLAJ/SERME omurgasında bu hızın (km/s) ÜSTÜndeki geçişler = transit (asfalta git-gel) sayılmaz; 0 = kapalı. (Sıkıştırma bu filtreyi KULLANMAZ — silindir yalnız kendi tekrar eşiğiyle çizilir.)
  reglajKalinlik: number;
  sermeKalinlik: number;
  silindirKalinlik: number;
  kamyonIziKalinlik: number; // Stabilize: kamyon izi (güzergah) çizgi kalınlığı — reglajdan AYRI
  reglajRenk: string;
  sermeRenk: string;
  silindirRenk: string;
  kamyonIziRenk: string;     // Stabilize: kamyon izi rengi — reglajdan AYRI
  ocakLat: number | null;    // Stabilize ocağı (yükleme noktası) — elle ayarlanmışsa; yoksa otomatik tespit
  ocakLng: number | null;
  ocakYaricap: number;       // "ocağa geldi" sayılma yarıçapı (m) — damper gerçek/arıza ayrımı için
  damperSyncBasSaat: number; // Damper API senkronu bu saatte BAŞLAR (0-23)
  damperSyncBitSaat: number; // ...ve bu saate kadar çalışır (dahil). Gece çalışılmıyorsa ör. 6-21.
  damperSyncPeriyotDk: number; // Damper senkron periyodu (dakika): son çekimden bu kadar süre geçmeden tekrar çekmez. Görev 5 dk'da bir tetiklenir; asıl sıklığı BU belirler.
  ekskavatorNoktaDk: number;   // Ekskavatör çalışma noktası kayıt sıklığı (dakika): kontak açıkken bu aralıkta bir konum makine_calisma_noktasi'na yazılır.
};

export const VARSAYILAN_AYARLAR: ArventoAyarlar = {
  kmEsik: 0,
  mukerrerDk: 0,
  mukerrerYaricap: 0,
  canliYenilemeSn: 45,
  raporCekmeDk: 6, // en az 6 (bir çekim döngüsü ~6 dk sürüyor; daha küçüğü hızlandırmaz)
  guzergahTekrar: 0,
  tekrarPencereSaat: 0,
  gridMesafe: 12,
  silindirTekrar: 0,
  transitHiz: 20,
  reglajKalinlik: 4,
  sermeKalinlik: 3,
  silindirKalinlik: 3,
  kamyonIziKalinlik: 3,
  reglajRenk: "#2563eb",
  sermeRenk: "#059669",
  silindirRenk: "#7c3aed",
  kamyonIziRenk: "#dc2626",
  ocakLat: null,
  ocakLng: null,
  ocakYaricap: 150,
  damperSyncBasSaat: 6,
  damperSyncBitSaat: 21,
  damperSyncPeriyotDk: 60,
  ekskavatorNoktaDk: 10,
};

const TABLO = "arvento_ayarlar";
const SATIR_ID = "global";

export async function getArventoAyarlar(): Promise<ArventoAyarlar> {
  const supabase = createClient();
  const { data, error } = await supabase.from(TABLO).select("*").eq("id", SATIR_ID).maybeSingle();
  if (error || !data) return VARSAYILAN_AYARLAR;
  return {
    kmEsik: data.km_esik ?? 0,
    mukerrerDk: data.mukerrer_dk ?? 0,
    mukerrerYaricap: data.mukerrer_yaricap ?? 0,
    canliYenilemeSn: data.canli_yenileme_sn ?? 45,
    raporCekmeDk: data.rapor_cekme_dk ?? 6,
    guzergahTekrar: data.guzergah_tekrar ?? 0,
    tekrarPencereSaat: data.tekrar_pencere_saat ?? 0, // kolon yoksa 0 (kapalı, geriye uyumlu)
    gridMesafe: data.grid_mesafe ?? 12,
    silindirTekrar: data.silindir_tekrar ?? 0,
    transitHiz: data.transit_hiz ?? 20,   // kolon yoksa varsayılan 20 (geriye uyumlu)
    reglajKalinlik: data.reglaj_kalinlik ?? 4,
    sermeKalinlik: data.serme_kalinlik ?? 3,
    silindirKalinlik: data.silindir_kalinlik ?? 3,
    kamyonIziKalinlik: data.kamyon_izi_kalinlik ?? 3,
    reglajRenk: data.reglaj_renk ?? "#2563eb",
    sermeRenk: data.serme_renk ?? "#059669",
    silindirRenk: data.silindir_renk ?? "#7c3aed",
    kamyonIziRenk: data.kamyon_izi_renk ?? "#dc2626",
    ocakLat: data.ocak_lat ?? null,   // kolon yoksa undefined → null (otomatik tespit devreye girer)
    ocakLng: data.ocak_lng ?? null,
    ocakYaricap: data.ocak_yaricap ?? 150,
    damperSyncBasSaat: data.damper_sync_bas_saat ?? 6,
    damperSyncBitSaat: data.damper_sync_bit_saat ?? 21,
    damperSyncPeriyotDk: data.damper_sync_periyot_dk ?? 60,
    ekskavatorNoktaDk: data.ekskavator_nokta_dk ?? 10,
  };
}

// ── Stabilize ocağı: GÜN BAZLI (geçerlilik tarihli) ────────────────────────────────────
// arvento_ocak(gecerli_tarih, lat, lng, yaricap): ocak "bu tarihten itibaren" geçerlidir. Belirli bir
// gün için, o güne ≤ olan EN SON kayıt kullanılır. Ocak ara sıra değişir → her değişiklikte o günün
// kaydı eklenir; geçmiş günler kendi (eski) ocaklarını korur, değişmez.
export async function getOcakForTarih(tarih: string): Promise<{ lat: number; lng: number; yaricap: number } | null> {
  if (!tarih) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("arvento_ocak")
    .select("lat, lng, yaricap")
    .lte("gecerli_tarih", tarih)
    .order("gecerli_tarih", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || data.lat == null || data.lng == null) return null;
  return { lat: data.lat as number, lng: data.lng as number, yaricap: (data.yaricap as number) ?? 150 };
}

// TÜM ocak kayıtları (yeni → eski). Operasyon/Tümü sekmeleri GÜN-BAZLI ocak çözümü için kullanır (her günün
// damperi KENDİ ocağıyla sınıflanır — stabilize özetiyle aynı). gecerli_tarih ≤ gün olan EN SON kayıt geçerlidir.
export async function getTumOcaklar(): Promise<{ gecerli_tarih: string; lat: number; lng: number; yaricap: number }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("arvento_ocak")
    .select("gecerli_tarih, lat, lng, yaricap")
    .order("gecerli_tarih", { ascending: false });
  if (error || !data) return [];
  return data
    .filter((o) => o.lat != null && o.lng != null)
    .map((o) => ({ gecerli_tarih: o.gecerli_tarih as string, lat: o.lat as number, lng: o.lng as number, yaricap: (o.yaricap as number) ?? 150 }));
}

// Ocağı belirli bir GÜN için kaydet (o tarihten itibaren geçerli). Tablo yoksa hata fırlatır → çağıran yakalar.
export async function setOcakForTarih(tarih: string, lat: number, lng: number, yaricap: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("arvento_ocak").upsert({ gecerli_tarih: tarih, lat, lng, yaricap });
  if (error) throw error;
}

// ── Stabilize ocağı GİRİŞİ: ÇİZGİ (kapı) — A(lat,lng)–B(lat2,lng2). Kamyon çizgisi bu kapıyı kestiğinde
// "girişten geçti" sayılır; geniş girişlerde uçları uzatılabilir. Okuma/yazma SUNUCU (service role) →
// RLS baypas. Gün bazlı (ocak gibi): belirli güne ≤ EN SON kayıt geçerlidir.
export type GirisCizgi = { lat: number; lng: number; lat2: number; lng2: number };

export async function getGirisForTarih(tarih: string): Promise<GirisCizgi | null> {
  if (!tarih) return null;
  try {
    const r = await fetch(`/api/arvento/giris?tarih=${encodeURIComponent(tarih)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.giris ?? null) as GirisCizgi | null;
  } catch { return null; }
}

export async function setGirisForTarih(tarih: string, lat: number, lng: number, lat2: number, lng2: number): Promise<void> {
  const r = await fetch("/api/arvento/giris", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tarih, lat, lng, lat2, lng2 }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error ?? "Kaydedilemedi"); }
}

// Stabilize ocağını ayrı kaydet (ana ayar snapshot'ından BAĞIMSIZ). Kolonlar henüz eklenmemişse
// (SQL çalıştırılmadıysa) hata fırlatır → çağıran tarafta yakalanıp kullanıcıya bildirilir; diğer
// ayarların kaydı bundan etkilenmez.
export async function setArventoOcak(lat: number, lng: number, yaricap: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLO).upsert({
    id: SATIR_ID, ocak_lat: lat, ocak_lng: lng, ocak_yaricap: yaricap,
  });
  if (error) throw error;
}

export async function setArventoAyarlar(a: ArventoAyarlar): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLO).upsert({
    id: SATIR_ID,
    km_esik: a.kmEsik,
    mukerrer_dk: a.mukerrerDk,
    mukerrer_yaricap: a.mukerrerYaricap,
    canli_yenileme_sn: a.canliYenilemeSn,
    rapor_cekme_dk: a.raporCekmeDk,
    guzergah_tekrar: a.guzergahTekrar,
    tekrar_pencere_saat: a.tekrarPencereSaat,
    grid_mesafe: a.gridMesafe,
    silindir_tekrar: a.silindirTekrar,
    transit_hiz: a.transitHiz,
    reglaj_kalinlik: a.reglajKalinlik,
    serme_kalinlik: a.sermeKalinlik,
    silindir_kalinlik: a.silindirKalinlik,
    kamyon_izi_kalinlik: a.kamyonIziKalinlik,
    reglaj_renk: a.reglajRenk,
    serme_renk: a.sermeRenk,
    silindir_renk: a.silindirRenk,
    kamyon_izi_renk: a.kamyonIziRenk,
    damper_sync_bas_saat: a.damperSyncBasSaat,
    damper_sync_bit_saat: a.damperSyncBitSaat,
    damper_sync_periyot_dk: a.damperSyncPeriyotDk,
    ekskavator_nokta_dk: a.ekskavatorNoktaDk,
  });
  if (error) throw error;
}

// ── Damper manuel sınıflandırma (override) — arvento_damper_sinif tablosu ───────────────
// Otomatik sınıf (gerçek/mükerrer/arıza) kullanıcı tarafından elle değiştirilebilir; burada saklanır.
// Okuma/yazma /api/arvento/damper-sinif route'u üzerinden SERVICE ROLE ile yapılır → RLS GEREKMEZ.
// SQL (sadece tabloyu kur; RLS satırına gerek yok):
//   create table if not exists arvento_damper_sinif (
//     plaka text not null, tarih date not null, saat text not null,
//     sinif text not null check (sinif in ('gercek','mukerrer','ariza')),
//     primary key (plaka, tarih, saat));
export type DamperSinif = "gercek" | "mukerrer" | "ariza";

// Okuma/yazma SUNUCU tarafından (service role) yapılır → RLS baypas; tabloda RLS açık olsa bile çalışır.
export async function getDamperSiniflar(bas: string, bitis: string): Promise<{ plaka: string; tarih: string; saat: string; sinif: DamperSinif }[]> {
  try {
    const r = await fetch(`/api/arvento/damper-sinif?bas=${encodeURIComponent(bas)}&bitis=${encodeURIComponent(bitis)}`, { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.satirlar ?? []) as { plaka: string; tarih: string; saat: string; sinif: DamperSinif }[];
  } catch { return []; }
}

export async function setDamperSinif(plaka: string, tarih: string, saat: string, sinif: DamperSinif): Promise<void> {
  const r = await fetch("/api/arvento/damper-sinif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plaka, tarih, saat, sinif }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error ?? "Kaydedilemedi"); }
}
