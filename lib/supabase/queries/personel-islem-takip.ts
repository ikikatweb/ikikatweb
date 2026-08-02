// Personel işe giriş / işten çıkış BİLDİRGE takibi — dashboard okuma sorguları.
// Kayıtlar app/api/bordro-mail-bulk tarafından açılır, scripts/personel-bildirge-sync tarafından kapatılır.
import { createClient } from "@/lib/supabase/client";

export type PersonelIslemTakip = {
  id: string;
  personel_ad: string;
  personel_tc: string | null;
  tip: "giris" | "cikis";
  islem_tarihi: string | null;
  gonderim_tarihi: string; // YYYY-MM-DD
  durum: "bekliyor" | "tamamlandi";
  uyusmazlik: string | null;      // gelen bildirge kayıtla tutmuyorsa açıklama (ör. tarih farkı)
  bildirge_tarihi: string | null; // uyuşmazlıkta: gelen bildirgedeki resmi giriş/çıkış tarihi (YYYY-MM-DD)
  created_by_ad: string | null;
  created_at: string;
};

// Cevabı bekleyen (bildirgesi gelmemiş) talepler — en eskiden yeniye (en geciken üstte).
export async function getBekleyenBildirgeler(): Promise<PersonelIslemTakip[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("personel_islem_takip")
    .select("id, personel_ad, personel_tc, tip, islem_tarihi, gonderim_tarihi, durum, uyusmazlik, bildirge_tarihi, created_by_ad, created_at")
    .eq("durum", "bekliyor")
    .order("gonderim_tarihi", { ascending: true });
  if (error) return []; // tablo yoksa / RLS → sessiz (dashboard kartı gizlenir)
  return (data ?? []) as PersonelIslemTakip[];
}

// "Düzelt" — gelen bildirgedeki resmi tarihi kaydımıza uygula ve talebi kapat (muhasebe geç işlediğinde).
export async function bildirgeTarihiniKabulEt(id: string, bildirgeTarihi: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from("personel_islem_takip")
    .update({ islem_tarihi: bildirgeTarihi, durum: "tamamlandi", uyusmazlik: null, cevap_tarihi: new Date().toISOString() })
    .eq("id", id);
  return !error;
}
