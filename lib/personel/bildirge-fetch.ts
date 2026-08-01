// Personel işe giriş / işten çıkış BİLDİRGE takibi — muhasebenin cevabındaki SGK bildirge PDF'ini
// yakalayıp açık talebi ("bekliyor") kapatır. IMAP'ın izinli olduğu makinede (Türkiye IP) çalışır;
// Vercel mail sunucusuna bağlanamadığı için (bkz. lib/arvento/mail-fetch) bu kontrol de PC'de
// Görev Zamanlayıcı ile döner. scripts/personel-bildirge-sync.ts bu fonksiyonu çağırır.
//
// Posta kutuları firmalar tablosundaki SMTP kimliklerinden türetilir (muhasebe@ikikat / muhasebe@kadtem):
//   IMAP host = env BILDIRGE_IMAP_HOST || "mail.<kullanıcı-alan-adı>", port 993, kullanıcı+şifre = smtp_user/smtp_password.
// Cevap hangi kutuya düşerse düşsün (çapraz cevap oluyor) HER İKİ kutu da taranır; gönderen filtre DEĞİL.
// Eşleştirme TC ile: PDF metnindeki 11 haneli TC, "bekliyor" kaydının personel_tc'si ile eşleşir.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";

export type BildirgeSonuc = {
  taranan: number; // incelenen PDF sayısı
  eslesme: number; // kapatılan talep sayısı
  kapatilan: { ad: string; tip: "giris" | "cikis"; tc: string | null; kutu: string }[];
  uyari: string[];
};

// Türkçe harfleri sadeleştirip büyük harfe çevir (PDF başlığı eşleştirmesi için — SGK formu Türkçe).
function trUpper(s: string): string {
  return s
    .replace(/İ/g, "I").replace(/ı/g, "I").replace(/i/g, "I")
    .replace(/Ş/g, "S").replace(/ş/g, "S")
    .replace(/Ğ/g, "G").replace(/ğ/g, "G")
    .replace(/Ü/g, "U").replace(/ü/g, "U")
    .replace(/Ö/g, "O").replace(/ö/g, "O")
    .replace(/Ç/g, "C").replace(/ç/g, "C")
    .toUpperCase();
}

// PDF buffer → düz metin. pdfjs-dist ile (SGK e-bildirgeleri metin tabanlıdır → seçilebilir metin).
// Not: dinamik import'ta specifier değişkende tutulur ki tsc modülü statik çözmeye çalışmasın (.mjs alt-yol tipsiz).
async function pdfMetin(buf: Buffer): Promise<string> {
  const spec = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = await import(spec);
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map((it: { str?: string }) => it.str ?? "").join(" ") + "\n";
  }
  try { await pdf.cleanup(); } catch { /* sessiz */ }
  return text;
}

// PDF metninden bildirge tipini anla: SGK "SİGORTALI İŞE GİRİŞ BİLDİRGESİ" / "SİGORTALI İŞTEN AYRILIŞ BİLDİRGESİ".
function bildirgeTipi(metinUpper: string): "giris" | "cikis" | null {
  const t = metinUpper.replace(/\s+/g, " ");
  const ayrilis = t.includes("AYRILIS") || t.includes("ISTEN CIKIS");
  const giris = t.includes("ISE GIRIS");
  if (giris && !ayrilis) return "giris";
  if (ayrilis && !giris) return "cikis";
  // Karışıksa başlık kalıbına bak
  if (t.includes("GIRIS BILDIRGESI")) return "giris";
  if (t.includes("AYRILIS BILDIRGESI") || t.includes("CIKIS BILDIRGESI")) return "cikis";
  return null;
}

const tcNorm = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// Açık talepleri tara, muhasebe kutularındaki bildirge PDF'lerini oku, eşleşenleri kapat.
export async function tarayVeKapat(gun = 7): Promise<BildirgeSonuc> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase yapılandırması eksik (URL / SERVICE_ROLE_KEY).");
  const supabase = createClient(url, key);

  const kapatilan: BildirgeSonuc["kapatilan"] = [];
  const uyari: string[] = [];

  // 1) Açık talepler (TC'si olanlar — eşleştirme TC ile yapılır)
  const { data: acik, error: acikErr } = await supabase
    .from("personel_islem_takip")
    .select("id, personel_ad, personel_tc, tip")
    .eq("durum", "bekliyor");
  if (acikErr) throw new Error("Açık talepler okunamadı: " + acikErr.message);
  const bekleyen = (acik ?? []).filter((r) => tcNorm(r.personel_tc).length === 11) as {
    id: string; personel_ad: string; personel_tc: string | null; tip: "giris" | "cikis";
  }[];
  if (bekleyen.length === 0) return { taranan: 0, eslesme: 0, kapatilan, uyari: ["Bekleyen talep yok."] };

  // 2) Posta kutuları — firmalar SMTP kimliklerinden türet, kullanıcıya göre tekilleştir
  const { data: firmalar } = await supabase
    .from("firmalar")
    .select("smtp_user, smtp_password")
    .not("smtp_user", "is", null).not("smtp_password", "is", null);
  const kutuMap = new Map<string, { user: string; pass: string; host: string; etiket: string }>();
  for (const f of firmalar ?? []) {
    const user = (f.smtp_user ?? "").trim();
    const pass = f.smtp_password ?? "";
    if (!user || !pass || kutuMap.has(user.toLowerCase())) continue;
    const alan = user.split("@")[1] ?? "";
    const host = (process.env.BILDIRGE_IMAP_HOST || (alan ? `mail.${alan}` : "")).trim();
    if (!host) continue;
    kutuMap.set(user.toLowerCase(), { user, pass, host, etiket: (alan.split(".")[0] || user) });
  }
  if (kutuMap.size === 0) return { taranan: 0, eslesme: 0, kapatilan, uyari: ["IMAP kutusu bulunamadı (firmalar SMTP boş)."] };

  const port = parseInt(process.env.BILDIRGE_IMAP_PORT ?? "993", 10);
  const since = new Date(Date.now() - gun * 86400000);
  let taranan = 0;

  // 3) Her kutuyu tara
  for (const kutu of kutuMap.values()) {
    const client = new ImapFlow({
      host: kutu.host, port, secure: port === 993,
      auth: { user: kutu.user, pass: kutu.pass },
      logger: false,
      // Paylaşımlı hosting sertifikası (*.natrohost.com) alan adıyla eşleşmeyebilir → doğrulamayı gevşet.
      tls: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const seqs = await client.search({ since });
        const secili = (Array.isArray(seqs) ? seqs : []).slice(-250); // son mailler (üst sınır)
        if (secili.length === 0) continue;
        for await (const msg of client.fetch(secili, { source: true })) {
          if (!msg.source) continue;
          let parsed;
          try { parsed = await simpleParser(msg.source as Buffer); } catch { continue; }
          const pdfEkler = (parsed.attachments ?? []).filter(
            (a) => /\.pdf$/i.test(a.filename ?? "") || /pdf/i.test(a.contentType ?? ""),
          );
          if (pdfEkler.length === 0) continue;
          const gonderen = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
          for (const ek of pdfEkler) {
            taranan++;
            let metin = "";
            try { metin = await pdfMetin(ek.content as Buffer); }
            catch (e) { uyari.push(`PDF okunamadı (${ek.filename ?? "?"}): ${e instanceof Error ? e.message : String(e)}`); continue; }
            const tip = bildirgeTipi(trUpper(metin));
            if (!tip) continue;
            const digits = metin.replace(/\D/g, "");
            // Eşleş: aynı tip + TC PDF metninde geçiyor + hâlâ bekliyor (yerel listede)
            const aday = bekleyen.find((r) => r.tip === tip && digits.includes(tcNorm(r.personel_tc)));
            if (!aday) continue;
            const { error: updErr } = await supabase
              .from("personel_islem_takip")
              .update({
                durum: "tamamlandi",
                cevap_tarihi: new Date().toISOString(),
                cevap_pdf_ad: ek.filename ?? null,
                cevap_kutu: kutu.etiket,
                cevap_gonderen: gonderen || null,
              })
              .eq("id", aday.id).eq("durum", "bekliyor");
            if (!updErr) {
              kapatilan.push({ ad: aday.personel_ad, tip, tc: aday.personel_tc, kutu: kutu.etiket });
              const idx = bekleyen.indexOf(aday);
              if (idx >= 0) bekleyen.splice(idx, 1); // aynı çalıştırmada tekrar eşleşmesin
            }
          }
        }
      } finally { lock.release(); }
      await client.logout();
    } catch (e) {
      uyari.push(`${kutu.etiket} kutusu: ${e instanceof Error ? e.message : String(e)}`);
      try { await client.logout(); } catch { /* sessiz */ }
    }
  }

  return { taranan, eslesme: kapatilan.length, kapatilan, uyari };
}
