// Bildirim silme — kaynak (örn. evrak, mesaj, defter) silindiğinde ilgili
// bildirim_gecmisi kayıtlarını da temizler.
// Auth gerekir; service role ile RLS bypass yapar.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  // Auth kontrol
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

  const body = await req.json();
  const { kaynak_tip, kaynak_id } = body;
  if (!kaynak_tip || !kaynak_id) {
    return NextResponse.json({ error: "kaynak_tip ve kaynak_id zorunludur" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { error } = await supabase
    .from("bildirim_gecmisi")
    .delete()
    .eq("kaynak_tip", String(kaynak_tip))
    .eq("kaynak_id", String(kaynak_id));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
