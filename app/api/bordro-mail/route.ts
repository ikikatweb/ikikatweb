// Bordro Mail API — personel giriş/çıkış/transfer durumlarında muhasebeye mail gönderir
// Firmanın SMTP ayarlarını kullanır (acente teklif maili ile aynı pattern).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

type BordroMailTip = "giris" | "cikis" | "transfer";

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
      tip,
      personelAd,
      personelTc,
      personelGorev,
      santiyeAd,
      onceSantiyeAd,
      tarih,
      ekBilgi,
      gonderenKullaniciAd,
      teknik,
    } = body as {
      firmaId: string;
      muhasebeEmail: string;
      tip: BordroMailTip;
      personelAd: string;
      personelTc?: string;
      personelGorev?: string;
      santiyeAd?: string;
      onceSantiyeAd?: string;
      tarih: string;
      ekBilgi?: string;
      gonderenKullaniciAd?: string;
      teknik?: boolean;
    };

    if (!muhasebeEmail) {
      return NextResponse.json({ error: "Muhasebe email adresi gerekli" }, { status: 400 });
    }
    if (!firmaId) {
      return NextResponse.json({ error: "Firma ID gerekli" }, { status: 400 });
    }

    // Firma SMTP
    const { data: firma, error: firmaError } = await supabase
      .from("firmalar").select("*").eq("id", firmaId).single();
    if (firmaError || !firma) {
      return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 });
    }
    if (!firma.smtp_host || !firma.smtp_user || !firma.smtp_password) {
      return NextResponse.json({
        error: `Firma SMTP ayarları eksik. Firma düzenleme sayfasından girin.`,
      }, { status: 400 });
    }

    const transporter = nodemailer.createTransport({
      host: firma.smtp_host,
      port: firma.smtp_port || 587,
      secure: firma.smtp_port === 465,
      auth: { user: firma.smtp_user, pass: firma.smtp_password },
      tls: { rejectUnauthorized: false },
    });

    try { await transporter.verify(); } catch (e) {
      return NextResponse.json({
        error: `SMTP bağlantı hatası: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 500 });
    }

    // Konu + metin
    let konu = "";
    let metin = "";
    if (tip === "giris") {
      konu = `Personel İşe Giriş Bildirimi — ${personelAd}`;
      metin = `Sayın Muhasebe,\n\n` +
        `Aşağıda bilgileri verilen personel firmamızda işe başlamıştır:\n\n` +
        `Ad Soyad : ${personelAd}${teknik ? " (Teknik Personel)" : ""}\n` +
        (personelTc ? `TC Kimlik No : ${personelTc}\n` : "") +
        (personelGorev ? `Görev : ${personelGorev}\n` : "") +
        (santiyeAd ? `Şantiye : ${santiyeAd}\n` : "") +
        `İşe Başlama Tarihi : ${tarih}\n\n` +
        `Sigorta giriş işlemlerinin yapılmasını rica ederiz.\n\n` +
        (ekBilgi ? `${ekBilgi}\n\n` : "") +
        `İyi çalışmalar.` +
        (gonderenKullaniciAd ? `\n\n${gonderenKullaniciAd}` : "");
    } else if (tip === "cikis") {
      konu = `Personel İşten Çıkış Bildirimi — ${personelAd}`;
      metin = `Sayın Muhasebe,\n\n` +
        `Aşağıda bilgileri verilen personel firmamızdan ayrılmıştır:\n\n` +
        `Ad Soyad : ${personelAd}${teknik ? " (Teknik Personel)" : ""}\n` +
        (personelTc ? `TC Kimlik No : ${personelTc}\n` : "") +
        (personelGorev ? `Görev : ${personelGorev}\n` : "") +
        (onceSantiyeAd ? `Son Şantiye : ${onceSantiyeAd}\n` : "") +
        `İşten Çıkış Tarihi : ${tarih}\n\n` +
        `Sigorta çıkış işlemlerinin yapılmasını rica ederiz.\n\n` +
        (ekBilgi ? `${ekBilgi}\n\n` : "") +
        `İyi çalışmalar.` +
        (gonderenKullaniciAd ? `\n\n${gonderenKullaniciAd}` : "");
    } else {
      konu = `Personel Şantiye Transferi — ${personelAd}`;
      metin = `Sayın Muhasebe,\n\n` +
        `Aşağıda bilgileri verilen personel şantiye değişikliği yapmıştır:\n\n` +
        `Ad Soyad : ${personelAd}${teknik ? " (Teknik Personel)" : ""}\n` +
        (personelTc ? `TC Kimlik No : ${personelTc}\n` : "") +
        (onceSantiyeAd ? `Önceki Şantiye : ${onceSantiyeAd}\n` : "") +
        (santiyeAd ? `Yeni Şantiye : ${santiyeAd}\n` : "") +
        `Transfer Tarihi : ${tarih}\n\n` +
        (ekBilgi ? `${ekBilgi}\n\n` : "") +
        `Bilgilerinize.`;
    }

    const gonderenAd = firma.smtp_sender_name || firma.firma_adi;
    const gonderenEmail = firma.smtp_sender_email || firma.smtp_user;

    try {
      const info = await transporter.sendMail({
        from: `"${gonderenAd}" <${gonderenEmail}>`,
        to: muhasebeEmail,
        subject: konu,
        text: metin,
      });
      return NextResponse.json({
        mesaj: "Mail gönderildi",
        messageId: info.messageId,
      });
    } catch (err) {
      return NextResponse.json({
        error: `Mail gönderim hatası: ${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Hata: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
