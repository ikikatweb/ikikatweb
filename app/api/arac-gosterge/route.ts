// Aracın güncel göstergesini (km/saat) güncelle — service role ile RLS bypass
// Yakıt verme/alma işlemlerinde son girilen km değerini araca yansıtır.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  // Oturum kontrolü — sadece giriş yapmış kullanıcılar
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

  const body = await req.json().catch(() => ({}));
  const aracId = body.arac_id ? String(body.arac_id) : null;
  const km = typeof body.km === "number" ? body.km : null;
  if (!aracId || km == null || isNaN(km) || km < 0) {
    return NextResponse.json({ error: "arac_id ve geçerli km gerekli" }, { status: 400 });
  }

  // Service role ile RLS bypass
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { error } = await supabase
    .from("araclar")
    .update({ guncel_gosterge: km, updated_at: new Date().toISOString() })
    .eq("id", aracId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
