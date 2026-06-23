// Damper manuel sınıflandırma (gerçek/mükerrer/arıza) — SERVICE ROLE ile okur/yazar.
// Service role RLS'i baypas eder → tabloda RLS açık olsa bile çalışır (anon yazma sorunu olmaz).
// GET  /api/arvento/damper-sinif?bas=YYYY-MM-DD&bitis=YYYY-MM-DD  → { satirlar: [...] }
// POST /api/arvento/damper-sinif  body: { plaka, tarih, saat, sinif }  → { ok: true }  (giriş gerekli)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const { searchParams } = new URL(req.url);
  const bas = searchParams.get("bas"), bitis = searchParams.get("bitis");
  const sb = createClient(url, svc);
  let q = sb.from("arvento_damper_sinif").select("plaka, tarih, saat, sinif");
  if (bas) q = q.gte("tarih", bas);
  if (bitis) q = q.lte("tarih", bitis);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|arvento_damper_sinif/i.test(error.message)) {
      return NextResponse.json({ error: "arvento_damper_sinif tablosu yok. SQL'i çalıştırın." }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ satirlar: data ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !svc || !anon) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  // Oturum kontrolü — sadece giriş yapmış kullanıcılar yazabilir.
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Oturum gerekli" }, { status: 401 });

  let body: { plaka?: string; tarih?: string; saat?: string; sinif?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  const { plaka, tarih, saat, sinif } = body;
  if (!plaka || !tarih || !sinif) return NextResponse.json({ error: "Eksik alan" }, { status: 400 });
  if (!["gercek", "mukerrer", "ariza"].includes(sinif)) return NextResponse.json({ error: "Geçersiz sınıf" }, { status: 400 });
  const sb = createClient(url, svc);
  const { error } = await sb.from("arvento_damper_sinif").upsert({ plaka, tarih, saat: saat ?? "", sinif }, { onConflict: "plaka,tarih,saat" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
