// Teklif talebi mail gönderme API — acentelere otomatik mail
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
    const { acenteEmails, plaka, policeTipi, ruhsatUrl, ekBilgi, firmaId } = body as {
      acenteEmails: string[];
      plaka: string;
      policeTipi: "kasko" | "trafik";
      ruhsatUrl: string | null;
      ekBilgi: string;
      firmaId: string;
    };

    if (!acenteEmails || acenteEmails.length === 0) {
      return NextResponse.json({ error: "En az bir acente email adresi gerekli" }, { status: 400 });
    }

    // Firma SMTP ayarlarını çek
    const { data: firma, error: firmaError } = await supabase
      .from("firmalar")
      .select("*")
      .eq("id", firmaId)
      .single();

    if (firmaError || !firma) {
      return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 });
    }

    if (!firma.smtp_host || !firma.smtp_user || !firma.smtp_password) {
      return NextResponse.json({
        error: `Firma SMTP ayarları eksik. Host: ${firma.smtp_host ? "✓" : "✗"}, User: ${firma.smtp_user ? "✓" : "✗"}, Pass: ${firma.smtp_password ? "✓" : "✗"}. Firma düzenleme sayfasından SMTP bilgilerini girin.`
      }, { status: 400 });
    }

    console.log(`[Teklif Mail] SMTP: ${firma.smtp_host}:${firma.smtp_port}, User: ${firma.smtp_user}, Sender: ${firma.smtp_sender_email}, Alıcılar: ${acenteEmails.join(", ")}`);

    // Nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: firma.smtp_host,
      port: firma.smtp_port || 587,
      secure: firma.smtp_port === 465,
      auth: {
        user: firma.smtp_user,
        pass: firma.smtp_password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      logger: true,
      debug: true,
    });

    // SMTP bağlantısını doğrula
    try {
      await transporter.verify();
      console.log("[Teklif Mail] SMTP bağlantısı başarılı");
    } catch (verifyErr) {
      console.error("[Teklif Mail] SMTP bağlantı hatası:", verifyErr);
      return NextResponse.json({
        error: `SMTP bağlantı hatası: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}. Host: ${firma.smtp_host}, Port: ${firma.smtp_port}, User: ${firma.smtp_user}`
      }, { status: 500 });
    }

    // Poliçe tipi metni
    const tipMetni = policeTipi === "kasko" ? "kasko" : "trafik sigortası";

    // Mail konusu
    const konu = `${plaka} - ${policeTipi === "kasko" ? "Kasko" : "Trafik Sigortası"} Teklif Talebi`;

    // Mail metni
    let metin = `Ekte ruhsat fotokopisi bulunan ${plaka} plakalı aracımızın süresi dolan ${tipMetni} poliçesi için yenileme teklifi çalışmasının yapılmasını rica ederiz.`;
    if (ekBilgi && ekBilgi.trim()) {
      metin += `\n\n${ekBilgi.trim()}`;
    }
    metin += "\n\nİyi çalışmalar.";

    // Ruhsat ekini hazırla
    const attachments: { filename: string; content: Buffer }[] = [];
    if (ruhsatUrl) {
      try {
        const ruhsatResponse = await fetch(ruhsatUrl);
        if (ruhsatResponse.ok) {
          const arrayBuffer = await ruhsatResponse.arrayBuffer();
          const ext = ruhsatUrl.split(".").pop() ?? "pdf";
          attachments.push({
            filename: `ruhsat-${plaka.replace(/\s+/g, "-")}.${ext}`,
            content: Buffer.from(arrayBuffer),
          });
        }
      } catch {
        // Ruhsat indirilemezse ek olmadan gönder
      }
    }

    // Her acenteye mail gönder
    const gonderenAd = firma.smtp_sender_name || firma.firma_adi;
    const gonderenEmail = firma.smtp_sender_email || firma.smtp_user;
    const sonuclar: { email: string; basarili: boolean; hata?: string }[] = [];

    for (const email of acenteEmails) {
      try {
        const info = await transporter.sendMail({
          from: `"${gonderenAd}" <${gonderenEmail}>`,
          to: email,
          subject: konu,
          text: metin,
          attachments,
        });
        console.log(`[Teklif Mail] Gönderildi → ${email}, messageId: ${info.messageId}, response: ${info.response}`);
        sonuclar.push({ email, basarili: true, hata: info.response });
      } catch (err) {
        console.error(`[Teklif Mail] HATA → ${email}:`, err);
        sonuclar.push({ email, basarili: false, hata: err instanceof Error ? err.message : String(err) });
      }
    }

    const basarili = sonuclar.filter((s) => s.basarili).length;
    const basarisiz = sonuclar.filter((s) => !s.basarili).length;

    return NextResponse.json({
      mesaj: `${basarili} mail gönderildi${basarisiz > 0 ? `, ${basarisiz} başarısız` : ""}`,
      sonuclar,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Mail gönderme hatası: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
