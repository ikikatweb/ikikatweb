// Mevcut kullanıcı profili API
// - GET: giriş yapan kullanıcının bilgilerini döner
// - PATCH: kullanıcının KENDİ değiştirebileceği alanları günceller (şimdilik ad soyad).
//   Rol, yetki, şantiye ataması gibi alanlar buradan DEĞİŞTİRİLEMEZ — onlar yöneticide.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Oturumdan kullanıcıyı al
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });

  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });
  }

  // Kullanıcı profilini getir
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from("kullanicilar")
    .select("*")
    .eq("auth_id", user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Kullanıcı profili bulunamadı" }, { status: 404 });
  }

  // son_giris TABLO KOLONU DEĞİL — Supabase Auth'tan gelir. Liste API'si de böyle ekliyor;
  // Bilgilerim sayfası "son giriş"i buradan okuyor.
  return NextResponse.json({ ...data, son_giris: user.last_sign_in_at ?? null });
}

// KENDİ BİLGİSİNİ GÜNCELLEME — /dashboard/bilgilerim sayfası buraya yazar.
// Yalnız ad_soyad kabul edilir; gövdede başka alan gelse bile YOK SAYILIR (yetki yükseltme
// denemesi tabloya geçmesin). E-posta ayrı rotada (/api/eposta), şifre ayrı
// (/api/kullanicilar/sifre-degistir) — ikisi de kendi doğrulamasını yapıyor.
export async function PATCH(request: Request) {
  const k = await oturum();
  if (!k) return yetkisiz();

  let ad = "";
  try { ad = String((await request.json())?.ad_soyad ?? "").replace(/\s+/g, " ").trim(); }
  catch { /* gövdesiz */ }

  if (ad.length < 3) return NextResponse.json({ error: "Ad soyad en az 3 karakter olmalı." }, { status: 400 });
  if (ad.length > 80) return NextResponse.json({ error: "Ad soyad en fazla 80 karakter olabilir." }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await sb
    .from("kullanicilar")
    .update({ ad_soyad: ad, updated_at: new Date().toISOString() })
    .eq("id", k.id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Kaydedilemedi." }, { status: 500 });
  }
  return NextResponse.json(data);
}
