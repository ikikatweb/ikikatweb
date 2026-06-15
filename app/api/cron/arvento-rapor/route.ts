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
import { ingestArventoBuffer } from "@/lib/arvento/ingest";

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
    const kaynakSources: Buffer[] = [];
    try {
      // Son 3 günün mailleri arasında ara
      const since = new Date(Date.now() - 3 * 86400000);
      const seqs = await client.search({ since });
      if (!seqs || seqs.length === 0) {
        return NextResponse.json({ ok: false, mesaj: "Son 3 günde mail bulunamadı." });
      }
      // Eşleşen tüm mailleri topla (yeni → eski), son 5'i işle — kaçan günleri toparlamak için
      const matches: { uid: number; t: number }[] = [];
      for await (const msg of client.fetch(seqs, { envelope: true, uid: true })) {
        const env = msg.envelope;
        const fromOk = !fromFilter || (env?.from ?? []).some((a) => (a.address ?? "").toLowerCase().includes(fromFilter));
        const subjOk = !subjFilter || (env?.subject ?? "").toLowerCase().includes(subjFilter);
        if (fromOk && subjOk) {
          matches.push({ uid: msg.uid, t: env?.date ? new Date(env.date).getTime() : 0 });
        }
      }
      if (matches.length === 0) {
        return NextResponse.json({ ok: false, mesaj: "Eşleşen Arvento maili bulunamadı (FROM/SUBJECT filtrelerini kontrol edin)." });
      }
      matches.sort((a, b) => b.t - a.t);
      for (const m of matches.slice(0, 5)) {
        const tek = await client.fetchOne(String(m.uid), { source: true }, { uid: true });
        if (tek && tek.source) kaynakSources.push(tek.source as Buffer);
      }
    } finally {
      lock.release();
    }
    await client.logout();

    if (kaynakSources.length === 0) {
      return NextResponse.json({ ok: false, mesaj: "Mail içeriği okunamadı." });
    }

    // Rapor dosyalarını mailden topla: önce EKLER (.xls/.xlsx), yoksa gövdedeki LİNKLER.
    // Hem "Araç Çalışma Raporu" hem "Genel Rapor" ayrı dosya gelir; her birini içe aktar.
    const secLinkler = (parsed: { html?: unknown; text?: string | null }): string[] => {
      const links: string[] = [];
      const html = typeof parsed.html === "string" ? parsed.html : "";
      for (const mm of html.matchAll(/href=["']([^"']+)["']/gi)) links.push(mm[1]);
      const text = parsed.text ?? "";
      for (const mm of text.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) links.push(mm[0]);
      let secili = links.filter((x) => /xls|download|indir|rapor|report|file|attachment/i.test(x));
      if (linkPattern) secili = secili.filter((x) => x.toLowerCase().includes(linkPattern));
      return (secili.length > 0 ? secili : links);
    };

    const calismaGunler: { tarih: string; sayi: number }[] = [];
    const damperGunler: { tarih: string; sayi: number }[] = [];
    const hatalar: string[] = [];
    for (const src of kaynakSources) {
      try {
        const parsed = await simpleParser(src);
        // 1) Excel ekleri
        const ekler = (parsed.attachments ?? []).filter((a) =>
          /\.(xlsx?|xls)$/i.test(a.filename ?? "") || /excel|spreadsheet/i.test(a.contentType ?? ""),
        );
        const buffers: Buffer[] = [];
        if (ekler.length > 0) {
          for (const e of ekler) buffers.push(e.content as Buffer);
        } else {
          // 2) Ekler yoksa gövdedeki linklerden indir
          for (const link of secLinkler(parsed)) {
            try {
              const r = await fetch(link, { redirect: "follow" });
              if (r.ok) buffers.push(Buffer.from(await r.arrayBuffer()));
            } catch { /* sonraki link */ }
          }
        }
        for (const buf of buffers) {
          try {
            const s = await ingestArventoBuffer(buf);
            calismaGunler.push(...s.calismaGunler);
            damperGunler.push(...s.damperGunler);
          } catch (e) { hatalar.push(e instanceof Error ? e.message : String(e)); }
        }
      } catch (e) {
        hatalar.push(e instanceof Error ? e.message : String(e));
      }
    }

    if (calismaGunler.length === 0 && damperGunler.length === 0) {
      return NextResponse.json({ ok: false, mesaj: `İçe aktarılamadı. ${hatalar.join("; ")}` });
    }
    return NextResponse.json({
      ok: true,
      calismaGunler,
      damperGunler,
      mesaj: [
        ...calismaGunler.map((s) => `${s.tarih} çalışma (${s.sayi})`),
        ...(damperGunler.length ? [`damper ${damperGunler.length} gün`] : []),
      ].join(" · "),
      ...(hatalar.length ? { uyari: hatalar } : {}),
    });
  } catch (err) {
    try { await client.logout(); } catch { /* sessiz */ }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Arvento cron hatası: ${msg}` }, { status: 500 });
  }
}
