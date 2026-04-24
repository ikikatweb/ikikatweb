// Web Push abonelik kaydet — kullanıcı cihazından gelen endpoint/keys
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

async function getCaller() {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    },
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return null;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await supabase
    .from("kullanicilar")
    .select("id")
    .eq("auth_id", user.id)
    .single();
  return data;
}

export async function POST(req: Request) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

  const body = await req.json();
  const { endpoint, p256dh, auth } = body;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Eksik parametre" }, { status: 400 });
  }

  const h = await headers();
  const userAgent = h.get("user-agent") ?? null;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Upsert — aynı endpoint varsa kullanıcıyı güncelle
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({
      kullanici_id: caller.id,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });

  if (error) {
    console.error("Subscribe error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
