// GENEL UYARI KAPATMA — bir kişi kapatınca HERKESTE kapanan uyarılar.
//
// Kişisel kapatma (kullanicilar.gizlenen_uyarilar, lib/supabase/queries/uyari-gizle)
// ile KARIŞTIRILMAMALI: orada kapatılan uyarı yalnız kapatan kullanıcıda kaybolur.
// Burası paylaşımlı — tablo ve gerekçe sql/uyari_kapatma_genel.sql içinde.
import { createClient } from "@/lib/supabase/client";

export type GenelKapatma = { anahtar: string; kapatan_ad: string | null; kapatildi_at: string };

/** Verilen tiplerdeki kapatılmış uyarılar. Tablo yoksa BOŞ döner (ekran çalışmaya devam eder). */
export async function getGenelKapatilanlar(tipler: string[]): Promise<Map<string, GenelKapatma>> {
  const sonuc = new Map<string, GenelKapatma>();
  if (tipler.length === 0) return sonuc;
  const { data, error } = await createClient()
    .from("uyari_kapatma_genel")
    .select("anahtar, kapatan_ad, kapatildi_at")
    .in("tip", tipler);
  if (error) {
    // SESSİZ DEĞİL ama EKRANI DURDURMAZ: tablo kurulmamışsa uyarılar açık görünür —
    // kapalı sanılıp hiç gösterilmemesinden iyidir.
    console.warn("Kapatılmış uyarılar okunamadı:", error.message);
    return sonuc;
  }
  for (const r of (data ?? []) as GenelKapatma[]) sonuc.set(r.anahtar, r);
  return sonuc;
}

/**
 * Uyarıyı HERKES için kapatır. Kapatan kişi oturumdan çözülür (gövdeden kabul edilmez)
 * ve hem uyari_kapatma_genel hem uyari_onaylari günlüğüne yazılır.
 * kayitHatasi: kapandı AMA günlüğe yazılamadı — arayüz bunu söylemeli.
 */
export async function uyariyiHerkeseKapat(anahtar: string, geriAl = false): Promise<{ kayitHatasi: string | null }> {
  const res = await fetch("/api/uyari-gizle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anahtar, geriAl, genel: true }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Uyarı kapatılamadı.");
  const data = (await res.json()) as { kayitHatasi?: string | null };
  return { kayitHatasi: data.kayitHatasi ?? null };
}
