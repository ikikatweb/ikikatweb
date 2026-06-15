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
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { ingestArventoUrl } from "@/lib/arvento/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Güvenlik: Vercel cron Bearer secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const host = process.env.ARVENTO_IMAP_HOST;
  const user = process.env.ARVENTO_IMAP_USER;
  const pass = process.env.ARVENTO_IMAP_PASSWORD;
  const port = parseInt(process.env.ARVENTO_IMAP_PORT ?? "993", 10);
  if (!host || !user || !pass) {
    return NextResponse.json(
      { error: "IMAP yapılandırması eksik (ARVENTO_IMAP_HOST/USER/PASSWORD)" },
      { status: 500 },
    );
  }

  // Gönderen varsayılanı: report@report.arvento.com (env ile değiştirilebilir)
  const fromFilter = (process.env.ARVENTO_MAIL_FROM ?? "report.arvento.com").toLowerCase();
  const subjFilter = (process.env.ARVENTO_MAIL_SUBJECT ?? "").toLowerCase();
  const linkPattern = (process.env.ARVENTO_LINK_PATTERN ?? "").toLowerCase();

  const client = new ImapFlow({
    host, port, secure: port === 993,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    let kaynakSource: Buffer | null = null;
    try {
      // Son 3 günün mailleri arasında ara
      const since = new Date(Date.now() - 3 * 86400000);
      const seqs = await client.search({ since });
      if (!seqs || seqs.length === 0) {
        return NextResponse.json({ ok: false, mesaj: "Son 3 günde mail bulunamadı." });
      }
      let bestUid: number | null = null;
      let bestDate = 0;
      for await (const msg of client.fetch(seqs, { envelope: true, uid: true })) {
        const env = msg.envelope;
        const fromOk = !fromFilter || (env?.from ?? []).some((a) => (a.address ?? "").toLowerCase().includes(fromFilter));
        const subjOk = !subjFilter || (env?.subject ?? "").toLowerCase().includes(subjFilter);
        if (fromOk && subjOk) {
          const t = env?.date ? new Date(env.date).getTime() : 0;
          if (t >= bestDate) { bestDate = t; bestUid = msg.uid; }
        }
      }
      if (bestUid == null) {
        return NextResponse.json({ ok: false, mesaj: "Eşleşen Arvento maili bulunamadı (FROM/SUBJECT filtrelerini kontrol edin)." });
      }
      const tek = await client.fetchOne(String(bestUid), { source: true }, { uid: true });
      if (tek && tek.source) kaynakSource = tek.source as Buffer;
    } finally {
      lock.release();
    }
    await client.logout();

    if (!kaynakSource) {
      return NextResponse.json({ ok: false, mesaj: "Mail içeriği okunamadı." });
    }

    // Maili ayrıştır, linkleri çıkar
    const parsed = await simpleParser(kaynakSource);
    const links: string[] = [];
    const html = typeof parsed.html === "string" ? parsed.html : "";
    for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) links.push(m[1]);
    const text = parsed.text ?? "";
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) links.push(m[0]);

    // İndirme linkini seç
    let link: string | undefined;
    if (linkPattern) link = links.find((l) => l.toLowerCase().includes(linkPattern));
    if (!link) link = links.find((l) => /xls|download|indir|rapor|report|file|attachment/i.test(l));
    if (!link) link = links[0];
    if (!link) {
      return NextResponse.json({ ok: false, mesaj: "Mailde indirme linki bulunamadı." });
    }

    const sonuc = await ingestArventoUrl(link);
    return NextResponse.json({
      ok: true,
      tarih: sonuc.tarih,
      sayi: sonuc.sayi,
      mesaj: `${sonuc.tarih} tarihli Arvento raporu içe aktarıldı — ${sonuc.sayi} araç.`,
    });
  } catch (err) {
    try { await client.logout(); } catch { /* sessiz */ }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Arvento cron hatası: ${msg}` }, { status: 500 });
  }
}
