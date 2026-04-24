// Bildirim tetikleyici — client bir olay olduğunda çağırır
// Yöneticilere push gönderir, çağıran kullanıcıyı hariç tutar
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendPushToYoneticilerExcept } from "@/lib/push";

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

  // Kullanıcı id ve adını al
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: kullanici } = await supabase
    .from("kullanicilar")
    .select("id, ad_soyad, kullanici_adi")
    .eq("auth_id", user.id)
    .single();
  if (!kullanici) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  // Body'den bildirim içeriğini al
  const body = await req.json();
  const { baslik, govde, url, tag } = body;
  if (!baslik || !govde) {
    return NextResponse.json({ error: "baslik ve govde zorunludur" }, { status: 400 });
  }

  // İşlemi yapan kullanıcı adını bildirime ekle
  const kullaniciAdi = kullanici.ad_soyad || kullanici.kullanici_adi || "Bilinmeyen kullanıcı";
  const govdeSonu = `\n👤 ${kullaniciAdi}`;
  const maxGovde = 300 - govdeSonu.length;
  const govdeFinal = String(govde).slice(0, maxGovde) + govdeSonu;

  // Yöneticilere gönder (çağıran hariç)
  const sent = await sendPushToYoneticilerExcept(kullanici.id, {
    title: String(baslik).slice(0, 100),
    body: govdeFinal,
    url: url || "/dashboard",
    tag: tag || undefined,
  });

  return NextResponse.json({ success: true, sent });
}
