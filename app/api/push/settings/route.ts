// Kullanıcının kendi bildirim ayarlarını oku/yaz
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

async function getCaller() {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } },
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return null;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await supabase
    .from("kullanicilar")
    .select("id, bildirim_ayarlari")
    .eq("auth_id", user.id)
    .single();
  return data;
}

export async function GET() {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  return NextResponse.json({ ayarlar: caller.bildirim_ayarlari ?? {} });
}

export async function PUT(req: Request) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  const body = await req.json();
  const ayarlar = body.ayarlar ?? {};
  if (typeof ayarlar !== "object") {
    return NextResponse.json({ error: "ayarlar obje olmalı" }, { status: 400 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await supabase
    .from("kullanicilar")
    .update({ bildirim_ayarlari: ayarlar })
    .eq("id", caller.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
