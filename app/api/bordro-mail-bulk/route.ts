// Bordro Mail Bulk — birden fazla değişikliği TEK mailde muhasebeye iletir
// Kullanıcı bordro üzerinde değişiklik yapar, sonunda "Mail Gönder" der → bu endpoint çağrılır.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

type ChangeTip = "giris" | "cikis" | "transfer";
type Change = {
  tip: ChangeTip;
  personelAd: string;
  personelTc?: string;
  personelGorev?: string;
  santiyeAd?: string;
  onceSantiyeAd?: string;
  tarih: string;
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
    const { firmaId, muhasebeEmail, changes, ekBilgi } = body as {
      firmaId: string;
      muhasebeEmail: string;
      changes: Change[];
      ekBilgi?: string;
    };

    if (!firmaId) return NextResponse.json({ error: "Firma ID gerekli" }, { status: 400 });
    if (!muhasebeEmail) return NextResponse.json({ error: "Muhasebe email gerekli" }, { status: 400 });
    if (!changes || changes.length === 0) {
      return NextResponse.json({ error: "Gönderilecek değişiklik yok" }, { status: 400 });
    }

    // İstenen firmayı dene; SMTP eksikse SMTP'si dolu olan herhangi bir firmaya fallback
    let { data: firma, error } = await supabase.from("firmalar").select("*").eq("id", firmaId).single();
    if (error || !firma) return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 });
    const smtpEksik = !firma.smtp_host || !firma.smtp_user || !firma.smtp_password;
    if (smtpEksik) {
      // SMTP'si tam olan başka bir firma var mı? (Tek SMTP yapılandırması yeterli)
      const { data: alternatif } = await supabase
        .from("firmalar").select("*")
        .not("smtp_host", "is", null).not("smtp_user", "is", null).not("smtp_password", "is", null)
        .limit(1).maybeSingle();
      if (alternatif) {
        firma = alternatif;
      } else {
        return NextResponse.json({
          error: `"${firma.firma_adi}" firması için SMTP ayarları eksik. ` +
            `Yönetim > Firmalar sayfasından firmayı düzenleyin ve SMTP Host / User / Password / Port alanlarını doldurun. ` +
            `Eksikler: ${[
              !firma.smtp_host && "Host",
              !firma.smtp_user && "User",
              !firma.smtp_password && "Password",
            ].filter(Boolean).join(", ")}`,
        }, { status: 400 });
      }
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

    // Konu
    const giris = changes.filter((c) => c.tip === "giris").length;
    const cikis = changes.filter((c) => c.tip === "cikis").length;
    const transfer = changes.filter((c) => c.tip === "transfer").length;
    const parcalar: string[] = [];
    if (giris) parcalar.push(`${giris} giriş`);
    if (cikis) parcalar.push(`${cikis} çıkış`);
    if (transfer) parcalar.push(`${transfer} transfer`);
    const konu = `Personel Bordro Bildirimi — ${parcalar.join(", ")}`;

    // Metin: kategori bazlı gruplandırılmış
    const blok = (baslik: string, liste: Change[], formatter: (c: Change) => string) => {
      if (liste.length === 0) return "";
      return `\n${baslik}:\n${liste.map((c, i) => `  ${i + 1}. ${formatter(c)}`).join("\n")}\n`;
    };

    const formatGiris = (c: Change) =>
      `${c.personelAd}` +
      (c.personelTc ? ` (TC: ${c.personelTc})` : "") +
      (c.personelGorev ? ` — ${c.personelGorev}` : "") +
      (c.santiyeAd ? ` → ${c.santiyeAd}` : "") +
      ` (${c.tarih})`;

    const formatCikis = (c: Change) =>
      `${c.personelAd}` +
      (c.personelTc ? ` (TC: ${c.personelTc})` : "") +
      (c.onceSantiyeAd ? ` (son şantiye: ${c.onceSantiyeAd})` : "") +
      ` (${c.tarih})`;

    const formatTransfer = (c: Change) =>
      `${c.personelAd}` +
      (c.personelTc ? ` (TC: ${c.personelTc})` : "") +
      `: ${c.onceSantiyeAd ?? "—"} → ${c.santiyeAd ?? "—"}` +
      ` (${c.tarih})`;

    let metin = `Sayın Muhasebe,\n\nAşağıdaki personel hareketleri gerçekleşmiştir:\n`;
    metin += blok("İŞE GİRİŞLER (sigorta giriş işlemi yapılması rica olunur)",
      changes.filter((c) => c.tip === "giris"), formatGiris);
    metin += blok("İŞTEN ÇIKIŞLAR (sigorta çıkış işlemi yapılması rica olunur)",
      changes.filter((c) => c.tip === "cikis"), formatCikis);
    metin += blok("ŞANTİYE TRANSFERLERİ (bilgilerinize)",
      changes.filter((c) => c.tip === "transfer"), formatTransfer);
    if (ekBilgi && ekBilgi.trim()) metin += `\n${ekBilgi.trim()}\n`;
    metin += `\nİyi çalışmalar.`;

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
        mesaj: `${changes.length} değişiklik tek mailde gönderildi`,
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
