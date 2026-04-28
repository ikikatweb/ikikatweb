// Bildirim geçmişi API'si
// GET: Belirli bir tarihteki bildirimleri getir (varsayılan: bugün) + okunmamış sayısı
// PATCH: Bildirimleri "okundu" olarak işaretle (tek id veya hepsi)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

async function authUser() {
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
  return user;
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function callerKullaniciId(authId: string): Promise<string | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kullanicilar")
    .select("id")
    .eq("auth_id", authId)
    .single();
  return data?.id ?? null;
}

export async function GET(request: Request) {
  const user = await authUser();
  if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  const kullaniciId = await callerKullaniciId(user.id);
  if (!kullaniciId) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  const url = new URL(request.url);
  // tarih: YYYY-MM-DD — yoksa bugünün tarihi (TR saati)
  let tarih = url.searchParams.get("tarih");
  if (!tarih || !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) {
    const now = new Date();
    // TR saatine göre yerel tarih
    tarih = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  const supabase = getServiceClient();

  // Seçili tarih aralığında bildirimler (UTC sınırlarına dikkat — TR saatinde günü kapsayalım)
  // Kolaylık için tarih kolonunu DATE olarak filtreliyoruz
  const { data: gecmis } = await supabase
    .from("bildirim_gecmisi")
    .select("id, baslik, govde, url, tag, tarih, saat, okundu, created_at")
    .eq("kullanici_id", kullaniciId)
    .eq("tarih", tarih)
    .order("created_at", { ascending: false });

  // Okunmamış toplam sayısı (tüm tarihlerden)
  const { count: okunmamisSayisi } = await supabase
    .from("bildirim_gecmisi")
    .select("id", { count: "exact", head: true })
    .eq("kullanici_id", kullaniciId)
    .eq("okundu", false);

  return NextResponse.json({
    tarih,
    bildirimler: gecmis ?? [],
    okunmamisSayisi: okunmamisSayisi ?? 0,
  });
}

export async function PATCH(request: Request) {
  const user = await authUser();
  if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  const kullaniciId = await callerKullaniciId(user.id);
  if (!kullaniciId) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const id = body.id ? String(body.id) : null;
  const tumu = body.tumu === true;

  const supabase = getServiceClient();
  let query = supabase
    .from("bildirim_gecmisi")
    .update({ okundu: true })
    .eq("kullanici_id", kullaniciId);

  if (id) {
    query = query.eq("id", id);
  } else if (!tumu) {
    return NextResponse.json({ error: "id veya tumu=true gerekli" }, { status: 400 });
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
