// KULLANICI E-POSTA ADRESİ — kendi adresini kaydeder/değiştirir (oturumlu).
//
// Adres değişince eposta_dogrulandi=false olur ve doğrulama bağlantısı YENİ adrese gider:
// yanlış/başkasının adresi yazılırsa o adres doğrulanmadığı sürece şifre yenileme için
// güvenilir sayılmaz. Yönetici de aynı alanı kullanıcı formundan doldurabilir.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { tokenOlustur } from "@/lib/auth/sifre-token";
import { sistemTasiyici, mailGovde } from "@/lib/mail/smtp";

export const dynamic = "force-dynamic";

const GECERLI = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  const k = await oturum();
  if (!k) return yetkisiz();

  let eposta = "";
  try { eposta = String((await request.json())?.eposta ?? "").trim(); } catch { /* gövdesiz */ }
  if (!GECERLI.test(eposta)) return NextResponse.json({ error: "Geçerli bir e-posta adresi girin." }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { error } = await sb.from("kullanicilar")
    .update({ eposta, eposta_dogrulandi: false, updated_at: new Date().toISOString() })
    .eq("id", k.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Doğrulama bağlantısı — gönderilemezse adres yine kaydedilmiş olur (kullanıcıya bildirilir).
  let mailGitti = true;
  try {
    const token = await tokenOlustur(sb, k.id, "eposta_dogrulama", eposta);
    const kok = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const { tasiyici, gonderen } = await sistemTasiyici(sb);
    await tasiyici.sendMail({
      from: `"İkikat Yönetim Sistemi" <${gonderen}>`,
      to: eposta,
      subject: "E-posta adresinizi doğrulayın",
      html: mailGovde(
        "E-posta doğrulama",
        `Merhaba ${k.ad_soyad},<br><br>İkikat Yönetim Sistemi hesabınıza bu adres tanımlandı. Şifrenizi unuttuğunuzda yenileme bağlantısı buraya gönderilecek. Adresin size ait olduğunu teyit etmek için düğmeye basın.`,
        "Adresimi doğrula",
        `${kok}/eposta-dogrula?t=${encodeURIComponent(token)}`,
        "Bağlantı 24 saat geçerlidir. Bu adresi siz tanımlamadıysanız yöneticinize bildirin.",
      ),
    });
  } catch (e) {
    mailGitti = false;
    console.error("Doğrulama maili gönderilemedi:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true, mailGitti });
}
