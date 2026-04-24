// Test bildirim — giriş yapan kullanıcıya örnek push gönderir
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendPushToKullanici } from "@/lib/push";

export async function POST() {
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
  if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: kullanici } = await supabase
    .from("kullanicilar")
    .select("id, ad_soyad")
    .eq("auth_id", user.id)
    .single();
  if (!kullanici) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  const sent = await sendPushToKullanici(kullanici.id, {
    title: "İkikat Yönetim — Test Bildirim",
    body: `Merhaba ${kullanici.ad_soyad}, bildirimler çalışıyor! 🎉`,
    url: "/dashboard",
    tag: "test",
    requireInteraction: false,
  });

  return NextResponse.json({ success: true, sent });
}
