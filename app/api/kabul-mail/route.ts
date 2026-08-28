// Geçici Kabul Mail — bir işe geçici kabul belgesi yüklendiğinde PDF'i muhasebeye gönderir.
// santiye-form.tsx, geçici kabul PDF'i storage'a yükledikten SONRA burayı çağırır (kayıt akışını
// bloklamaz: hata olursa yalnız uyarı çıkar, iş kaydı yine tamamlanmıştır).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Public storage URL → bucket içi yol. Service role ile indirmek için (public olmasa da çalışsın).
function storageYolu(url: string): { bucket: string; yol: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], yol: decodeURIComponent(m[2].split("?")[0]) };
}

const trTarih = (t: string | null | undefined): string | null => {
  if (!t) return null;
  const [y, a, g] = t.split("-");
  return y && a && g ? `${g}.${a}.${y}` : t;
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await request.json();
    const {
      firmaId,
      muhasebeEmail,
      santiyeAdi,
      pdfUrl,
      dosyaAdi,
      itibarTarihi,
      onayTarihi,
      gonderenKullaniciAd,
    } = body as {
      firmaId?: string | null;
      muhasebeEmail: string;
      santiyeAdi: string;
      pdfUrl: string;
      dosyaAdi?: string;
      itibarTarihi?: string | null;
      onayTarihi?: string | null;
      gonderenKullaniciAd?: string;
    };

    if (!muhasebeEmail) return NextResponse.json({ error: "Muhasebe e-posta adresi tanımlı değil (Tanımlamalar > muhasebe_email)" }, { status: 400 });
    if (!pdfUrl) return NextResponse.json({ error: "PDF adresi gerekli" }, { status: 400 });

    // SMTP = İŞİN YÜKLENİCİ FİRMASI. Başka firmaya YEDEK DÜŞÜLMEZ: mail, işin ait olduğu firmanın
    // hesabından gitmelidir (bordro-mail-bulk ile aynı kural — yanlış firmadan mail gitmesin).
    if (!firmaId) return NextResponse.json({ error: "İşin yüklenici firması belirli değil" }, { status: 400 });
    const { data: firma } = await supabase.from("firmalar").select("*").eq("id", firmaId).maybeSingle();
    if (!firma) return NextResponse.json({ error: "İşin yüklenici firması bulunamadı" }, { status: 404 });
    if (!firma.smtp_host || !firma.smtp_user || !firma.smtp_password) {
      return NextResponse.json({
        error: `${firma.firma_adi} firmasının mail (SMTP) ayarları tanımlı değil — belge gönderilemedi. Yönetim > Firmalar'dan tanımlayın.`,
      }, { status: 400 });
    }

    // PDF'i storage'dan indir (service role → bucket public olmasa da iner). Olmazsa doğrudan URL'den çek.
    let pdf: Buffer | null = null;
    const konum = storageYolu(pdfUrl);
    if (konum) {
      const { data } = await supabase.storage.from(konum.bucket).download(konum.yol);
      if (data) pdf = Buffer.from(await data.arrayBuffer());
    }
    if (!pdf) {
      const res = await fetch(pdfUrl);
      if (!res.ok) return NextResponse.json({ error: `PDF indirilemedi (${res.status})` }, { status: 502 });
      pdf = Buffer.from(await res.arrayBuffer());
    }

    const transporter = nodemailer.createTransport({
      host: firma.smtp_host as string,
      port: Number(firma.smtp_port) || 587,
      secure: Number(firma.smtp_port) === 465,
      auth: { user: firma.smtp_user as string, pass: firma.smtp_password as string },
      tls: { rejectUnauthorized: false },
    });
    try { await transporter.verify(); } catch (e) {
      return NextResponse.json({ error: `SMTP bağlantı hatası: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
    }

    const itibar = trTarih(itibarTarihi), onay = trTarih(onayTarihi);
    const konu = `Geçici Kabul Belgesi — ${santiyeAdi}`;
    const metin = `Sayın Muhasebe,\n\n`
      + `${santiyeAdi} işine ait geçici kabul belgesi ektedir.\n\n`
      + (itibar ? `Geçici kabul itibar tarihi: ${itibar}\n` : "")
      + (onay ? `Geçici kabul onay tarihi: ${onay}\n` : "")
      + `\nİyi çalışmalar.`
      + (gonderenKullaniciAd ? `\n\n${gonderenKullaniciAd}` : "");

    const gonderenAd = (firma.smtp_sender_name as string) || (firma.firma_adi as string);
    const gonderenEmail = (firma.smtp_sender_email as string) || (firma.smtp_user as string);

    try {
      const info = await transporter.sendMail({
        from: `"${gonderenAd}" <${gonderenEmail}>`,
        to: muhasebeEmail,
        subject: konu,
        text: metin,
        attachments: [{
          filename: dosyaAdi || "gecici-kabul.pdf",
          content: pdf,
          contentType: "application/pdf",
        }],
      });
      return NextResponse.json({ mesaj: `Geçici kabul belgesi gönderildi → ${muhasebeEmail}`, messageId: info.messageId });
    } catch (err) {
      return NextResponse.json({ error: `Mail gönderim hatası: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ error: `Hata: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
