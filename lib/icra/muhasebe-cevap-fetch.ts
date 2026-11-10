// MUHASEBENİN İCRA CEVABINI POSTA KUTUSUNDA YAKALA.
//
// NİYE: icra yazısı muhasebeye gidiyor, cevabı mail kutusuna düşüyor ve panel
// bunu bilmiyordu — "cevap geldi mi" sorusu için Outlook açmak gerekiyordu.
// Bildirge cevapları zaten aynı kutulardan taranıyor (lib/personel/bildirge-fetch);
// aynı yoldan icra cevabı da yakalanıp dosyanın yanında işaret olarak yanıyor.
//
// NE YAZAR, NE YAZMAZ:
//   muhasebe_cevap_mail_at → cevap maili GÖRÜLDÜ (makine buldu)
//   muhasebe_cevap_at      → cevabın İÇERİĞİ panele girildi (insan okudu)
// Bu dosya YALNIZ birincisini yazar. Borç durumu ve cevap şekli maildeki serbest
// metinden çıkarılmıyor: "borcumuz yok" cümlesini yanlış okumak, süre kaçırtan
// türden bir hata olur. Makine haber verir, kararı insan verir.
//
// EŞLEŞTİRME ÜÇ ŞARTLI:
//   1) gönderen, Tanımlamalar'daki muhasebe adreslerinden biri
//   2) mail, bizim gönderimimizden SONRA gelmiş
//   3) konuda dosya esas no geçiyor ("Re: İcra yazısı 2024/57908 — …")
// Üçü birden aranıyor; numara tek başına başka mailde de geçebilir.
//
// BAŞKA ADRESTEN GELEN CEVAP YAKALANMAZ: muhasebe başka bir hesabından yazarsa
// işaret yanmaz. Uydurmak yerine eksik bırakılıyor — cevabı panele girmek zaten
// insanın işi, işaret yalnız haberciydi.
//
// IMAP'IN İZİNLİ OLDUĞU MAKİNEDE ÇALIŞIR (Türkiye IP / şirket ağı); Vercel mail
// sunucusuna bağlanamıyor. scripts/icra-muhasebe-cevap-sync.ts bunu çağırır.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";

export type MuhasebeCevapSonuc = {
  /** Kaç mail incelendi */
  taranan: number;
  /** Kaç dosyaya "cevap geldi" işareti kondu */
  eslesme: number;
  isaretlenen: { dosya: string; nereye: "icra" | "sirket"; gonderen: string; kutu: string }[];
  uyari: string[];
};

type Bekleyen = {
  id: string;
  tablo: "icra" | "icra_sirket_takip";
  dosya: string;
  gonderimAt: string;
  /** Bu turda işaretlendi — aynı dosyaya ikinci mail eşleştirilmesin. */
  eslesti?: boolean;
};

export async function muhasebeCevaplariniTara(gun = 14): Promise<MuhasebeCevapSonuc> {
  const isaretlenen: MuhasebeCevapSonuc["isaretlenen"] = [];
  const uyari: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anahtar) return { taranan: 0, eslesme: 0, isaretlenen, uyari: ["Supabase yapılandırması eksik."] };
  const sb = createClient(url, anahtar, { auth: { persistSession: false } });

  // 1) CEVABI BEKLENEN DOSYALAR — maili gitmiş, cevabı ne mailde görülmüş ne de
  //    panele girilmiş olanlar. Cevabı girilmiş dosyayı taramanın anlamı yok.
  const bekleyen: Bekleyen[] = [];
  for (const tablo of ["icra", "icra_sirket_takip"] as const) {
    const { data, error } = await sb.from(tablo)
      .select("id, dosya_esas_no, muhasebe_mail_at")
      .not("muhasebe_mail_at", "is", null)
      .is("muhasebe_cevap_mail_at", null)
      .is("muhasebe_cevap_at", null);
    if (error) { uyari.push(`${tablo} okunamadı: ${error.message}`); continue; }
    for (const r of (data ?? []) as { id: string; dosya_esas_no: string | null; muhasebe_mail_at: string }[]) {
      const dosya = (r.dosya_esas_no ?? "").trim();
      if (!dosya) continue;   // numarası olmayan kayıt konudan eşleştirilemez
      bekleyen.push({ id: r.id, tablo, dosya, gonderimAt: r.muhasebe_mail_at, eslesti: false });
    }
  }
  if (bekleyen.length === 0) return { taranan: 0, eslesme: 0, isaretlenen, uyari: ["Cevabı beklenen dosya yok."] };

  // 2) MUHASEBE ADRESLERİ — mailin gittiği adreslerin aynısı (Tanımlamalar).
  const { data: tanimlar } = await sb.from("tanimlamalar")
    .select("deger").eq("kategori", "muhasebe_email").eq("aktif", true);
  const adresler = new Set(((tanimlar ?? []) as { deger: string | null }[])
    .flatMap((t) => String(t.deger ?? "").split(/[,;]/))
    .map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")));
  if (adresler.size === 0) return { taranan: 0, eslesme: 0, isaretlenen, uyari: ["Muhasebe adresi tanımlı değil."] };

  // 3) POSTA KUTULARI — firmalar SMTP kimliklerinden (bildirge taramasıyla aynı yol).
  const { data: firmalar } = await sb.from("firmalar")
    .select("smtp_user, smtp_password")
    .not("smtp_user", "is", null).not("smtp_password", "is", null);
  const kutular = new Map<string, { user: string; pass: string; host: string; etiket: string }>();
  for (const f of (firmalar ?? []) as { smtp_user: string | null; smtp_password: string | null }[]) {
    const user = (f.smtp_user ?? "").trim();
    const pass = f.smtp_password ?? "";
    if (!user || !pass || kutular.has(user.toLowerCase())) continue;
    const alan = user.split("@")[1] ?? "";
    const host = (process.env.BILDIRGE_IMAP_HOST || (alan ? `mail.${alan}` : "")).trim();
    if (!host) continue;
    kutular.set(user.toLowerCase(), { user, pass, host, etiket: alan.split(".")[0] || user });
  }
  if (kutular.size === 0) return { taranan: 0, eslesme: 0, isaretlenen, uyari: ["IMAP kutusu bulunamadı (firmalar SMTP boş)."] };

  // TARAMA PENCERESİ: en eski gönderimden öncesine bakmaya gerek yok — o tarihten
  // önce gelen mail, henüz gönderilmemiş bir yazının cevabı olamaz.
  const enEski = bekleyen.reduce((a, b) => (a.gonderimAt < b.gonderimAt ? a : b)).gonderimAt;
  const pencere = new Date(Date.now() - gun * 86400000);
  const since = new Date(enEski) > pencere ? new Date(enEski) : pencere;
  const port = parseInt(process.env.BILDIRGE_IMAP_PORT ?? "993", 10);
  let taranan = 0;

  for (const kutu of kutular.values()) {
    const client = new ImapFlow({
      host: kutu.host, port, secure: port === 993,
      auth: { user: kutu.user, pass: kutu.pass },
      logger: false,
      // Paylaşımlı hosting sertifikası alan adıyla eşleşmeyebilir → doğrulama gevşek.
      tls: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const seqs = await client.search({ since });
        const secili = (Array.isArray(seqs) ? seqs : []).slice(-300);
        if (secili.length === 0) continue;
        for await (const msg of client.fetch(secili, { source: true })) {
          if (!msg.source) continue;
          let parsed;
          try { parsed = await simpleParser(msg.source as Buffer); } catch { continue; }
          taranan++;
          const gonderen = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
          // KENDİ GÖNDERDİĞİMİZ MAİL DEĞİL: kutunun kendi adresinden gelen kopya atlanır.
          if (!gonderen || gonderen === kutu.user.toLowerCase()) continue;
          if (!adresler.has(gonderen)) continue;
          const konu = (parsed.subject ?? "").trim();
          if (!konu) continue;
          const an = parsed.date ? parsed.date.toISOString() : new Date().toISOString();

          for (const b of bekleyen) {
            if (b.eslesti) continue;
            if (!konu.includes(b.dosya)) continue;
            if (an <= b.gonderimAt) continue;      // gönderimden önceki mail cevap olamaz

            // ── EKLER VE GÖMÜLÜ GÖRSELLER KOVAYA ──
            // Hesap ekstresi burada geliyor; mail kutusunda bırakılırsa panelden
            // açılamaz ve avukata iletilemez. ÖZEL kovaya (yazismalar) konuyor,
            // arayüz imzalı geçitten açıyor (AGENTS.md).
            //
            // GÖMÜLÜ GÖRSELLER DE KAYDEDİLİR (antet, imza logoları): mailin
            // gövdesinde `src="cid:..."` diye duruyorlar ve panelde çözülmedikleri
            // için KIRIK görünüyorlardı. Kaydedilip cid'leriyle birlikte
            // tutuluyorlar; okuyucu adresleri değiştirip gösteriyor.
            //
            // AYRIMI cid KORUR: cid'si olan görsel EK SAYILMAZ — ek listesinde
            // "image001.png" görünce "ekstre geldi" sanılıyordu.
            const ekListe: { ad: string; yol: string; cid?: string }[] = [];
            for (const a of parsed.attachments ?? []) {
              const ad = (a.filename ?? "").trim();
              if (!ad || !a.content) continue;
              const gomulu = Boolean(a.cid) || a.contentDisposition === "inline" || a.related;
              const yol = `icra-muhasebe/${b.id}/${gomulu ? "govde-" : ""}${Date.now()}-${ad.replace(/[^\w.\-]+/g, "_")}`;
              const { error: yErr } = await sb.storage.from("yazismalar")
                .upload(yol, a.content as Buffer, { contentType: a.contentType ?? undefined, upsert: true });
              if (yErr) {
                // SESSİZ GEÇİLMEZ: ek kaydedilemediyse sebep çıktıya düşer —
                // dosya mail kutusunda duruyor demektir.
                uyari.push(`${b.dosya} eki kaydedilemedi (${ad}): ${yErr.message}`);
                continue;
              }
              const { data: genel } = sb.storage.from("yazismalar").getPublicUrl(yol);
              ekListe.push({ ad, yol: genel?.publicUrl ?? yol, ...(a.cid ? { cid: a.cid } : {}) });
            }

            // MAİLİN DÜZ METNİ: panelde okunsun diye. HTML yerine text yeğleniyor;
            // yoksa HTML'den etiketler ayıklanıyor. Uzun zincirler için üst sınır var.
            const govde = (parsed.text ?? "").trim()
              || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");

            const { error } = await sb.from(b.tablo).update({
              muhasebe_cevap_mail_at: an,
              muhasebe_cevap_mail_gonderen: gonderen,
              muhasebe_cevap_mail_konu: konu.slice(0, 300),
              // ÖZET YALNIZ GERÇEK EKLER: gövdeye gömülü görseller (cid'li)
              // "ek" sayılmaz — listede logo görünce ekstre geldi sanılıyordu.
              muhasebe_cevap_mail_ek: ekListe.filter((e) => !e.cid).map((e) => e.ad).join(", ") || null,
              muhasebe_cevap_mail_ekler: ekListe.length ? ekListe : null,
              muhasebe_cevap_mail_metin: govde ? govde.slice(0, 20000) : null,
              // MAİLİN ASLI: HTML mail düz metne çevrilince biçim dağılıyor
              // (alıntılanan yazışma, tablolar iç içe giriyor). Aslı saklanıp
              // ayrı pencerede sandbox'lı iframe içinde gösteriliyor.
              muhasebe_cevap_mail_html: parsed.html ? String(parsed.html).slice(0, 400000) : null,
              updated_at: new Date().toISOString(),
            }).eq("id", b.id);
            if (error) { uyari.push(`${b.dosya} işaretlenemedi: ${error.message}`); continue; }
            b.eslesti = true;
            isaretlenen.push({
              dosya: b.dosya, nereye: b.tablo === "icra" ? "icra" : "sirket",
              gonderen, kutu: kutu.etiket,
            });
          }
        }
      } finally { lock.release(); }
    } catch (e) {
      // KUTU OKUNAMAZSA SESSİZ GEÇİLMEZ: sebebi çıktıya düşer, görev günlüğünde kalır.
      uyari.push(`${kutu.etiket} kutusu: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      try { await client.logout(); } catch { /* bağlantı zaten kopmuş olabilir */ }
    }
  }

  return { taranan, eslesme: isaretlenen.length, isaretlenen, uyari };
}
