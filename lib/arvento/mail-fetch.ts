// IMAP üzerinden Arvento rapor mailini bulup, ekteki/linkdeki Excel'i indirip
// veritabanına işleyen paylaşımlı fonksiyon.
// Hem gece cron'u (/api/cron/arvento-rapor) hem de manuel "Mailden Çek"
// butonu (/api/arvento/mailden-cek) bu fonksiyonu çağırır.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { ingestArventoBuffer } from "@/lib/arvento/ingest";

export type MailCekSonuc = {
  ok: boolean;
  mesaj: string;
  calismaGunler: { tarih: string; sayi: number }[];
  damperGunler: { tarih: string; sayi: number }[];
  guzergahGunler: { tarih: string; sayi: number }[];
  kontakGunler: { tarih: string; sayi: number }[];
  uyari?: string[];
};

// Son `gunSayisi` gün içindeki Arvento maillerinden raporu işle.
// gunSayisi varsayılan 3 (cron), manuel çekimde daha geniş tutulabilir.
export async function cekVeIsleArventoMail(gunSayisi = 3): Promise<MailCekSonuc> {
  const host = process.env.ARVENTO_IMAP_HOST;
  const user = process.env.ARVENTO_IMAP_USER;
  const pass = process.env.ARVENTO_IMAP_PASSWORD;
  const port = parseInt(process.env.ARVENTO_IMAP_PORT ?? "993", 10);
  if (!host || !user || !pass) {
    throw new Error("IMAP yapılandırması eksik (ARVENTO_IMAP_HOST/USER/PASSWORD)");
  }

  // Gönderen varsayılanı: report@report.arvento.com (env ile değiştirilebilir)
  const fromFilter = (process.env.ARVENTO_MAIL_FROM ?? "report.arvento.com").toLowerCase();
  const subjFilter = (process.env.ARVENTO_MAIL_SUBJECT ?? "").toLowerCase();
  const linkPattern = (process.env.ARVENTO_LINK_PATTERN ?? "").toLowerCase();

  const client = new ImapFlow({
    host, port, secure: port === 993,
    auth: { user, pass },
    logger: false,
    // Paylaşımlı hosting (Natrohost) sertifikası *.natrohost.com için —
    // mail.kadtem.com.tr adıyla eşleşmiyor. Host uyuşmazlığını kabul et,
    // yoksa "Hostname does not match certificate's altnames" ile bağlantı kurulamaz.
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    const kaynakSources: Buffer[] = [];
    try {
      const since = new Date(Date.now() - gunSayisi * 86400000);
      const seqs = await client.search({ since });
      if (!seqs || seqs.length === 0) {
        return { ok: false, mesaj: `Son ${gunSayisi} günde mail bulunamadı.`, calismaGunler: [], damperGunler: [], guzergahGunler: [], kontakGunler: [] };
      }
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
        return { ok: false, mesaj: "Eşleşen Arvento maili bulunamadı (FROM/SUBJECT filtrelerini kontrol edin).", calismaGunler: [], damperGunler: [], guzergahGunler: [], kontakGunler: [] };
      }
      matches.sort((a, b) => b.t - a.t);
      // Penceredeki TÜM Arvento maillerini işle (günde 5-7 farklı rapor tipi gelir;
      // 5 ile sınırlamak Mesafe Bilgisi / Araç Çalışma gibi tipleri kaçırıyordu)
      for (const m of matches.slice(0, 60)) {
        const tek = await client.fetchOne(String(m.uid), { source: true }, { uid: true });
        if (tek && tek.source) kaynakSources.push(tek.source as Buffer);
      }
    } finally {
      lock.release();
    }
    await client.logout();

    if (kaynakSources.length === 0) {
      return { ok: false, mesaj: "Mail içeriği okunamadı.", calismaGunler: [], damperGunler: [], guzergahGunler: [], kontakGunler: [] };
    }

    // Rapor dosyalarını mailden topla: önce EKLER (.xls/.xlsx), yoksa gövdedeki LİNKLER.
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
    const guzergahGunler: { tarih: string; sayi: number }[] = [];
    const kontakGunler: { tarih: string; sayi: number }[] = [];
    const hatalar: string[] = [];
    for (const src of kaynakSources) {
      try {
        const parsed = await simpleParser(src);
        const ekler = (parsed.attachments ?? []).filter((a) =>
          /\.(xlsx?|xls)$/i.test(a.filename ?? "") || /excel|spreadsheet/i.test(a.contentType ?? ""),
        );
        const buffers: Buffer[] = [];
        if (ekler.length > 0) {
          for (const e of ekler) buffers.push(e.content as Buffer);
        } else {
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
            if (s.guzergahGunler) guzergahGunler.push(...s.guzergahGunler);
            if (s.kontakGunler) kontakGunler.push(...s.kontakGunler);
          } catch (e) { hatalar.push(e instanceof Error ? e.message : String(e)); }
        }
      } catch (e) {
        hatalar.push(e instanceof Error ? e.message : String(e));
      }
    }

    if (calismaGunler.length === 0 && damperGunler.length === 0 && guzergahGunler.length === 0 && kontakGunler.length === 0) {
      return {
        ok: false,
        mesaj: `İçe aktarılamadı. ${hatalar.join("; ")}`,
        calismaGunler: [],
        damperGunler: [],
        guzergahGunler: [],
        kontakGunler: [],
        ...(hatalar.length ? { uyari: hatalar } : {}),
      };
    }
    return {
      ok: true,
      calismaGunler,
      damperGunler,
      guzergahGunler,
      kontakGunler,
      mesaj: [
        ...calismaGunler.map((s) => `${s.tarih} çalışma (${s.sayi})`),
        ...(damperGunler.length ? [`damper ${damperGunler.length} gün`] : []),
        ...(guzergahGunler.length ? [`güzergah ${guzergahGunler.length} kayıt`] : []),
        ...(kontakGunler.length ? [`kontak ${kontakGunler.length} kayıt`] : []),
      ].join(" · "),
      ...(hatalar.length ? { uyari: hatalar } : {}),
    };
  } catch (err) {
    try { await client.logout(); } catch { /* sessiz */ }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
