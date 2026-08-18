// Ocak GİRİŞİ (kapı çizgisi) — SERVICE ROLE ile okur/yazar → RLS baypas (anon yazma sorunu olmaz).
// Çizgi ÇOK NOKTALI: noktalar = [{lat,lng}, ...] (en az 2). Köşe eklenip çıkarılabilir.
// lat/lng ve lat2/lng2 kolonları ilk/son noktayla senkron tutulur → eski kayıtlar ve eski kod yolları
// çalışmaya devam eder (noktalar kolonu yoksa/boşsa A–B'den iki noktalı dizi üretilir).
// Gün bazlı: belirli güne ≤ EN SON gecerli_tarih kaydı geçerlidir.
// GET  /api/arvento/giris?tarih=YYYY-MM-DD  → { giris: {lat,lng,lat2,lng2,noktalar[]} | null }
// POST /api/arvento/giris  body: { tarih, noktalar[] }  (giriş gerekli)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type Nokta = { lat: number; lng: number };

// Gelen değeri geçerli nokta dizisine çevirir (sayı olmayan/eksik öğeleri atar).
function noktalariAyikla(ham: unknown): Nokta[] {
  if (!Array.isArray(ham)) return [];
  const cikti: Nokta[] = [];
  for (const n of ham) {
    const lat = (n as Nokta)?.lat, lng = (n as Nokta)?.lng;
    if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
      cikti.push({ lat, lng });
    }
  }
  return cikti;
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const tarih = new URL(req.url).searchParams.get("tarih");
  if (!tarih) return NextResponse.json({ giris: null });
  const sb = createClient(url, svc);
  const { data, error } = await sb.from("arvento_giris").select("lat, lng, lat2, lng2, noktalar")
    .lte("gecerli_tarih", tarih).order("gecerli_tarih", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (/does not exist|arvento_giris/i.test(error.message)) return NextResponse.json({ error: "arvento_giris tablosu yok. SQL'i çalıştırın." }, { status: 500 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.lat == null || data.lng == null) return NextResponse.json({ giris: null });
  // noktalar varsa onu kullan; yoksa (eski kayıt) A–B'den iki noktalı dizi üret.
  let noktalar = noktalariAyikla(data.noktalar);
  if (noktalar.length < 2) {
    noktalar = [
      { lat: data.lat as number, lng: data.lng as number },
      { lat: (data.lat2 as number) ?? (data.lat as number), lng: (data.lng2 as number) ?? (data.lng as number) },
    ];
  }
  const ilk = noktalar[0], son = noktalar[noktalar.length - 1];
  return NextResponse.json({ giris: { lat: ilk.lat, lng: ilk.lng, lat2: son.lat, lng2: son.lng, noktalar } });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !svc || !anon) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Oturum gerekli" }, { status: 401 });

  let body: { tarih?: string; noktalar?: unknown; lat?: number; lng?: number; lat2?: number; lng2?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  const { tarih } = body;
  if (!tarih) return NextResponse.json({ error: "Eksik alan" }, { status: 400 });

  // Yeni biçim: noktalar[]. Eski biçim (lat/lng + lat2/lng2) da kabul edilir → iki noktalı dizi.
  let noktalar = noktalariAyikla(body.noktalar);
  if (noktalar.length < 2 && body.lat != null && body.lng != null && body.lat2 != null && body.lng2 != null) {
    noktalar = [{ lat: body.lat, lng: body.lng }, { lat: body.lat2, lng: body.lng2 }];
  }
  if (noktalar.length < 2) return NextResponse.json({ error: "Kapı çizgisi en az 2 nokta olmalı" }, { status: 400 });
  if (noktalar.length > 50) return NextResponse.json({ error: "Kapı çizgisi en fazla 50 nokta olabilir" }, { status: 400 });

  const ilk = noktalar[0], son = noktalar[noktalar.length - 1];
  const sb = createClient(url, svc);
  const { error } = await sb.from("arvento_giris").upsert({
    gecerli_tarih: tarih,
    lat: ilk.lat, lng: ilk.lng, lat2: son.lat, lng2: son.lng, // ilk/son ile senkron (geriye dönük uyum)
    noktalar,
  });
  if (error) {
    if (/noktalar/i.test(error.message)) return NextResponse.json({ error: "arvento_giris.noktalar kolonu yok. SQL'i çalıştırın." }, { status: 500 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
