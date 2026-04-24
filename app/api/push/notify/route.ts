// Bildirim tetikleyici — client bir olay olduğunda çağırır
// Yöneticilere push gönderir, çağıran kullanıcıyı ve bu kategoriyi kapatmış olanları hariç tutar
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import webpush from "web-push";

// VAPID setup
const vapidConfigured = (() => {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
})();

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
  const { data: caller } = await supabase
    .from("kullanicilar")
    .select("id, ad_soyad, kullanici_adi")
    .eq("auth_id", user.id)
    .single();
  if (!caller) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  if (!vapidConfigured) return NextResponse.json({ error: "VAPID yapılandırılmamış" }, { status: 500 });

  // Body
  const body = await req.json();
  const { baslik, govde, url, tag } = body;
  if (!baslik || !govde) {
    return NextResponse.json({ error: "baslik ve govde zorunludur" }, { status: 400 });
  }

  // İşlem yapan kullanıcı adını bildirime ekle
  const kullaniciAdi = caller.ad_soyad || caller.kullanici_adi || "Bilinmeyen";
  const govdeSonu = `\n👤 ${kullaniciAdi}`;
  const maxGovde = 300 - govdeSonu.length;
  const govdeFinal = String(govde).slice(0, maxGovde) + govdeSonu;
  const baslikFinal = String(baslik).slice(0, 100);

  // Yöneticileri ve tercihlerini al (çağıran hariç)
  const { data: yoneticiler } = await supabase
    .from("kullanicilar")
    .select("id, bildirim_ayarlari")
    .eq("rol", "yonetici")
    .eq("aktif", true)
    .neq("id", caller.id);

  if (!yoneticiler || yoneticiler.length === 0) {
    return NextResponse.json({ success: true, sent: 0 });
  }

  // Bu tag'i kapatmış olmayanları filtrele
  const tagStr = tag ? String(tag) : "";
  const istekliIds = yoneticiler
    .filter((y) => {
      if (!tagStr) return true;
      const ayar = (y.bildirim_ayarlari ?? {}) as Record<string, boolean>;
      // Açıkça false olarak işaretlenmişse hariç tut, aksi halde gönder
      return ayar[tagStr] !== false;
    })
    .map((y) => y.id);

  if (istekliIds.length === 0) {
    return NextResponse.json({ success: true, sent: 0, filtered: yoneticiler.length });
  }

  // Bu kullanıcıların subscription'larını al
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("kullanici_id", istekliIds);

  if (!subs || subs.length === 0) {
    return NextResponse.json({ success: true, sent: 0 });
  }

  const payload = JSON.stringify({
    title: baslikFinal,
    body: govdeFinal,
    url: url || "/dashboard",
    tag: tagStr || undefined,
  });

  // Gönder
  const results = await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 * 24 },
      );
      return true;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        try { await supabase.from("push_subscriptions").delete().eq("id", sub.id); } catch {}
      }
      return false;
    }
  }));

  return NextResponse.json({ success: true, sent: results.filter(Boolean).length });
}
