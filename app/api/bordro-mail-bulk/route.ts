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
  personelOgrenim?: string; // öğrenim durumu — cümlede "öğrenim durumu X olan" biçiminde geçer
  santiyeAd?: string;
  onceSantiyeAd?: string;
  // Tarih anlamları:
  //   giris  → işe giriş tarihi
  //   cikis  → işten çıkış tarihi
  //   transfer → YENİ şantiyeye giriş tarihi
  tarih: string;
  // Sadece transferde anlamlı: ESKİ şantiyeden çıkış tarihi
  cikisTarih?: string;
  not?: string;
  teknik?: boolean;
  teknikIsim?: string | null;
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
    const { firmaId, muhasebeEmail, changes, ekBilgi, gonderenKullaniciAd } = body as {
      firmaId: string;
      muhasebeEmail: string;
      changes: Change[];
      ekBilgi?: string;
      gonderenKullaniciAd?: string;
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
    // ŞU ANDA KULLANILMIYOR — transferler artık kişi-kişi ayrı cümlelerle gönderiliyor.
    // İleride grup mesajlama tekrar gerekirse kullanılabilir.
    //  1 personel: "12345 TC Numaralı Ahmet ÇELİK (Operatör) İsimli personelin"
    //  2+ personel: "... ve ... İsimli personellerin"
    // Meslek varsa parantez içinde isim sonrasına eklenir.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function personelListesiMetni(liste: Change[], tekil: string, cogul: string): string {
      const isimler = liste.map((c) => {
        const adKismi = c.personelTc
          ? `${c.personelTc} TC Numaralı ${c.personelAd}`
          : c.personelAd;
        const meslekKismi = c.personelMeslek ? ` (${c.personelMeslek})` : "";
        const teknikKismi = c.teknik ? " [Teknik Personel]" : "";
        return `${adKismi}${meslekKismi}${teknikKismi}`;
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

    // Her cümleyle birlikte personel notlarını da taşı (varsa) — aşağıdaki
    // CumleNotParca tipi, parça parça (renkli vurgu için) saklar.

    // Tip türü — HTML üretimi için renklerle birlikte parça parça tutarız
    // (renkli alanları sonradan span ile sarmalayabilelim).
    type CumleParca =
      | { tip: "metin"; deger: string }
      | { tip: "vurguYesil"; deger: string }   // koyu yeşil — giriş
      | { tip: "vurguKirmizi"; deger: string }; // koyu kırmızı — çıkış
    type CumleNotParca = { parcalar: CumleParca[]; notlar: { personel: string; not: string }[] };

    // Giriş cümleleri — name, date, "giriş" KOYU YEŞİL
    const girisCumleleri: CumleNotParca[] = [];
    for (const c of changes.filter((c) => c.tip === "giris")) {
      const tc = c.personelTc ? `${c.personelTc} TC kimlik numaralı ` : "";
      const meslek = c.personelMeslek ? `${c.personelMeslek} mesleğindeki ` : "";
      const ogrenim = c.personelOgrenim ? `öğrenim durumu ${c.personelOgrenim} olan ` : "";
      const teknikEk = c.teknik ? " (Teknik Personel)" : "";
      const tarihStr = tarihFormatla(c.tarih);
      const santiye = c.santiyeAd ?? "—";
      girisCumleleri.push({
        parcalar: [
          { tip: "metin", deger: tc },
          { tip: "vurguYesil", deger: `${c.personelAd}${teknikEk}` },
          { tip: "metin", deger: ` isimli ${meslek}${ogrenim}personeli ` },
          { tip: "vurguYesil", deger: tarihStr },
          { tip: "metin", deger: ` tarihinde ${firmaAdi} bünyesinde bulunan ${santiye} işine ` },
          { tip: "vurguYesil", deger: "giriş" },
          { tip: "metin", deger: " işlemlerinin yapılmasını rica ederiz." },
        ],
        notlar: c.not && c.not.trim() ? [{ personel: c.personelAd, not: c.not.trim() }] : [],
      });
    }

    // Çıkış cümleleri — name, date, "ayrılmıştır" KOYU KIRMIZI
    const cikisCumleleri: CumleNotParca[] = [];
    for (const c of changes.filter((c) => c.tip === "cikis")) {
      const tc = c.personelTc ? `${c.personelTc} TC kimlik numaralı ` : "";
      const meslek = c.personelMeslek ? `${c.personelMeslek} mesleğindeki ` : "";
      const ogrenim = c.personelOgrenim ? `öğrenim durumu ${c.personelOgrenim} olan ` : "";
      const teknikEk = c.teknik ? " (Teknik Personel)" : "";
      const tarihStr = tarihFormatla(c.tarih);
      const santiye = c.onceSantiyeAd ?? "—";
      cikisCumleleri.push({
        parcalar: [
          { tip: "metin", deger: tc },
          { tip: "vurguKirmizi", deger: `${c.personelAd}${teknikEk}` },
          { tip: "metin", deger: ` isimli ${meslek}${ogrenim}personel ` },
          { tip: "vurguKirmizi", deger: tarihStr },
          { tip: "metin", deger: ` tarihinde ${firmaAdi} bünyesinde bulunan ${santiye} işinden ` },
          { tip: "vurguKirmizi", deger: "ayrılmıştır" },
          { tip: "metin", deger: " gerekli işlemin yapılmasını rica ederiz." },
        ],
        notlar: c.not && c.not.trim() ? [{ personel: c.personelAd, not: c.not.trim() }] : [],
      });
    }

    // Transfer cümleleri — HEM çıkış (kırmızı) HEM giriş (yeşil) tarihleri görünür
    const transferCumleleri: CumleNotParca[] = [];
    for (const c of changes.filter((c) => c.tip === "transfer")) {
      const tc = c.personelTc ? `${c.personelTc} TC kimlik numaralı ` : "";
      const meslek = c.personelMeslek ? `${c.personelMeslek} mesleğindeki ` : "";
      const ogrenim = c.personelOgrenim ? `öğrenim durumu ${c.personelOgrenim} olan ` : "";
      const teknikEk = c.teknik ? " (Teknik Personel)" : "";
      const girisTarihStr = tarihFormatla(c.tarih);
      // cikisTarih yoksa girişle aynı kullanılır (uyum için)
      const cikisTarihStr = tarihFormatla(c.cikisTarih ?? c.tarih);
      const eski = c.onceSantiyeAd ?? "—";
      const yeni = c.santiyeAd ?? "—";
      transferCumleleri.push({
        parcalar: [
          { tip: "metin", deger: tc },
          { tip: "vurguYesil", deger: `${c.personelAd}${teknikEk}` },
          { tip: "metin", deger: ` isimli ${meslek}${ogrenim}personelin ${firmaAdi} bünyesindeki ${eski} şantiyesinden ` },
          { tip: "vurguKirmizi", deger: `çıkış tarihi ${cikisTarihStr}` },
          { tip: "metin", deger: `, ${yeni} şantiyesine ` },
          { tip: "vurguYesil", deger: `giriş tarihi ${girisTarihStr}` },
          { tip: "metin", deger: " olarak işlemlerinin yapılmasını rica ederiz." },
        ],
        notlar: c.not && c.not.trim() ? [{ personel: c.personelAd, not: c.not.trim() }] : [],
      });
    }

    // Plain text fallback (HTML desteklemeyen istemciler için)
    // Renkleri kaldırıp düz metin oluşturur.
    function cumleleriMetne(items: CumleNotParca[]): string {
      return items.map((it) => {
        let s = it.parcalar.map((p) => p.deger).join("");
        for (const n of it.notlar) {
          s += `\n${n.personel}: ${n.not}`;
        }
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
    if (gonderenKullaniciAd) metin += `\n\n${gonderenKullaniciAd}`;

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

    // Renkli vurgu stilleri — koyu yeşil (giriş) / koyu kırmızı (çıkış)
    const yesilStyle = "color:#15803D;font-weight:700;"; // koyu yeşil
    const kirmiziStyle = "color:#991B1B;font-weight:700;"; // koyu kırmızı

    function cumleleriHtmle(items: CumleNotParca[]): string {
      let out = "";
      for (const it of items) {
        const cumleMargin = it.notlar.length > 0 ? "0 0 4px 0" : "0 0 12px 0";
        const icerik = it.parcalar.map((p) => {
          const esc = htmlEscape(p.deger);
          if (p.tip === "vurguYesil") return `<span style="${yesilStyle}">${esc}</span>`;
          if (p.tip === "vurguKirmizi") return `<span style="${kirmiziStyle}">${esc}</span>`;
          return esc;
        }).join("");
        out += `<p style="margin:${cumleMargin};">${icerik}</p>`;
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
    if (gonderenKullaniciAd) {
      html += `<p style="margin-top:16px;">${htmlEscape(gonderenKullaniciAd)}</p>`;
    }
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
