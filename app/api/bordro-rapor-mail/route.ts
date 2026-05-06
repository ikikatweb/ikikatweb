// Bordro Rapor Mail — seçili ayın bordro Excel raporunu muhasebeye gönderir
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

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
      ay,           // "Mayıs 2026" gibi etiket
      ayKey,        // "2026-05" formatı (dosya adı için)
      excelBase64,  // base64 encoded xlsx
      ekBilgi,
    } = body as {
      firmaId: string;
      muhasebeEmail: string;
      ay: string;
      ayKey: string;
      excelBase64: string;
      ekBilgi?: string;
    };

    if (!firmaId) return NextResponse.json({ error: "Firma ID gerekli" }, { status: 400 });
    if (!muhasebeEmail) return NextResponse.json({ error: "Muhasebe email gerekli" }, { status: 400 });
    if (!excelBase64) return NextResponse.json({ error: "Excel verisi gerekli" }, { status: 400 });

    // SMTP ayarları olan firmayı bul (önce verileni dene, yoksa fallback)
    let { data: firma, error } = await supabase.from("firmalar").select("*").eq("id", firmaId).single();
    if (error || !firma) return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 });
    if (!firma.smtp_host || !firma.smtp_user || !firma.smtp_password) {
      const { data: alternatif } = await supabase
        .from("firmalar").select("*")
        .not("smtp_host", "is", null).not("smtp_user", "is", null).not("smtp_password", "is", null)
        .limit(1).maybeSingle();
      if (alternatif) firma = alternatif;
      else return NextResponse.json({ error: "Hiçbir firmada SMTP ayarları yok" }, { status: 400 });
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

    const konu = `Bordro Raporu — ${ay}`;
    const metin = `Sayın Muhasebe,\n\n` +
      `${ay} dönemine ait bordro raporu ektedir.\n\n` +
      (ekBilgi && ekBilgi.trim() ? `${ekBilgi.trim()}\n\n` : "") +
      `İyi çalışmalar.`;

    const gonderenAd = firma.smtp_sender_name || firma.firma_adi;
    const gonderenEmail = firma.smtp_sender_email || firma.smtp_user;

    try {
      const info = await transporter.sendMail({
        from: `"${gonderenAd}" <${gonderenEmail}>`,
        to: muhasebeEmail,
        subject: konu,
        text: metin,
        attachments: [
          {
            filename: `bordro-${ayKey}.xlsx`,
            content: Buffer.from(excelBase64, "base64"),
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ],
      });
      return NextResponse.json({
        mesaj: `Bordro raporu gönderildi → ${muhasebeEmail}`,
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
