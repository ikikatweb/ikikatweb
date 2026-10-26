// ŞİFREMİ UNUTTUM — yenileme bağlantısı isteği.
//
// OTURUM GEREKTİRMEZ: zaten giremeyen kullanıcı için. Bu yüzden kötüye kullanıma karşı
// üç fren var:
//   1) CEVAP HER ZAMAN AYNI — kullanıcı var/yok, adresi kayıtlı/değil ayrımı dışarı
//      sızdırılmaz; yoksa form "bu sistemde kim var" sorgu aracına döner.
//   2) Saatte en fazla 3 istek (kişi başına) — mail bombardımanı olmasın.
//   3) Jeton 60 dk geçerli, tek kullanımlık, veritabanında yalnız SHA-256 özeti durur.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tokenOlustur, sonSaattekiIstek } from "@/lib/auth/sifre-token";
import { sistemTasiyici, mailGovde } from "@/lib/mail/smtp";

export const dynamic = "force-dynamic";

/** Her durumda aynı yanıt — bilgi sızdırmamak için. */
const AYNI_YANIT = NextResponse.json({
  ok: true,
  mesaj: "Kullanıcı adı kayıtlıysa ve e-posta adresi tanımlıysa yenileme bağlantısı gönderildi.",
});

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Yapılandırma eksik" }, { status: 500 });

  let kullaniciAdi = "";
  try { kullaniciAdi = String((await request.json())?.kullanici_adi ?? "").trim().toLocaleLowerCase("tr"); }
  catch { /* gövdesiz */ }
  if (!kullaniciAdi) return NextResponse.json({ error: "Kullanıcı adı gerekli" }, { status: 400 });

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await sb
    .from("kullanicilar")
    .select("id, ad_soyad, kullanici_adi, eposta, aktif")
    .eq("kullanici_adi", kullaniciAdi)
    .maybeSingle();
  const k = data as { id: string; ad_soyad: string; kullanici_adi: string; eposta: string | null; aktif: boolean } | null;

  // Kullanıcı yok / pasif / adresi tanımsız → sessizce aynı yanıt.
  if (!k || !k.aktif || !k.eposta?.trim()) return AYNI_YANIT;

  if (await sonSaattekiIstek(sb, k.id, "sifre_sifirlama") >= 3) return AYNI_YANIT;

  try {
    const token = await tokenOlustur(sb, k.id, "sifre_sifirlama", k.eposta.trim());
    const kok = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const baglanti = `${kok}/sifre-yenile?t=${encodeURIComponent(token)}`;

    const { tasiyici, gonderen } = await sistemTasiyici(sb);
    await tasiyici.sendMail({
      from: `"İkikat Yönetim Sistemi" <${gonderen}>`,
      to: k.eposta.trim(),
      subject: "Şifre yenileme bağlantınız",
      html: mailGovde(
        "Şifre yenileme",
        `Merhaba ${k.ad_soyad},<br><br>İkikat Yönetim Sistemi hesabınız (<b>${k.kullanici_adi}</b>) için şifre yenileme istendi. Yeni şifrenizi belirlemek için aşağıdaki düğmeye basın.`,
        "Yeni şifre belirle",
        baglanti,
        "Bağlantı 60 dakika geçerlidir ve yalnız bir kez kullanılabilir. Bu isteği siz yapmadıysanız bu maili yok sayın; şifreniz değişmez.",
      ),
    });
  } catch (e) {
    // Mail/SMTP hatası kullanıcıya yansıtılmaz (yine aynı yanıt) ama sunucu günlüğüne düşer.
    console.error("Şifre yenileme maili gönderilemedi:", e instanceof Error ? e.message : e);
  }
  return AYNI_YANIT;
}
