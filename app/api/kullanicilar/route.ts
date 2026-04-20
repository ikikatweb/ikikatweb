// Kullanıcı yönetimi API - Listeleme ve oluşturma (sadece yönetici)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

async function getCallerRole() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });

  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return null;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data } = await supabase
    .from("kullanicilar")
    .select("id, rol")
    .eq("auth_id", user.id)
    .single();

  return data;
}

// GET - Tüm kullanıcıları listele
export async function GET() {
  const caller = await getCallerRole();
  if (!caller || caller.rol !== "yonetici") {
    return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 403 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("kullanicilar")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - Yeni kullanıcı oluştur
export async function POST(request: Request) {
  const caller = await getCallerRole();
  if (!caller || caller.rol !== "yonetici") {
    return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 403 });
  }

  const body = await request.json();
  const { ad_soyad, kullanici_adi, sifre, rol, izinler, santiye_ids, geriye_donus_gun, dashboard_widgets } = body;

  if (!ad_soyad || !kullanici_adi || !sifre) {
    return NextResponse.json({ error: "Ad soyad, kullanıcı adı ve şifre zorunludur" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Supabase Auth kullanıcısı oluştur — Türkçe karakterleri temizle
  const normalize = (s: string) => s.trim().toLowerCase()
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
  const normalizedKullaniciAdi = normalize(kullanici_adi);
  const email = `${normalizedKullaniciAdi}@gmail.com`;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: sifre,
    email_confirm: true,
    user_metadata: { kullanici_adi: normalizedKullaniciAdi },
  });

  if (authError) {
    console.error("Supabase auth createUser hatası:", authError);
    if (authError.message.includes("already") || authError.message.includes("registered")) {
      return NextResponse.json({ error: "Bu kullanıcı adı zaten kullanılıyor" }, { status: 409 });
    }
    return NextResponse.json({ error: `Auth hatası: ${authError.message}` }, { status: 500 });
  }

  // 2. Kullanıcılar tablosuna ekle
  const { data, error } = await supabase
    .from("kullanicilar")
    .insert({
      auth_id: authData.user.id,
      ad_soyad,
      kullanici_adi: kullanici_adi.trim().toLowerCase(),
      sifre_gorunur: sifre,
      rol: rol || "kisitli",
      aktif: true,
      izinler: izinler || {},
      santiye_ids: santiye_ids || [],
      geriye_donus_gun: geriye_donus_gun ?? null,
      dashboard_widgets: dashboard_widgets ?? null,
    })
    .select()
    .single();

  if (error) {
    // Rollback: auth kullanıcısını sil
    await supabase.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
