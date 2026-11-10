// YÖNETİCİ, BİR KULLANICIYA DOĞRULAMA MAİLİ GÖNDERİR.
//
// NİYE VARDI OLMAYAN BİR ŞEY: doğrulama bağlantısı şimdiye kadar yalnız kişi
// KENDİ adresini kaydettiğinde gidiyordu (/api/eposta). Adresi yönetici
// girdiyse kayıt "doğrulanmadı" olarak kalıyor ve kimse düzeltemiyordu:
// kullanıcı "şifremi unuttum" dediğinde adres güvenilir sayılmadığı için
// yardım edilemiyordu. Artık yönetici listeden maili yeniden yollayabiliyor.
//
// SESSİZ BAŞARISIZLIK YOK (AGENTS.md): mail gönderilemezse 500 döner ve sebebi
// yazar. "Gönderildi" demek, gerçekten gittiği anlamına gelir.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { tokenOlustur } from "@/lib/auth/sifre-token";
import { sistemTasiyici, mailGovde } from "@/lib/mail/smtp";
import { mailSiteKoku, KOK_YOK_MESAJ } from "@/lib/mail/site-koku";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** İsteği yapan kim? (yalnız yönetici bu kapıdan geçer) */
async function cagiran() {
  const cookieStore = await cookies();
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } },
  );
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("kullanicilar").select("id, rol, ad_soyad").eq("auth_id", user.id).single();
  return data;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ben = await cagiran();
  if (!ben) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });
  if (ben.rol !== "yonetici") return NextResponse.json({ error: "Bu işlem yalnız yöneticilere açık." }, { status: 403 });

  const { id } = await params;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: hedef, error: okumaHatasi } = await sb
    .from("kullanicilar").select("id, ad_soyad, eposta, eposta_dogrulandi").eq("id", id).single();
  if (okumaHatasi || !hedef) return NextResponse.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });
  if (!hedef.eposta) {
    return NextResponse.json({ error: "Bu kullanıcının e-posta adresi tanımlı değil." }, { status: 400 });
  }

  // BAĞLANTI ADRESİ ÖNCE: yerelse mail hiç gönderilmez (bkz. lib/mail/site-koku).
  const kok = mailSiteKoku(request);
  if (!kok) return NextResponse.json({ error: KOK_YOK_MESAJ }, { status: 400 });

  try {
    const token = await tokenOlustur(sb, hedef.id, "eposta_dogrulama", hedef.eposta);
    const { tasiyici, gonderen } = await sistemTasiyici(sb);
    await tasiyici.sendMail({
      from: `"İkikat Yönetim Sistemi" <${gonderen}>`,
      to: hedef.eposta,
      subject: "E-posta adresinizi doğrulayın",
      html: mailGovde(
        "E-posta doğrulama",
        `Merhaba ${hedef.ad_soyad},<br><br>İkikat Yönetim Sistemi hesabınıza bu adres tanımlandı. `
        + `Şifrenizi unuttuğunuzda yenileme bağlantısı buraya gönderilecek. `
        + `Adresin size ait olduğunu teyit etmek için düğmeye basın.`,
        "Adresimi doğrula",
        `${kok}/eposta-dogrula?t=${encodeURIComponent(token)}`,
        "Bağlantı 24 saat geçerlidir. Bu adresi siz tanımlamadıysanız yöneticinize bildirin.",
      ),
    });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    console.error("[dogrulama-maili]", mesaj);
    // SESSİZ GEÇİLMEZ: gitmediyse "gönderildi" denmez.
    return NextResponse.json({ error: `Mail gönderilemedi: ${mesaj}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eposta: hedef.eposta });
}
