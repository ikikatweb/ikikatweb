// Kredi Kartları sorguları — elle girilen kart durum listesi (paylaşımlı).
import { createClient } from "@/lib/supabase/client";
import type { KrediKarti } from "@/lib/supabase/types";

function sb() { return createClient(); }

type KrediKartiYazi = {
  banka_adi: string | null; son4: string | null; kart_ozelligi: string | null;
  kart_sahibi: string | null; karti_kullanan: string | null;
  hesap_kesim: number | null; son_odeme: number | null;
  limit_tutar: number; guncel_borc: number; aciklama: string | null; sira: number;
};

export async function getKrediKartlar(): Promise<KrediKarti[]> {
  const { data, error } = await sb()
    .from("kredi_karti").select("*").order("sira", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KrediKarti[];
}

export async function insertKrediKarti(row: KrediKartiYazi, guncelleyen?: string | null): Promise<KrediKarti> {
  const now = new Date().toISOString();
  const { data, error } = await sb().from("kredi_karti")
    .insert({ ...row, kullanilabilir_tarihi: now, kullanilabilir_guncelleyen: guncelleyen ?? null }).select().single();
  if (error) throw error;
  return data as KrediKarti;
}

// kullanilabilirDamga: kullanılabilir-limit tarih/güncelleyen damgası atılsın mı?
//   undefined → eski davranış: patch'te guncel_borc VARSA damgala (satır içi hücre düzenlemesi
//   yalnız değer değişince patch gönderdiği için doğru). Düzenle DİYALOĞU guncel_borc'u her
//   kayıtta gönderir → oradan AÇIKÇA geçilir (yalnız kullanılabilir GERÇEKTEN değiştiyse true);
//   yoksa açıklama gibi alan düzeltmeleri de tabloda "bugün güncellendi" (yeşil nokta) görünüyordu.
export async function updateKrediKarti(id: string, patch: Partial<KrediKartiYazi>, guncelleyen?: string | null, kullanilabilirDamga?: boolean): Promise<void> {
  const now = new Date().toISOString();
  const govde: Record<string, unknown> = { ...patch, updated_at: now };
  const damga = kullanilabilirDamga ?? patch.guncel_borc !== undefined;
  if (damga) { govde.kullanilabilir_tarihi = now; govde.kullanilabilir_guncelleyen = guncelleyen ?? null; }
  const { error } = await sb().from("kredi_karti").update(govde).eq("id", id);
  if (error) throw error;
}

export async function deleteKrediKarti(id: string): Promise<void> {
  const { error } = await sb().from("kredi_karti").delete().eq("id", id);
  if (error) throw error;
}
