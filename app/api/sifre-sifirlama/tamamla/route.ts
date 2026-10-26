// ŞİFREMİ UNUTTUM — yeni şifreyi yazar.
//
// Oturum gerektirmez; yetki JETONDAN gelir. Jeton tek kullanımlık, 60 dk geçerli ve
// veritabanında yalnız SHA-256 özeti duruyor. Şifre YALNIZ Supabase Auth'a (hash'li)
// yazılır — açık metin kopya tutulmaz (26.10.2026'da o kopya kaldırıldı).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tokenCoz, tokenKullanildi } from "@/lib/auth/sifre-token";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Yapılandırma eksik" }, { status: 500 });

  let token = "", yeniSifre = "";
  try {
    const b = await request.json();
    token = String(b?.token ?? "");
    yeniSifre = String(b?.yeni_sifre ?? "");
  } catch { /* gövdesiz */ }

  if (!token) return NextResponse.json({ error: "Bağlantı geçersiz." }, { status: 400 });
  if (yeniSifre.trim().length < 6) {
    return NextResponse.json({ error: "Şifre en az 6 karakter olmalıdır." }, { status: 400 });
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const kayit = await tokenCoz(sb, token);
  if (!kayit || kayit.tip !== "sifre_sifirlama") {
    return NextResponse.json({ error: "Bağlantı geçersiz ya da süresi dolmuş. Yeniden istek yapın." }, { status: 400 });
  }

  const { data: kData } = await sb
    .from("kullanicilar")
    .select("auth_id, aktif, eposta")
    .eq("id", kayit.kullanici_id)
    .maybeSingle();
  const k = kData as { auth_id: string; aktif: boolean; eposta: string | null } | null;
  if (!k?.auth_id || !k.aktif) {
    return NextResponse.json({ error: "Hesap kullanılamıyor." }, { status: 400 });
  }
  // Adres jeton üretildikten SONRA değiştiyse bağlantı artık geçersiz: eski adrese gönderilmiş
  // bir bağlantıyla yeni adresin sahibi hesabı ele geçirmesin.
  if ((k.eposta ?? "").trim().toLowerCase() !== kayit.eposta.trim().toLowerCase()) {
    await tokenKullanildi(sb, kayit.id);
    return NextResponse.json({ error: "Bağlantı geçersiz. Yeniden istek yapın." }, { status: 400 });
  }

  const { error: authErr } = await sb.auth.admin.updateUserById(k.auth_id, { password: yeniSifre.trim() });
  if (authErr) return NextResponse.json({ error: `Şifre güncellenemedi: ${authErr.message}` }, { status: 500 });

  await tokenKullanildi(sb, kayit.id);
  await sb.from("kullanicilar").update({ updated_at: new Date().toISOString() }).eq("id", kayit.kullanici_id);

  return NextResponse.json({ ok: true });
}
