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

/** TR yerel tarih/saat — sunucu UTC çalışıyor, geçmiş kaydı doğru güne düşsün. */
function trZaman() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const al = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const ss = al("hour") === "24" ? "00" : al("hour");
  return { tarih: `${al("year")}-${al("month")}-${al("day")}`, saat: `${ss}:${al("minute")}:${al("second")}` };
}

/**
 * BİLDİRİM GEÇMİŞİ — zil menüsündeki "Geçmiş" sekmesi.
 *
 * 05.11.2026: sabah özeti (yaklaşan sigorta/muayene, yaklaşan bakım) aylardır telefonlara
 * gidiyor ama geçmişte TEK satırı yoktu — geçmişi yalnız /api/push/notify yazıyordu, bu
 * yardımcı hiç yazmıyordu. Push anlıktır; kaçıran bir daha bulamıyordu.
 *
 * Push'tan ÖNCE ve bağımsız yazılır: kayıtlı cihaz olmasa, VAPID anahtarı eksik olsa ya da
 * gönderim düşse bile iz kalsın.
 */
async function gecmiseYaz(kullaniciIds: string[], payload: PushPayload): Promise<void> {
  if (kullaniciIds.length === 0) return;
  try {
    const supabase = getServiceClient();
    const { tarih, saat } = trZaman();
    const satirlar = (ek: Record<string, unknown>) => kullaniciIds.map((kid) => ({
      kullanici_id: kid,
      baslik: payload.title,
      govde: payload.body,
      url: payload.url ?? "/dashboard",
      tag: payload.tag ?? null,
      tarih, saat, okundu: false, ...ek,
    }));
    const { error } = await supabase.from("bildirim_gecmisi").insert(satirlar({ santiye_id: null }));
    if (error && /column .*santiye_id/i.test(error.message)) {
      await supabase.from("bildirim_gecmisi").insert(satirlar({}));
    } else if (error) throw new Error(error.message);
  } catch (e) {
    // Sessiz geçmiyoruz: "bildirim gitti ama geçmişte yok" durumu tam da burada doğuyor.
    console.error("Bildirim geçmişine yazılamadı:", e instanceof Error ? e.message : e);
  }
}

/** Kategoriyi (tag) kapatmış kullanıcıları ele — /api/push/notify ile aynı kural. */
function kategoriAcikOlanlar(
  kullanicilar: { id: string; bildirim_ayarlari?: Record<string, boolean> | null }[],
  tag?: string,
): string[] {
  return kullanicilar
    .filter((k) => !(tag && (k.bildirim_ayarlari ?? {})[tag] === false))
    .map((k) => k.id);
}

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
  const supabase = getServiceClient();
  const { data: yoneticiler } = await supabase
    .from("kullanicilar")
    .select("id, bildirim_ayarlari")
    .eq("rol", "yonetici")
    .eq("aktif", true);
  if (!yoneticiler || yoneticiler.length === 0) return 0;

  // Kategoriyi kapatana ne push gider ne geçmişe yazılır. (Eskiden ayar hiç bakılmıyordu:
  // "Sigorta & Muayene"yi kapatan kişi sabah özetini yine alıyordu.)
  const ids = kategoriAcikOlanlar(yoneticiler, payload.tag);
  if (ids.length === 0) return 0;
  await gecmiseYaz(ids, payload);

  if (!vapidConfigured) return 0;              // geçmiş yazıldı, push yok
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
  const supabase = getServiceClient();
  const { data: yoneticiler } = await supabase
    .from("kullanicilar")
    .select("id, bildirim_ayarlari")
    .eq("rol", "yonetici")
    .eq("aktif", true)
    .neq("id", haricId);
  if (!yoneticiler || yoneticiler.length === 0) return 0;

  const ids = kategoriAcikOlanlar(yoneticiler, payload.tag);
  if (ids.length === 0) return 0;
  await gecmiseYaz(ids, payload);

  if (!vapidConfigured) return 0;              // geçmiş yazıldı, push yok
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("kullanici_id", ids);
  if (!subs || subs.length === 0) return 0;

  const results = await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
  return results.filter(Boolean).length;
}
