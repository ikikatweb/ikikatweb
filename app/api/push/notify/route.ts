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

  // Bildirim alıcıları: Yönetici + Şantiye Yöneticisi (çağıran hariç)
  // - Yönetici: tüm bildirimleri alır
  // - Şantiye Yöneticisi: santiye_id event'le ilişkili olduğunda alır (yoksa atandığı şantiyelerden olduğu varsayımıyla yine alır — payload'da santiye_id varsa filtreler)
  const { data: aliciAdaylari } = await supabase
    .from("kullanicilar")
    .select("id, rol, bildirim_ayarlari, santiye_ids")
    .in("rol", ["yonetici", "santiye_admin"])
    .eq("aktif", true)
    .neq("id", caller.id);

  if (!aliciAdaylari || aliciAdaylari.length === 0) {
    return NextResponse.json({ success: true, sent: 0 });
  }

  // Bu tag'i kapatmış olmayanları filtrele + şantiye filtrelemesi (santiye_admin için)
  const tagStr = tag ? String(tag) : "";
  const eventSantiyeId = body.santiye_id ? String(body.santiye_id) : null;
  const istekliIds = aliciAdaylari
    .filter((y) => {
      // Tag (kategori) filtresi: kapatılmamış olmalı
      if (tagStr) {
        const ayar = (y.bildirim_ayarlari ?? {}) as Record<string, boolean>;
        if (ayar[tagStr] === false) return false;
      }
      // Şantiye admini için: event santiye_id'si atandığı şantiyelerde olmalı
      // (yönetici için bu kontrol yok — hepsini alır)
      // Event santiye_id yoksa (örn. genel bildirim), şantiye admini de alır
      if (y.rol === "santiye_admin" && eventSantiyeId) {
        const ids = Array.isArray(y.santiye_ids) ? (y.santiye_ids as string[]) : [];
        if (ids.length > 0 && !ids.includes(eventSantiyeId)) return false;
      }
      return true;
    })
    .map((y) => y.id);

  if (istekliIds.length === 0) {
    return NextResponse.json({ success: true, sent: 0, filtered: aliciAdaylari.length });
  }

  // BİLDİRİM GEÇMİŞİ — her alıcı için kayıt at (push gönderilmese bile geçmişte görsünler)
  // tarih: TR yerel saatine göre YYYY-MM-DD, saat: HH:MM:SS
  // Sunucu UTC çalıştığı için new Date().getHours() UTC saati döner — TR'ye dönüştür.
  try {
    const trParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => trParts.find((p) => p.type === type)?.value ?? "00";
    const tarih = `${get("year")}-${get("month")}-${get("day")}`;
    // hour bazen "24" döner, "00" yap
    const hh = get("hour") === "24" ? "00" : get("hour");
    const saat = `${hh}:${get("minute")}:${get("second")}`;
    const gecmisRows = istekliIds.map((kid) => ({
      kullanici_id: kid,
      baslik: baslikFinal,
      govde: govdeFinal,
      url: url || "/dashboard",
      tag: tagStr || null,
      tarih,
      saat,
      okundu: false,
    }));
    await supabase.from("bildirim_gecmisi").insert(gecmisRows);
  } catch { /* sessiz — geçmiş kaydı başarısız olsa da push gönderimine devam et */ }

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
