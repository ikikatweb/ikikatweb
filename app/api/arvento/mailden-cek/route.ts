// Manuel "Mailden Çek" — IMAP'taki Arvento rapor mailini anında işler.
// Gece cron'unu beklemeden, mail inbox'a düştüyse butonla tetiklenir.
// (Mevcut /api/arvento dosya/link import'u ile aynı erişim modeli: dashboard içinden çağrılır.)
import { NextResponse } from "next/server";
import { cekVeIsleArventoMail } from "@/lib/arvento/mail-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    // Manuel çekimde biraz daha geniş pencere (son 5 gün) — kaçan günleri de toparla
    const sonuc = await cekVeIsleArventoMail(5);
    return NextResponse.json(sonuc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Mailden çekme hatası: ${msg}` }, { status: 500 });
  }
}
