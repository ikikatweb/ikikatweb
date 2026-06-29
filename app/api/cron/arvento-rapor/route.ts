// Gece cron: Arvento mailini IMAP ile bul → linkteki Excel'i indir → içe aktar.
// Vercel cron her gün ~17:30 UTC (20:30 TR) tetikler. CRON_SECRET ile korunur.
//
// Gerekli ortam değişkenleri:
//   ARVENTO_IMAP_HOST, ARVENTO_IMAP_PORT (vars. 993), ARVENTO_IMAP_USER, ARVENTO_IMAP_PASSWORD
// İsteğe bağlı (maili daraltmak için):
//   ARVENTO_MAIL_FROM     — gönderen adresi içinde geçen ifade (ör. "arvento")
//   ARVENTO_MAIL_SUBJECT  — konu başlığında geçen ifade (ör. "rapor")
//   ARVENTO_LINK_PATTERN  — indirme linkini seçmek için link içinde geçmesi gereken ifade
import { NextResponse } from "next/server";
import { cekVeIsleArventoMail } from "@/lib/arvento/mail-fetch";
import { serviceClient, getAyarServer, gunOzetiHesapla } from "@/lib/arvento/stabilize-ozet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Güvenlik: Vercel cron Bearer secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  try {
    // Son 7 günü tara: bir gece cron gecikir/atlanırsa ertesi gece kaçan günleri
    // kendiliğinden toparlar (kayıtlar upsert edildiği için tekrar işlemek zararsız).
    const sonuc = await cekVeIsleArventoMail(7);

    // Önbellek ısıtma: rapor sync bittikten sonra BUGÜNÜN stabilize özetini üret + kaydet → tarayıcı
    // hazır gelir. Hata olsa bile cron'u BOZMA (logla, devam et).
    try {
      const supabase = serviceClient();
      const ayarCache = await getAyarServer(supabase);
      const bugun = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
      const { imza, payload } = await gunOzetiHesapla(bugun, supabase, ayarCache);
      await supabase
        .from("arvento_harita_ozet")
        .upsert({ rapor_tarihi: bugun, sekme: "stabilize", imza, payload }, { onConflict: "rapor_tarihi,sekme" });
      console.log(`[arvento-rapor cron] stabilize özeti ısıtıldı: ${bugun} → ${payload.dampers.length} damper`);
    } catch (ozetErr) {
      console.error("[arvento-rapor cron] stabilize özeti ısıtma hatası:", ozetErr instanceof Error ? ozetErr.message : String(ozetErr));
    }

    return NextResponse.json(sonuc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Arvento cron hatası: ${msg}` }, { status: 500 });
  }
}
