// Service Worker — Web Push bildirimlerini yönetir
// Bu dosya tarayıcıda ayrı bir thread'de çalışır

const CACHE_VERSION = "v1";

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

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      // Açık bir sekme varsa: postMessage ile sayfaya navigate komutu yolla + focus
      // Bu yöntem client.navigate()'tan daha güvenilir — bazı tarayıcılarda
      // (özellikle iOS Safari) client.navigate sessizce başarısız oluyor.
      // Sayfanın kendi içindeki listener window.location.href ile garanti yönlendirir.
      for (const client of clientList) {
        if ("focus" in client) {
          // Önce postMessage gönder (sayfa yönlendirmeyi yapacak)
          try {
            client.postMessage({ type: "BILDIRIM_NAVIGATE", url });
          } catch (e) { /* sessiz */ }
          // Yedek: client.navigate da çağır (eski tarayıcılar için)
          if ("navigate" in client) {
            try { await client.navigate(url); } catch (e) { /* sessiz */ }
          }
          return client.focus();
        }
      }
      // Açık sekme yoksa yeni sekme aç (URL tam — query param dahil)
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
