// Service Worker — Web Push bildirimlerini yönetir
// Bu dosya tarayıcıda ayrı bir thread'de çalışır

// Sürüm artırıldı ki tarayıcılar yeni service worker'ı alsın (09.11.2026).
const CACHE_VERSION = "v2";

// Yükleme
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Aktifleştirme
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Push mesajı geldi — bildirim göster
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "İkikat", body: event.data ? event.data.text() : "Yeni bildirim" };
  }

  const title = data.title || "İkikat Yönetim";
  const options = {
    body: data.body || "",
    icon: data.icon || "/logo.png",
    badge: data.badge || "/logo.png",
    tag: data.tag || "ikikat-bildirim",
    data: {
      url: data.url || "/dashboard",
      ...data.data,
    },
    requireInteraction: data.requireInteraction ?? false,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Bildirime tıklandı — ilgili sayfayı aç
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";

  // BELGE ADRESİ YENİ SEKMEDE AÇILIR (09.11.2026).
  // Bildirime tıklayınca açık panel sekmesi kendini yönlendiriyordu; tebligat PDF'i
  // açılırken PANEL KAYBOLUYORDU. Panel sayfaları için bu davranış doğru (aynı sekmede
  // gezinmek istenir), ama belge bir "sayfa" değil — açıp kapatılan bir ek. Dosya
  // geçidine (/api/dosya) giden adresler artık ayrı sekmede açılıyor, panel yerinde kalıyor.
  const belgeMi = url.startsWith("/api/dosya");

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      if (belgeMi) {
        // Açık sekmeye DOKUNULMAZ: postMessage gönderilmiyor, yönlendirme yapılmıyor.
        return clients.openWindow ? clients.openWindow(url) : undefined;
      }
      // Açık sekme varsa: postMessage gönder + focus.
      // SADECE postMessage kullanıyoruz — client.navigate ile çakışmayı önlemek için.
      // Sayfanın listener'ı window.location.href ile yönlendirme yapar.
      for (const client of clientList) {
        if ("focus" in client) {
          try { client.postMessage({ type: "BILDIRIM_NAVIGATE", url }); } catch (e) { /* sessiz */ }
          return client.focus();
        }
      }
      // Açık sekme yoksa yeni sekme aç (URL tam — query param dahil)
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
