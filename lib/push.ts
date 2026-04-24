// Web Push bildirim gönderme helper'ı (server-side)
// API route'lardan veya server action'lardan çağrılır
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// VAPID ayarlarını bir kez tanımla
const vapidConfigured = (() => {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) {
    console.warn("VAPID keys eksik — web push devre dışı");
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  return true;
})();

export type PushPayload = {
  title: string;
  body: string;
  url?: string; // tıklayınca açılacak sayfa
  icon?: string;
  tag?: string; // aynı tag'li bildirimler üst üste gelmez
  requireInteraction?: boolean;
};

// Service role client (RLS'yi atlar, server-side için)
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Tek bir subscription'a bildirim gönder (hata olursa siler)
async function sendToSubscription(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }, // 24 saat sonra vazgeç
    );
    return true;
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    // 404/410 — subscription artık geçerli değil, DB'den temizle
    if (statusCode === 404 || statusCode === 410) {
      try {
        const supabase = getServiceClient();
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } catch { /* sessiz */ }
    } else {
      console.error("Push gönderim hatası:", err);
    }
    return false;
  }
}

// Belirli bir kullanıcının tüm cihazlarına bildirim gönder
export async function sendPushToKullanici(kullaniciId: string, payload: PushPayload): Promise<number> {
  if (!vapidConfigured) return 0;
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("kullanici_id", kullaniciId);
  if (error || !data || data.length === 0) return 0;

  const results = await Promise.all(data.map((sub) => sendToSubscription(sub, payload)));
  return results.filter(Boolean).length;
}

// Tüm yönetici kullanıcıların tüm cihazlarına bildirim gönder
export async function sendPushToYoneticiler(payload: PushPayload): Promise<number> {
  if (!vapidConfigured) return 0;
  const supabase = getServiceClient();
  const { data: yoneticiler } = await supabase
    .from("kullanicilar")
    .select("id")
    .eq("rol", "yonetici")
    .eq("aktif", true);
  if (!yoneticiler || yoneticiler.length === 0) return 0;

  const ids = yoneticiler.map((k) => k.id);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("kullanici_id", ids);
  if (!subs || subs.length === 0) return 0;

  const results = await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
  return results.filter(Boolean).length;
}

// Belirli kullanıcılar dışında kalan tüm yöneticilere gönder (kendisine bildirim gitmesin diye)
export async function sendPushToYoneticilerExcept(haricId: string, payload: PushPayload): Promise<number> {
  if (!vapidConfigured) return 0;
  const supabase = getServiceClient();
  const { data: yoneticiler } = await supabase
    .from("kullanicilar")
    .select("id")
    .eq("rol", "yonetici")
    .eq("aktif", true)
    .neq("id", haricId);
  if (!yoneticiler || yoneticiler.length === 0) return 0;

  const ids = yoneticiler.map((k) => k.id);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("kullanici_id", ids);
  if (!subs || subs.length === 0) return 0;

  const results = await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
  return results.filter(Boolean).length;
}
