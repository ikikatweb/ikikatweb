// POLİÇELEŞTİRME TALEBİ MAİLİ
//
// Teklifler ekranında bir teklif "poliçeleştir" denince, teklifi gönderen acenteye
// "bu teklif uygun görülmüştür, poliçeleştirin" maili gider. Teklif isteme mailinden
// farkı: TEK acenteye gider, ek yoktur ve seçilen firma + tutar metnin içindedir.
//
// Mail metni ekranda onaylatıldıktan sonra gönderilir; sunucu aynı metni yeniden kurar
// (istemciden gelen metne güvenilmez, tutar/firma veritabanından okunur).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

/** Onay penceresinde gösterilen metinle birebir aynı olmalı (lib/police-talep-metin.ts). */
import {
  policeTalepKonu, policeTalepMetin, policeTalepHtml, policeTalepSablonCoz,
  POLICE_TALEP_KATEGORI, POLICE_TALEP_NOT_KATEGORI,
} from "@/lib/police-talep-metin";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { antetEki } from "@/lib/api/antet-eki";

export async function POST(request: Request) {
  // GÜVENLİK: /api middleware kapsamı dışında — kapı burada (lib/api/guvenlik).
  if (!(await oturum())) return yetkisiz();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { teklifId, firmaId, gonderenKullanici } = (await request.json()) as {
      teklifId: string;
      firmaId: string | null;
      gonderenKullanici?: string | null;
    };
    if (!teklifId) return NextResponse.json({ error: "Teklif belirtilmedi" }, { status: 400 });
    if (!firmaId) return NextResponse.json({ error: "Aracın firma kaydı yok — mail gönderilemez" }, { status: 400 });

    // Teklif + araç: tutar ve plaka veritabanından okunur.
    const { data: teklif } = await supabase
      .from("sigorta_teklif")
      .select("id, arac_id, police_tipi, acente_adi, sigorta_firmasi, teklif_tutari")
      .eq("id", teklifId)
      .single();
    if (!teklif) return NextResponse.json({ error: "Teklif bulunamadı" }, { status: 404 });

    const { data: arac } = await supabase.from("araclar").select("plaka").eq("id", teklif.arac_id).single();
    if (!arac) return NextResponse.json({ error: "Araç bulunamadı" }, { status: 404 });

    // Acentenin e-posta adresi tanımlamalardan gelir (teklif istenirken de aynı kaynak kullanılıyor).
    const { data: acenteler } = await supabase
      .from("tanimlamalar").select("deger, kisa_ad").eq("kategori", "sigorta_acente").eq("aktif", true);
    const acente = (acenteler ?? []).find((a) => a.deger === teklif.acente_adi);
    // kisa_ad alanında iletişim bilgileri JSON olarak duruyor: {"e":eposta,"t":...}
    let eposta = "";
    try { eposta = (JSON.parse(String(acente?.kisa_ad ?? "{}")) as { e?: string }).e ?? ""; } catch { eposta = ""; }
    if (!eposta) {
      return NextResponse.json({ error: `${teklif.acente_adi} için e-posta adresi tanımlı değil` }, { status: 400 });
    }

    // Antet de buradan gelir: mail hangi firmanın hesabından gidiyorsa onun anteti kullanılır.
    const { data: firma } = await supabase.from("firmalar").select("*").eq("id", firmaId).single();
    if (!firma?.smtp_host || !firma.smtp_user || !firma.smtp_password) {
      return NextResponse.json({ error: "Firma SMTP ayarları eksik" }, { status: 400 });
    }

    // MAİL METNİ tanımlamalardan gelir (Tanımlamalar → Poliçeleştirme Mail Metni).
    // Okuma HATA verirse mail GÖNDERİLMEZ: önizlemede onaylanan metin ile gidecek metin
    // ayrışır, kullanıcı da farkı göremez (bkz. AGENTS.md "Sessiz hata yok").
    const { data: sablonSatirlari, error: sablonHata } = await supabase
      .from("tanimlamalar")
      .select("kategori, deger")
      .in("kategori", [POLICE_TALEP_KATEGORI, POLICE_TALEP_NOT_KATEGORI]);
    if (sablonHata) {
      return NextResponse.json(
        { error: `Mail metni okunamadı (${sablonHata.message}) — mail gönderilmedi.` },
        { status: 500 },
      );
    }
    const sablon = policeTalepSablonCoz(sablonSatirlari);

    const tipKey = teklif.police_tipi as "kasko" | "trafik";
    const konu = policeTalepKonu(arac.plaka, tipKey);
    const bilgi = {
      plaka: arac.plaka,
      acenteAdi: teklif.acente_adi,
      sigortaFirmasi: teklif.sigorta_firmasi ?? "",
      tutar: teklif.teklif_tutari,
      tip: tipKey,
      gonderen: gonderenKullanici ?? null,
    };
    const metin = policeTalepMetin(bilgi, sablon);

    const transporter = nodemailer.createTransport({
      host: firma.smtp_host,
      port: firma.smtp_port || 587,
      secure: firma.smtp_port === 465,
      auth: { user: firma.smtp_user, pass: firma.smtp_password },
      tls: { rejectUnauthorized: false },
    });

    // ANTET: teklif isteme mailiyle ortak modül (lib/api/antet-eki).
    const antet = await antetEki(firma.antet_url);
    const ekler = antet.ek ? [antet.ek] : [];
    if (antet.inemedi) console.error("[Poliçe Talep Mail] Antet indirilemedi:", firma.antet_url);

    const html = `${antet.html}${policeTalepHtml(bilgi, sablon)}`;

    await transporter.sendMail({
      from: `"${firma.smtp_sender_name || firma.firma_adi}" <${firma.smtp_sender_email || firma.smtp_user}>`,
      to: eposta,
      subject: konu,
      text: metin,
      html,
      attachments: ekler,
    });

    // Gönderildiği ekranda görünsün; aynı teklif için ikinci kez talep gönderilmesin diye tarih saklanır.
    // Teklifin seçimi ayrıca yapılır (secSigortaTeklif) — burada yalnız talep tarihi işlenir.
    await supabase.from("sigorta_teklif")
      .update({
        police_talep_tarihi: new Date().toISOString(),
        police_talep_eden: gonderenKullanici?.trim() || null,
      })
      .eq("id", teklifId);

    return NextResponse.json({ mesaj: `${teklif.acente_adi} (${eposta}) adresine gönderildi`, eposta });
  } catch (err) {
    return NextResponse.json(
      { error: `Mail gönderilemedi: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
