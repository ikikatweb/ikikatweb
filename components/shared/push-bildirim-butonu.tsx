// Push Bildirim Aç/Kapat butonu — kullanıcı bir kez tıklar, izin alınır, subscription server'a gider
"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

// Base64 URL-safe → ArrayBuffer (pushManager.subscribe BufferSource bekler)
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buffer;
}

export default function PushBildirimButonu() {
  const [durum, setDurum] = useState<"yukleniyor" | "desteklenmiyor" | "reddedilmis" | "kapali" | "acik">("yukleniyor");
  const [islemYapiliyor, setIslemYapiliyor] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setDurum("desteklenmiyor");
      return;
    }
    if (Notification.permission === "denied") {
      setDurum("reddedilmis");
      return;
    }
    // Subscription durumunu kontrol et
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setDurum(sub ? "acik" : "kapali"))
      .catch(() => setDurum("kapali"));
  }, []);

  async function bildirimAc() {
    setIslemYapiliyor(true);
    try {
      // Service worker'ı kaydet
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // İzin iste
      const izin = await Notification.requestPermission();
      if (izin !== "granted") {
        toast.error("Bildirim izni reddedildi.");
        setDurum(izin === "denied" ? "reddedilmis" : "kapali");
        return;
      }

      // Subscribe ol
      const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublic) {
        toast.error("VAPID key tanımlı değil. Site yöneticisi ile iletişime geçin.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapidPublic),
      });

      // Server'a gönder
      const subJson = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Kayıt başarısız");

      setDurum("acik");
      toast.success("Bildirimler açıldı!");
    } catch (err) {
      console.error(err);
      toast.error(`Bildirim açılamadı: ${err instanceof Error ? err.message : "Bilinmeyen hata"}`);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  async function bildirimKapat() {
    setIslemYapiliyor(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setDurum("kapali");
      toast.success("Bildirimler kapatıldı.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : "Bilinmeyen"}`);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  async function testBildirim() {
    setIslemYapiliyor(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.sent > 0) toast.success(`${data.sent} cihaza test bildirim gönderildi.`);
      else toast.error("Hiç abone cihaz bulunamadı.");
    } catch (err) {
      toast.error(`Test başarısız: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  if (durum === "yukleniyor") return null;

  if (durum === "desteklenmiyor") {
    return (
      <div className="text-xs text-gray-400 flex items-center gap-1">
        <BellOff size={14} /> Bu tarayıcı bildirim desteklemiyor
      </div>
    );
  }

  if (durum === "reddedilmis") {
    return (
      <div className="text-xs text-red-500 flex items-center gap-1" title="Tarayıcı ayarlarından izin vermen gerekiyor">
        <BellOff size={14} /> Bildirim izni reddedildi
      </div>
    );
  }

  if (durum === "kapali") {
    return (
      <Button size="sm" onClick={bildirimAc} disabled={islemYapiliyor} className="bg-blue-600 hover:bg-blue-700 text-white">
        <Bell size={14} className="mr-1" /> {islemYapiliyor ? "Açılıyor..." : "Bildirimleri Aç"}
      </Button>
    );
  }

  // acik
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={testBildirim} disabled={islemYapiliyor} title="Test bildirim gönder">
        <BellRing size={14} className="mr-1" /> Test
      </Button>
      <Button size="sm" variant="outline" onClick={bildirimKapat} disabled={islemYapiliyor}>
        <BellOff size={14} className="mr-1" /> Bildirimleri Kapat
      </Button>
    </div>
  );
}
