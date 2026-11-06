// E-TEBLİGAT SORGULARI — UETS'ten çekilen resmî tebligatlar.
//
// Tablo SALT OKUNUR: yazma yetkisi yalnız çekme işinde (servis anahtarı). Kullanıcı
// bir tebligatı silemez, tarihini değiştiremez — resmî belge, izi kalmalı.
// Tek istisna: "notlar" alanı, aşağıda.
import { createClient } from "@/lib/supabase/client";

export type Tebligat = {
  id: number;
  uets_id: string;
  hesap: string;
  gonderen_ad: string | null;
  gonderen_adres: string | null;
  alici_ad: string | null;
  konu: string | null;
  ulasma_tarihi: string;
  okuma_tarihi: string | null;
  teblig_tarihi: string;          // hesaplanan: ulaşma + 5 gün
  durum: string;                  // delivered | read | readtimeout
  boyut: number | null;
  paket_yolu: string | null;
  indirme_hatasi: string | null;
  notlar: string | null;
  // Panelden kim açtı? UETS'te indirmek açmak demek; resmî işlemin izi (sql/tebligat_okuma).
  okuyan_id: string | null;
  okuyan_ad: string | null;
  // EYP paketinden çıkan belgeler. Boşsa paket açılamamıştır → indirme_hatasi'na bakılır.
  ekler: { ad: string; yol: string; tur: string; boyut: number }[] | null;
  arsivlendi: boolean;
  firma_id: string | null;
  // Firmanın kendi rengi ve adı — tebligat hangi şirkete geldi, bir bakışta görünsün.
  firmalar?: { firma_adi: string; kisa_adi: string | null; renk: string | null } | null;
};

function sb() { return createClient(); }

export async function getTebligatlar(): Promise<Tebligat[]> {
  const { data, error } = await sb()
    .from("tebligat").select("*, firmalar ( firma_adi, kisa_adi, renk )")
    .order("ulasma_tarihi", { ascending: false });
  // Hata YUTULMAZ: boş liste "tebligat yok" diye okunur, oysa sorgu patlamıştır.
  if (error) throw error;
  return (data ?? []) as Tebligat[];
}

/** Yalnız not alanı güncellenebilir — resmî alanlara dokunulmaz. */
export async function setTebligatNot(id: number, notlar: string): Promise<void> {
  const { error } = await sb().from("tebligat").update({ notlar }).eq("id", id);
  if (error) throw error;
}

/**
 * Tebliğ sayılacağı güne kalan gün sayısı.
 * Negatif = süre geçti. 0 = bugün son gün.
 *
 * 7201 s. K. 7/a: tebligat, adrese ulaştığı tarihi izleyen BEŞİNCİ GÜNÜN SONUNDA
 * yapılmış sayılır. Yani o günün sonuna kadar vakit var, o gün "bitmiş" değil.
 */
export function kalanGun(teblig_tarihi: string): number {
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const son = new Date(teblig_tarihi + "T00:00:00"); son.setHours(0, 0, 0, 0);
  return Math.round((son.getTime() - bugun.getTime()) / 86400000);
}
