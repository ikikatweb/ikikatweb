// Ocak GİRİŞİ (kapı çizgisi) — SERVICE ROLE ile okur/yazar → RLS baypas (anon yazma sorunu olmaz).
// Çizgi: A(lat,lng) – B(lat2,lng2). Gün bazlı: belirli güne ≤ EN SON gecerli_tarih kaydı geçerlidir.
// GET  /api/arvento/giris?tarih=YYYY-MM-DD  → { giris: {lat,lng,lat2,lng2} | null }
// POST /api/arvento/giris  body: { tarih, lat, lng, lat2, lng2 }  (giriş gerekli)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const tarih = new URL(req.url).searchParams.get("tarih");
  if (!tarih) return NextResponse.json({ giris: null });
  const sb = createClient(url, svc);
  const { data, error } = await sb.from("arvento_giris").select("lat, lng, lat2, lng2")
    .lte("gecerli_tarih", tarih).order("gecerli_tarih", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (/does not exist|arvento_giris/i.test(error.message)) return NextResponse.json({ error: "arvento_giris tablosu yok. SQL'i çalıştırın." }, { status: 500 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.lat == null || data.lng == null) return NextResponse.json({ giris: null });
  return NextResponse.json({ giris: { lat: data.lat, lng: data.lng, lat2: data.lat2 ?? data.lat, lng2: data.lng2 ?? data.lng } });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !svc || !anon) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Oturum gerekli" }, { status: 401 });

  let body: { tarih?: string; lat?: number; lng?: number; lat2?: number; lng2?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  const { tarih, lat, lng, lat2, lng2 } = body;
  if (!tarih || lat == null || lng == null || lat2 == null || lng2 == null) return NextResponse.json({ error: "Eksik alan" }, { status: 400 });
  const sb = createClient(url, svc);
  const { error } = await sb.from("arvento_giris").upsert({ gecerli_tarih: tarih, lat, lng, lat2, lng2 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
