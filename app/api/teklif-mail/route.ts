// Teklif talebi mail gönderme API — acentelere otomatik mail
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { KASKO_TEKLIF_KATEGORI, cinsToKaskoSinif, kaskoSablonVarsayilan, TEKLIF_TALEP_KATEGORI, TEKLIF_TALEP_VARSAYILAN } from "@/lib/kasko-teklif-sablon";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await request.json();
    const { acenteEmails, plaka, policeTipi, ruhsatUrl, ekBilgi, firmaId, gonderenKullanici } = body as {
      acenteEmails: string[];
      plaka: string;
      policeTipi: "kasko" | "trafik";
      ruhsatUrl: string | null;
      ekBilgi: string;
      firmaId: string;
      gonderenKullanici?: string | null;
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

    // KASKO: araç SINIFINA göre şartlar metnini en ÜSTE ekle (Tanımlamalar → kasko_teklif_sablon; yoksa varsayılan).
    // Trafik sigortası maili DEĞİŞMEZ. Sınıf, aracın cinsinden türetilir (çekici/kamyonet/kamyon/binek).
    let kaskoUst = "";
    if (policeTipi === "kasko") {
      try {
        const { data: aracRow } = await supabase.from("araclar").select("cinsi").eq("plaka", plaka).limit(1).maybeSingle();
        const sinif = cinsToKaskoSinif(aracRow?.cinsi as string | null | undefined);
        if (sinif) {
          const { data: sab } = await supabase.from("tanimlamalar")
            .select("deger").eq("kategori", KASKO_TEKLIF_KATEGORI).eq("kisa_ad", sinif).limit(1).maybeSingle();
          const ozel = sab?.deger ? String(sab.deger).trim() : "";
          kaskoUst = ozel || kaskoSablonVarsayilan(sinif);
        }
      } catch { /* sessiz — şartlar eklenemezse standart mail gider */ }
    }

    // Teklif TALEP cümlesi — KASKO ve TRAFİK AYRI (kisa_ad = "kasko"/"trafik"). Böylece kaskoya özel düzenleme
    // trafik mailini etkilemez. Legacy tek "genel" kayıt varsa yalnız kaskoda geri-uyum için kullanılır.
    // {plaka} ve {tip} yer tutucuları.
    let talepSablon = TEKLIF_TALEP_VARSAYILAN;
    try {
      const { data: talepRows } = await supabase.from("tanimlamalar")
        .select("kisa_ad, deger").eq("kategori", TEKLIF_TALEP_KATEGORI);
      const byKisa = (k: string) => (talepRows ?? []).find((r) => r.kisa_ad === k)?.deger as string | undefined;
      const val = byKisa(policeTipi) ?? (policeTipi === "kasko" ? byKisa("genel") : undefined);
      if (val && String(val).trim()) talepSablon = String(val);
    } catch { /* sessiz — varsayılan kullanılır */ }
    const talepText = talepSablon.replace(/\{plaka\}/g, plaka).replace(/\{tip\}/g, tipMetni);

    // Mail metni (düz metin sürümü — HTML desteklemeyen istemciler için)
    let metin = "";
    if (kaskoUst.trim()) metin += `${kaskoUst.trim()}\n\n`;
    metin += talepText;
    if (ekBilgi && ekBilgi.trim()) {
      metin += `\n\n${ekBilgi.trim()}`;
    }
    metin += "\n\nİyi çalışmalar.";
    if (gonderenKullanici && gonderenKullanici.trim()) {
      metin += `\n${gonderenKullanici.trim()}`;
    }

    // HTML sürüm — not kırmızı ve kalın görünsün
    const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const htmlBr = (s: string) => htmlEscape(s).replace(/\n/g, "<br>");
    const talepHtml = htmlEscape(talepSablon)
      .replace(/\{plaka\}/g, `<strong>${htmlEscape(plaka)}</strong>`)
      .replace(/\{tip\}/g, htmlEscape(tipMetni))
      .replace(/\n/g, "<br>");
    let html = "";
    if (kaskoUst.trim()) html += `<p style="margin-bottom:14px;">${htmlBr(kaskoUst.trim())}</p>`;
    html += `<p>${talepHtml}</p>`;
    // Kullanıcının yazdığı not KIRMIZI ve kalın görünsün.
    if (ekBilgi && ekBilgi.trim()) {
      html += `<p style="color:#dc2626;font-weight:bold;">${htmlBr(ekBilgi.trim())}</p>`;
    }
    html += gonderenKullanici && gonderenKullanici.trim()
      ? `<p>İyi çalışmalar.<br>${htmlEscape(gonderenKullanici.trim())}</p>`
      : `<p>İyi çalışmalar.</p>`;

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
          html,
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
