// PUSH BİLDİRİMİ GÖNDER — arka planda çalışan scriptler için.
//
// Neden ayrı: lib/push.ts sunucu (Next.js) tarafı için yazılmış TypeScript. Mail okuyucu
// düz node ile şirket makinesinde dönüyor ve oturum açmış bir kullanıcısı yok; web-push'u
// doğrudan kullanıyor. Anahtarlar aynı (.env.local'daki VAPID), yani telefonlara aynı
// kanaldan gidiyor.
//
// KİME: belirtilen kullanıcılar + tüm aktif yöneticiler. Aynı kişi iki listede olsa da
// bildirim bir kez gider.
import webpush from "web-push";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb service-role istemci
 * @param {object} env .env.local değerleri
 * @param {{baslik: string, govde: string, url?: string, etiket?: string}} icerik
 * @param {string[]} kullaniciIdler yöneticilere EK olarak bildirim gidecek kişiler
 * @returns {Promise<number>} kaç cihaza gönderildi
 */
export async function pushGonder(sb, env, icerik, kullaniciIdler = []) {
  const acik = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, gizli = env.VAPID_PRIVATE_KEY;
  if (!acik || !gizli) return 0;                       // anahtar yoksa sessizce geç
  webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:admin@ikikat.net", acik, gizli);

  const { data: yoneticiler } = await sb.from("kullanicilar")
    .select("id").eq("rol", "yonetici").eq("aktif", true);
  const hedef = new Set([...(yoneticiler ?? []).map((k) => k.id), ...kullaniciIdler.filter(Boolean)]);
  if (hedef.size === 0) return 0;

  const { data: abonelikler } = await sb.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").in("kullanici_id", [...hedef]);
  if (!abonelikler?.length) return 0;

  const yuk = JSON.stringify({
    title: icerik.baslik,
    body: icerik.govde,
    url: icerik.url ?? "/dashboard",
    tag: icerik.etiket ?? "sigorta-teklif",
  });

  let ok = 0;
  for (const a of abonelikler) {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, yuk);
      ok++;
    } catch (e) {
      // 404/410 = abonelik ölmüş (uygulama silinmiş, tarayıcı temizlenmiş) → kaydı temizle.
      const kod = e?.statusCode;
      if (kod === 404 || kod === 410) await sb.from("push_subscriptions").delete().eq("id", a.id);
    }
  }
  return ok;
}
