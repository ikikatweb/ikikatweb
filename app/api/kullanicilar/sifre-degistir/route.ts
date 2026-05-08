// Kullanıcının kendi şifresini değiştirme API
// - Eski şifreyi doğrular
// - Yeni şifre Supabase auth'a yazılır + sifre_gorunur (yöneticinin görmesi için) güncellenir
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // 1) Oturumdan auth user'ı al
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

  // 2) Body'den şifreleri al
  let body: { eski_sifre?: string; yeni_sifre?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  const eski = (body.eski_sifre ?? "").trim();
  const yeni = (body.yeni_sifre ?? "").trim();

  if (!eski || !yeni) {
    return NextResponse.json({ error: "Eski ve yeni şifre zorunludur." }, { status: 400 });
  }
  if (yeni.length < 6) {
    return NextResponse.json({ error: "Yeni şifre en az 6 karakter olmalı." }, { status: 400 });
  }
  if (eski === yeni) {
    return NextResponse.json({ error: "Yeni şifre eski şifre ile aynı olamaz." }, { status: 400 });
  }

  // 3) Service role ile çalış (auth.admin + tabloya yazmak için)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Kullanıcı profilini bul (auth_id üzerinden) — email auth için gerekli
  const { data: profil, error: profilErr } = await supabase
    .from("kullanicilar")
    .select("id, auth_id, kullanici_adi")
    .eq("auth_id", user.id)
    .single();
  if (profilErr || !profil) {
    return NextResponse.json({ error: "Kullanıcı profili bulunamadı." }, { status: 404 });
  }

  // 4) Eski şifreyi doğrula — geçici signIn ile
  // Email user.email; user.email yoksa kullanici_adi@... şeklinde domain olabilir
  const email = user.email;
  if (!email) {
    return NextResponse.json({ error: "Email bulunamadı, şifre doğrulanamadı." }, { status: 400 });
  }
  // Doğrulama için ayrı bir client (cookie yazmasın diye anon, no cookies)
  const dogrulamaClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: signInErr } = await dogrulamaClient.auth.signInWithPassword({
    email,
    password: eski,
  });
  if (signInErr) {
    return NextResponse.json({ error: "Eski şifre yanlış." }, { status: 400 });
  }

  // 5) Auth şifresini güncelle
  const { error: authErr } = await supabase.auth.admin.updateUserById(profil.auth_id, {
    password: yeni,
  });
  if (authErr) {
    return NextResponse.json({ error: `Şifre güncellenemedi: ${authErr.message}` }, { status: 500 });
  }

  // 6) sifre_gorunur'ü güncelle (yönetici listede görsün)
  const { error: updateErr } = await supabase
    .from("kullanicilar")
    .update({ sifre_gorunur: yeni, updated_at: new Date().toISOString() })
    .eq("id", profil.id);
  if (updateErr) {
    // Şifre değişti ama sifre_gorunur yazılamadı — hata bildir
    return NextResponse.json({
      error: `Şifre değişti ama görünür alan güncellenemedi: ${updateErr.message}`,
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
