// Arvento Tanımlamalar — eşik ayarları ORTAK (kullanıcı bazlı değil): tüm kullanıcılar
// aynı değerleri görür. Tek satırlık global kayıt (id='global'). Düzenleme yetkisi olan
// kullanıcılar değiştirebilir; diğerleri sadece görür.
import { createClient } from "@/lib/supabase/client";

export type ArventoAyarlar = {
  kmEsik: number;
  mukerrerDk: number;
  mukerrerYaricap: number; // mükerrer damper yarıçapı (m) — dakika ile BİRLİKTE şart
  canliYenilemeSn: number; // Canlı sekmesi otomatik yenileme aralığı (saniye)
  guzergahTekrar: number;
  gridMesafe: number;
  silindirTekrar: number;
  reglajKalinlik: number;
  sermeKalinlik: number;
  silindirKalinlik: number;
  kamyonIziKalinlik: number; // Stabilize: kamyon izi (güzergah) çizgi kalınlığı — reglajdan AYRI
  reglajRenk: string;
  sermeRenk: string;
  silindirRenk: string;
  kamyonIziRenk: string;     // Stabilize: kamyon izi rengi — reglajdan AYRI
};

export const VARSAYILAN_AYARLAR: ArventoAyarlar = {
  kmEsik: 0,
  mukerrerDk: 0,
  mukerrerYaricap: 0,
  canliYenilemeSn: 45,
  guzergahTekrar: 0,
  gridMesafe: 12,
  silindirTekrar: 0,
  reglajKalinlik: 4,
  sermeKalinlik: 3,
  silindirKalinlik: 3,
  kamyonIziKalinlik: 3,
  reglajRenk: "#2563eb",
  sermeRenk: "#059669",
  silindirRenk: "#7c3aed",
  kamyonIziRenk: "#dc2626",
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
    guzergahTekrar: data.guzergah_tekrar ?? 0,
    gridMesafe: data.grid_mesafe ?? 12,
    silindirTekrar: data.silindir_tekrar ?? 0,
    reglajKalinlik: data.reglaj_kalinlik ?? 4,
    sermeKalinlik: data.serme_kalinlik ?? 3,
    silindirKalinlik: data.silindir_kalinlik ?? 3,
    kamyonIziKalinlik: data.kamyon_izi_kalinlik ?? 3,
    reglajRenk: data.reglaj_renk ?? "#2563eb",
    sermeRenk: data.serme_renk ?? "#059669",
    silindirRenk: data.silindir_renk ?? "#7c3aed",
    kamyonIziRenk: data.kamyon_izi_renk ?? "#dc2626",
  };
}

export async function setArventoAyarlar(a: ArventoAyarlar): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLO).upsert({
    id: SATIR_ID,
    km_esik: a.kmEsik,
    mukerrer_dk: a.mukerrerDk,
    mukerrer_yaricap: a.mukerrerYaricap,
    canli_yenileme_sn: a.canliYenilemeSn,
    guzergah_tekrar: a.guzergahTekrar,
    grid_mesafe: a.gridMesafe,
    silindir_tekrar: a.silindirTekrar,
    reglaj_kalinlik: a.reglajKalinlik,
    serme_kalinlik: a.sermeKalinlik,
    silindir_kalinlik: a.silindirKalinlik,
    kamyon_izi_kalinlik: a.kamyonIziKalinlik,
    reglaj_renk: a.reglajRenk,
    serme_renk: a.sermeRenk,
    silindir_renk: a.silindirRenk,
    kamyon_izi_renk: a.kamyonIziRenk,
  });
  if (error) throw error;
}
