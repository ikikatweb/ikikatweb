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
  personelMeslek?: string;
  santiyeAd?: string;
  onceSantiyeAd?: string;
  tarih: string;
  // Kullanıcının mail önizlemede her satıra yazabildiği özel not
  // Mailde personelin altında KIRMIZI renkle gösterilir
  not?: string;
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
    //  1 personel: "12345 TC Numaralı Ahmet ÇELİK (Operatör) İsimli personelin"
    //  2+ personel: "... ve ... İsimli personellerin"
    // Meslek varsa parantez içinde isim sonrasına eklenir.
    function personelListesiMetni(liste: Change[], tekil: string, cogul: string): string {
      const isimler = liste.map((c) => {
        const adKismi = c.personelTc
          ? `${c.personelTc} TC Numaralı ${c.personelAd}`
          : c.personelAd;
        return c.personelMeslek ? `${adKismi} (${c.personelMeslek})` : adKismi;
      });
      if (isimler.length === 0) return "";
      let birlestirilmis: string;
      if (isimler.length === 1) birlestirilmis = isimler[0];
      else if (isimler.length === 2) birlestirilmis = `${isimler[0]} ve ${isimler[1]}`;
      else birlestirilmis = `${isimler.slice(0, -1).join(", ")} ve ${isimler[isimler.length - 1]}`;
      return `${birlestirilmis} İsimli ${isimler.length === 1 ? tekil : cogul}`;
    }

    // Tarih formatı: YYYY-MM-DD → DD.MM.YYYY
    function tarihFormatla(s: string): string {
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return s;
      return `${m[3]}.${m[2]}.${m[1]}`;
    }
    const firmaAdi = firma.firma_adi ?? "";

    // Her cümleyle birlikte personel notlarını da taşı (varsa)
    type CumleNot = { cumle: string; notlar: { personel: string; not: string }[] };

    // Giriş cümleleri — her personel için ayrı cümle, FIRMA + ŞANTİYE + MESLEK dahil
    const girisCumleleri: CumleNot[] = [];
    for (const c of changes.filter((c) => c.tip === "giris")) {
      const tc = c.personelTc ? `${c.personelTc} TC kimlik numaralı ` : "";
      const meslek = c.personelMeslek ? `${c.personelMeslek} mesleğindeki ` : "";
      const tarihStr = tarihFormatla(c.tarih);
      const santiye = c.santiyeAd ?? "—";
      girisCumleleri.push({
        cumle: `${tc}${c.personelAd} isimli ${meslek}personeli ${tarihStr} tarihi itibariyle ${firmaAdi} bünyesinde bulunan ${santiye} işine giriş işlemlerinin yapılmasını rica ederiz.`,
        notlar: c.not && c.not.trim() ? [{ personel: c.personelAd, not: c.not.trim() }] : [],
      });
    }

    // Çıkış cümleleri — her personel için ayrı cümle, FIRMA + ŞANTİYE + MESLEK dahil
    const cikisCumleleri: CumleNot[] = [];
    for (const c of changes.filter((c) => c.tip === "cikis")) {
      const tc = c.personelTc ? `${c.personelTc} TC kimlik numaralı ` : "";
      const meslek = c.personelMeslek ? `${c.personelMeslek} mesleğindeki ` : "";
      const tarihStr = tarihFormatla(c.tarih);
      const santiye = c.onceSantiyeAd ?? "—";
      cikisCumleleri.push({
        cumle: `${tc}${c.personelAd} isimli ${meslek}personel ${tarihStr} tarihi itibariyle ${firmaAdi} bünyesinde bulunan ${santiye} işinden ayrılmıştır gerekli işlemin yapılmasını rica ederiz.`,
        notlar: c.not && c.not.trim() ? [{ personel: c.personelAd, not: c.not.trim() }] : [],
      });
    }

    // Transfer cümleleri (eski şantiye → yeni şantiye bazında grupla)
    // Notlar gruplanmış cümlenin altında kişi-kişi listelenir.
    const transferCumleleri: CumleNot[] = [];
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
        const cumle = list.length === 1
          ? `${kisi} ${eski} şantiyesinden çıkışının yapılarak, ${yeni} şantiyesine girişinin yapılmasını rica ederiz.`
          : `${kisi} ${eski} şantiyesinden çıkışlarının yapılarak, ${yeni} şantiyesine girişlerinin yapılmasını rica ederiz.`;
        const notlar = list
          .filter((c) => c.not && c.not.trim())
          .map((c) => ({ personel: c.personelAd, not: c.not!.trim() }));
        transferCumleleri.push({ cumle, notlar });
      }
    }

    // Plain text fallback (HTML desteklemeyen istemciler için)
    // Her personel notu, ait olduğu cümlenin hemen altında "Not (Ad Soyad): ..." şeklinde belirir.
    // Notlardan sonra 1 boş satır.
    function cumleleriMetne(items: CumleNot[]): string {
      return items.map((it) => {
        let s = it.cumle;
        for (const n of it.notlar) {
          s += `\n${n.personel}: ${n.not}`;
        }
        // Notu olan satırın sonuna 1 ek boş satır (ayırıcı görsel boşluk)
        if (it.notlar.length > 0) s += "\n";
        return s;
      }).join("\n\n");
    }

    let metin = `Sayın Muhasebe,\n\n`;
    if (girisCumleleri.length > 0) metin += cumleleriMetne(girisCumleleri) + "\n\n";
    if (cikisCumleleri.length > 0) metin += cumleleriMetne(cikisCumleleri) + "\n\n";
    if (transferCumleleri.length > 0) metin += cumleleriMetne(transferCumleleri) + "\n\n";
    if (ekBilgi && ekBilgi.trim()) metin += `${ekBilgi.trim()}\n\n`;
    metin += `İyi çalışmalar.`;

    // HTML versiyon — her personelin notu KIRMIZI ile satır altında çıkar
    function htmlEscape(s: string): string {
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    const baseStyle = "font-family:Arial,sans-serif;font-size:14px;color:#1F2937;line-height:1.6;";
    // Sade kırmızı not stili — kutu yok, sadece kırmızı yazı + altta boşluk
    const noteStyle = "color:#DC2626;font-weight:600;margin:0 0 16px 0;";

    function cumleleriHtmle(items: CumleNot[]): string {
      let out = "";
      for (const it of items) {
        // Notu olan satırda alt boşluğu nota bırakıyoruz
        const cumleMargin = it.notlar.length > 0 ? "0 0 4px 0" : "0 0 12px 0";
        out += `<p style="margin:${cumleMargin};">${htmlEscape(it.cumle)}</p>`;
        for (const n of it.notlar) {
          const safe = htmlEscape(n.not).replace(/\n/g, "<br/>");
          out += `<p style="${noteStyle}"><strong>${htmlEscape(n.personel)}:</strong> ${safe}</p>`;
        }
      }
      return out;
    }

    let html = `<div style="${baseStyle}">`;
    html += `<p>Sayın Muhasebe,</p>`;
    html += cumleleriHtmle(girisCumleleri);
    html += cumleleriHtmle(cikisCumleleri);
    html += cumleleriHtmle(transferCumleleri);
    if (ekBilgi && ekBilgi.trim()) {
      const ekHtml = htmlEscape(ekBilgi.trim()).replace(/\n/g, "<br/>");
      html += `<p style="color:#DC2626;font-weight:600;">${ekHtml}</p>`;
    }
    html += `<p>İyi çalışmalar.</p>`;
    html += `</div>`;

    const gonderenAd = firma.smtp_sender_name || firma.firma_adi;
    const gonderenEmail = firma.smtp_sender_email || firma.smtp_user;

    try {
      const info = await transporter.sendMail({
        from: `"${gonderenAd}" <${gonderenEmail}>`,
        to: muhasebeEmail,
        subject: konu,
        text: metin,
        html,
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
