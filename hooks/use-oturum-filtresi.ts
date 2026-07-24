// Oturum-içi filtre hook'u — useState gibi kullanılır. İstenen davranış:
//   • F5 (sayfa yenileme)                 → filtre KORUNUR
//   • Başka sayfaya geçip GERİ gelme       → filtre SIFIRLANIR (varsayılana döner)
//   • Sekmeyi/tarayıcıyı kapatıp açma       → filtre SIFIRLANIR
//
// Mekanizma: değer sessionStorage'da tutulur (F5'te yaşar, sekme kapanınca silinir). Kullanıcı sayfadan
// CLIENT-SIDE (SPA) navigasyonla AYRILINCA o sayfanın anahtarı temizlenir → geri gelince varsayılan.
// F5/sekme-kapatma'da 'pagehide' bayrağı sayesinde TEMİZLENMEZ (yalnız sayfa-içi ayrılmada temizlenir).
//
// StrictMode-GÜVENLİ: dev'de React effect'leri çift çağırıp sahte unmount yapar. Temizleme setTimeout ile
// ertelenir; sahte unmount'ta bileşen HEMEN yeniden monte olup 'monte' ref'ini true yapar → temizleme iptal.
// Gerçek ayrılmada remount olmaz → 'monte' false kalır → temizlenir.
"use client";

import { useEffect, useRef, useState } from "react";

const ONEK = "ikikat-filtre:"; // sessionStorage anahtar öneki

// Sayfa gerçekten boşalıyor (F5 / sekme kapatma) → bu sırada olan unmount'ta TEMİZLEME (değer korunsun).
let sayfaBosaltiliyor = false;
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { sayfaBosaltiliyor = true; });
  // bfcache'ten geri dönerse bayrağı sıfırla (sayfa yeniden aktif)
  window.addEventListener("pageshow", () => { sayfaBosaltiliyor = false; });
}

export function useOturumFiltresi<T>(anahtar: string, varsayilan: T): [T, (yeni: T | ((onceki: T) => T)) => void] {
  const tamAnahtar = ONEK + anahtar;
  const [deger, setDeger] = useState<T>(varsayilan);
  const ilkKayit = useRef(true);
  const monte = useRef(true);

  // Mount: sessionStorage'dan oku (SSR ile aynı ilk render → hydration güvenli). monte=true.
  useEffect(() => {
    monte.current = true;
    try {
      const ham = window.sessionStorage.getItem(tamAnahtar);
      if (ham != null) setDeger(JSON.parse(ham) as T);
    } catch { /* bozuk/erişilemez → varsayılan kalır */ }
    return () => { monte.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tamAnahtar]);

  // Değer değişince kaydet. İlk (mount) çalıştırma atlanır → yükleme öncesi varsayılan kayıtlı değeri ezmesin.
  useEffect(() => {
    if (ilkKayit.current) { ilkKayit.current = false; return; }
    try { window.sessionStorage.setItem(tamAnahtar, JSON.stringify(deger)); } catch { /* dolu/kapalı → yoksay */ }
  }, [tamAnahtar, deger]);

  // Sayfa-içi (client-side) navigasyonla AYRILINCA temizle. F5/kapatma → sayfaBosaltiliyor=true → koru.
  // setTimeout: StrictMode sahte unmount'ta bileşen hemen remount olup monte=true yapar → temizleme iptal.
  useEffect(() => {
    return () => {
      if (sayfaBosaltiliyor) return; // F5 / sekme kapatma → değer KORUNUR
      window.setTimeout(() => {
        if (!monte.current) {         // gerçekten ayrıldık (StrictMode remount olsaydı monte=true olurdu)
          try { window.sessionStorage.removeItem(tamAnahtar); } catch { /* yoksay */ }
        }
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tamAnahtar]);

  return [deger, setDeger];
}
