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

    // Yardımcı: personel listesini doğal Türkçe formatta birleştir.
    //  1 personel: "12345 TC Numaralı Ahmet ÇELİK İsimli personelin"
    //  2+ personel: "12345 TC Numaralı Ahmet ÇELİK ve 67890 TC Numaralı Ali VELİ İsimli personellerin"
    function personelListesiMetni(liste: Change[], tekil: string, cogul: string): string {
      const isimler = liste.map((c) =>
        c.personelTc
          ? `${c.personelTc} TC Numaralı ${c.personelAd}`
          : c.personelAd
      );
      if (isimler.length === 0) return "";
      let birlestirilmis: string;
      if (isimler.length === 1) birlestirilmis = isimler[0];
      else if (isimler.length === 2) birlestirilmis = `${isimler[0]} ve ${isimler[1]}`;
      else birlestirilmis = `${isimler.slice(0, -1).join(", ")} ve ${isimler[isimler.length - 1]}`;
      return `${birlestirilmis} İsimli ${isimler.length === 1 ? tekil : cogul}`;
    }

    // Giriş cümleleri (şantiyeye göre grupla — aynı şantiyeye giren personeller tek cümlede)
    const girisCumleleri: string[] = [];
    {
      const grup = new Map<string, Change[]>();
      for (const c of changes.filter((c) => c.tip === "giris")) {
        const key = c.santiyeAd || "(şantiye yok)";
        if (!grup.has(key)) grup.set(key, []);
        grup.get(key)!.push(c);
      }
      for (const [santiyeAd, list] of grup) {
        const kisi = personelListesiMetni(list, "personelin", "personellerin");
        if (list.length === 1) {
          girisCumleleri.push(
            `${kisi} ${santiyeAd} şantiyesine bugün tarihli girişinin yapılmasında yardımcı olur musunuz?`
          );
        } else {
          girisCumleleri.push(
            `${kisi} ${santiyeAd} şantiyesine bugün tarihli girişlerinin yapılmasında yardımcı olur musunuz?`
          );
        }
      }
    }

    // Çıkış cümleleri (tek cümle — herkes aynı tarihte ayrılmış sayılır)
    const cikisCumleleri: string[] = [];
    {
      const liste = changes.filter((c) => c.tip === "cikis");
      if (liste.length === 1) {
        const kisi = personelListesiMetni(liste, "personel", "personeller");
        cikisCumleleri.push(
          `${kisi} bugün tarihli işten ayrılmıştır, çıkışını yapabilir misiniz?`
        );
      } else if (liste.length > 1) {
        const kisi = personelListesiMetni(liste, "personel", "personeller");
        cikisCumleleri.push(
          `${kisi} bugün tarihli işten ayrılmışlardır, çıkışlarını yapabilir misiniz?`
        );
      }
    }

    // Transfer cümleleri (eski şantiye → yeni şantiye bazında grupla)
    // Format:
    //  Tek kişi: "... isimli personelin X şantiyesinden çıkışının yapılması, Y şantiyesine girişinin yapılmasında yardımcı olur musunuz?"
    //  Çoklu  : "... isimli personellerin X şantiyesinden çıkışlarının yapılması, Y şantiyesine girişlerinin yapılmasında yardımcı olur musunuz?"
    const transferCumleleri: string[] = [];
    {
      const grup = new Map<string, Change[]>();
      for (const c of changes.filter((c) => c.tip === "transfer")) {
        const key = `${c.onceSantiyeAd || "?"}→${c.santiyeAd || "?"}`;
        if (!grup.has(key)) grup.set(key, []);
        grup.get(key)!.push(c);
      }
      for (const [, list] of grup) {
        const kisi = personelListesiMetni(list, "personelin", "personellerin");
        const ilk = list[0];
        const eski = ilk.onceSantiyeAd ?? "—";
        const yeni = ilk.santiyeAd ?? "—";
        if (list.length === 1) {
          transferCumleleri.push(
            `${kisi} ${eski} şantiyesinden çıkışının yapılması, ${yeni} şantiyesine girişinin yapılmasında yardımcı olur musunuz?`
          );
        } else {
          transferCumleleri.push(
            `${kisi} ${eski} şantiyesinden çıkışlarının yapılması, ${yeni} şantiyesine girişlerinin yapılmasında yardımcı olur musunuz?`
          );
        }
      }
    }

    let metin = `Sayın Muhasebe,\n\n`;
    if (girisCumleleri.length > 0) metin += girisCumleleri.join("\n\n") + "\n\n";
    if (cikisCumleleri.length > 0) metin += cikisCumleleri.join("\n\n") + "\n\n";
    if (transferCumleleri.length > 0) metin += transferCumleleri.join("\n\n") + "\n\n";
    if (ekBilgi && ekBilgi.trim()) metin += `${ekBilgi.trim()}\n\n`;
    metin += `İyi çalışmalar.`;

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
