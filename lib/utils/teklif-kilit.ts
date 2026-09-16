// AYNI ACENTEYE TEKRAR TEKLİF İSTEME KİLİDİ
//
// Bir araç + poliçe tipi için teklif istenen acente, bu süre boyunca yeniden seçilemez.
// Acente aynı işi iki kez fiyatlamak zorunda kalmasın, biz de üst üste mail atmayalım.
//
// Teklif isteme iki ayrı ekranda var (ana sayfa widget'ı ve Kasko & Sigorta → Araç
// Listesi). Kural burada tek yerde duruyor; ikisi ayrışıp biri kilitsiz kalmasın diye.
//
// Kaynak veri: teklif_gonderim tablosu. Acenteler ADIYLA tutuluyor (acente_adlari
// virgülle birleşik bir metin), eşleştirme de ada göre yapılıyor.
//
// Kilit ne zaman kalkar: ya süre dolunca, ya da o araca poliçe girilince — poliçe
// kaydedilince o araç+tip için gönderim kayıtları siliniyor, yeni dönem temiz başlıyor.
import type { TeklifGonderim } from "@/lib/supabase/types";

export const TEKLIF_BEKLEME_GUN = 20;

export type AcenteKilidi = {
  kalanGun: number; // en az 1 — "0 gün sonra" demek anlamsız
  gonderim: Date;
};

/** Bir araç + poliçe tipi için: acente adı → EN SON gönderim zamanı (ISO metin). */
export function sonGonderimHaritasi(
  gonderimler: TeklifGonderim[],
  aracId: string | null | undefined,
  policeTipi: "kasko" | "trafik",
): Map<string, string> {
  const m = new Map<string, string>();
  if (!aracId) return m;
  for (const g of gonderimler) {
    if (g.arac_id !== aracId || g.police_tipi !== policeTipi) continue;
    for (const ham of (g.acente_adlari ?? "").split(",")) {
      const ad = ham.trim();
      if (!ad) continue;
      const mevcut = m.get(ad);
      if (!mevcut || g.created_at > mevcut) m.set(ad, g.created_at);
    }
  }
  return m;
}

/** Acente hâlâ bekleme süresinde mi? Değilse null. */
export function acenteKilidi(harita: Map<string, string>, ad: string): AcenteKilidi | null {
  const iso = harita.get(ad);
  if (!iso) return null;
  const gonderim = new Date(iso);
  if (isNaN(gonderim.getTime())) return null;
  const gecenGun = (Date.now() - gonderim.getTime()) / 86400000;
  if (gecenGun >= TEKLIF_BEKLEME_GUN) return null;
  return { kalanGun: Math.max(1, Math.ceil(TEKLIF_BEKLEME_GUN - gecenGun)), gonderim };
}

/** "16.09.2026 14:32" */
export function gonderimZamani(d: Date): string {
  return d.toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
