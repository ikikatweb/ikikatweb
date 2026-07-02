// Bordro gönderim durumu — PAYLAŞIMLI (tüm kullanıcılar aynı durumu görür). Dashboard "bordro gönder"
// hatırlatması bunu okur; "Bordro Gönder" başarınca o dönem işaretlenir → uyarı herkeste kalkar.
import { createClient } from "@/lib/supabase/client";

// "YYYY-MM" döneminin bordrosu gönderilmiş mi? (Tablo yoksa/sessiz → false = uyarı gösterilir.)
export async function bordroDonemGonderildiMi(donem: string): Promise<boolean> {
  if (!donem) return false;
  const sb = createClient();
  const { data, error } = await sb.from("bordro_gonderim").select("donem").eq("donem", donem).maybeSingle();
  if (error) return false;
  return !!data;
}

// Bir dönemin bordrosunu "gönderildi" işaretle (upsert). "Bordro Gönder" başarınca çağrılır.
export async function bordroDonemIsaretle(donem: string, gonderenId: string | null, gonderenAd: string | null): Promise<void> {
  if (!donem) return;
  const sb = createClient();
  await sb.from("bordro_gonderim").upsert(
    { donem, gonderen_id: gonderenId, gonderen_ad: gonderenAd, gonderildi_at: new Date().toISOString() },
    { onConflict: "donem" },
  );
}
