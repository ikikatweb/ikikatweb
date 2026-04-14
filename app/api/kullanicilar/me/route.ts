// Mevcut kullanıcı profili API - Giriş yapan kullanıcının bilgilerini döner
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

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

  return NextResponse.json(data);
}
