// PUSH BİLDİRİMİ GÖNDER — arka planda çalışan scriptler için.
//
// Neden ayrı: lib/push.ts sunucu (Next.js) tarafı için yazılmış TypeScript. Mail okuyucu
// düz node ile şirket makinesinde dönüyor ve oturum açmış bir kullanıcısı yok; web-push'u
// doğrudan kullanıyor. Anahtarlar aynı (.env.local'daki VAPID), yani telefonlara aynı
// kanaldan gidiyor.
//
// KİME: belirtilen kullanıcılar + tüm aktif yöneticiler. Aynı kişi iki listede olsa da
// bildirim bir kez gider.
//
// BİLDİRİM GEÇMİŞİ de yazılır (zil menüsündeki "Geçmiş" sekmesi). 05.11.2026: ADR 790'ın
// poliçesi içe alındı, telefonlara push gitti ama geçmişte hiç görünmedi — çünkü geçmişi
// yalnız /api/push/notify yazıyordu ve o rota oturum istiyor; arka plan scriptinin oturumu
// yok. Push anlıktır, kaçırılırsa bir daha dönmez; kalıcı iz geçmişte olmalı.
import webpush from "web-push";

/** TR yerel tarih/saat — sunucu UTC çalışsa bile geçmiş doğru güne düşsün. */
function trZaman(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d);
  const al = (t) => p.find((x) => x.type === t)?.value ?? "00";
  const ss = al("hour") === "24" ? "00" : al("hour");
  return { tarih: `${al("year")}-${al("month")}-${al("day")}`, saat: `${ss}:${al("minute")}:${al("second")}` };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb service-role istemci
 * @param {object} env .env.local değerleri
 * @param {{baslik: string, govde: string, url?: string, etiket?: string, kategori?: string|null}} icerik
 *   etiket  = push'un üst üste binmesini engelleyen anahtar (araca özel)
 *   kategori = geçmişteki/ayarlardaki KATEGORİ tag'i (ör. "sigorta-police"); kapatan kullanıcıya gitmez
 * @param {string[]} kullaniciIdler yöneticilere EK olarak bildirim gidecek kişiler
 * @returns {Promise<number>} kaç cihaza gönderildi (geçmiş kaydı cihaz olmasa da yazılır)
 */
export async function pushGonder(sb, env, icerik, kullaniciIdler = []) {
  const { data: yoneticiler } = await sb.from("kullanicilar")
    .select("id, bildirim_ayarlari").eq("rol", "yonetici").eq("aktif", true);
  const ayarlar = new Map((yoneticiler ?? []).map((k) => [k.id, k.bildirim_ayarlari ?? {}]));
  const hedef = new Set([...(yoneticiler ?? []).map((k) => k.id), ...kullaniciIdler.filter(Boolean)]);
  if (hedef.size === 0) return 0;

  // Kategoriyi kapatmış kullanıcıya ne push gider ne geçmişe yazılır (notify rotasıyla aynı kural).
  const kategori = icerik.kategori ?? null;
  const alicilar = [...hedef].filter((id) => !(kategori && (ayarlar.get(id) ?? {})[kategori] === false));
  if (alicilar.length === 0) return 0;

  // GEÇMİŞ — push'tan ÖNCE ve push başarısız olsa da yazılır: bildirim kaçsa bile iz kalsın.
  try {
    const { tarih, saat } = trZaman();
    const satir = (ek) => alicilar.map((kid) => ({
      kullanici_id: kid, baslik: icerik.baslik, govde: icerik.govde,
      url: icerik.url ?? "/dashboard", tag: kategori, tarih, saat, okundu: false, ...ek,
    }));
    const { error } = await sb.from("bildirim_gecmisi").insert(satir({ santiye_id: null }));
    if (error && /column .*santiye_id/i.test(error.message)) await sb.from("bildirim_gecmisi").insert(satir({}));
    else if (error) throw new Error(error.message);
  } catch (e) {
    // Geçmiş yazılamadıysa push'u engelleme ama SUSMA — bildirim gitti sanılıp geçmişte
    // bulunamaması tam da bu değişikliğin düzelttiği sorun.
    console.error(`     bildirim geçmişine yazılamadı: ${e?.message ?? e}`);
  }

  const acik = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, gizli = env.VAPID_PRIVATE_KEY;
  if (!acik || !gizli) return 0;                       // anahtar yok → geçmiş yazıldı, push yok
  webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:admin@ikikat.net", acik, gizli);

  const { data: abonelikler } = await sb.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").in("kullanici_id", alicilar);
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
