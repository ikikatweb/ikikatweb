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
    const sonuc = await cekVeIsleArventoMail(3);
    return NextResponse.json(sonuc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Arvento cron hatası: ${msg}` }, { status: 500 });
  }
}
