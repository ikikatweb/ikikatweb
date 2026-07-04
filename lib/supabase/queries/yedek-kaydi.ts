// Veri yedeği durumu — PAYLAŞIMLI (tüm kullanıcılar aynı durumu görür). Dashboard'daki Cumartesi "yedek al"
// hatırlatması bunu okur; bir kullanıcı yedek alınca o gün işaretlenir → uyarı HERKESTE kalkar.
import { createClient } from "@/lib/supabase/client";

// Belirtilen gün (YYYY-MM-DD) yedek alınmış mı? (Tablo yoksa/hata → false = uyarı gösterilir.)
export async function yedekAlindiMi(tarih: string): Promise<boolean> {
  if (!tarih) return false;
  const sb = createClient();
  const { data, error } = await sb.from("yedek_kaydi").select("tarih").eq("tarih", tarih).maybeSingle();
  if (error) return false;
  return !!data;
}

// O günü "yedek alındı" işaretle (upsert). Yedek başarıyla indirilince çağrılır.
export async function yedekAlindiIsaretle(tarih: string, alanId: string | null, alanAd: string | null): Promise<void> {
  if (!tarih) return;
  const sb = createClient();
  await sb.from("yedek_kaydi").upsert(
    { tarih, alan_id: alanId, alan_ad: alanAd, alindi_at: new Date().toISOString() },
    { onConflict: "tarih" },
  );
}
