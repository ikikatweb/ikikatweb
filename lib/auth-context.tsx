// Auth context - Kullanıcı profili, rol ve izin yönetimi
"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { getKullaniciProfil } from "@/lib/supabase/queries/kullanicilar";
import { hasPermission as checkPermission } from "@/lib/permissions";
import type { Kullanici, IzinAksiyonu } from "@/lib/supabase/types";

type AuthContextType = {
  kullanici: Kullanici | null;
  loading: boolean;
  hasPermission: (moduleKey: string, aksiyon: IzinAksiyonu) => boolean;
  // Tam yetkili sistem yöneticisi — tüm verilere erişir
  isYonetici: boolean;
  // Şantiye yöneticisi — atandığı şantiyelerin TÜM verilerine erişir
  isShantiyeAdmin: boolean;
  // Şantiye filtresinden muaf mı? (yönetici için true)
  // Kısıtlı + Şantiye admini: santiye_ids üzerinden filtrelenir
  santiyeFilterUygula: boolean;
  // Veriler "kendi kayıtları" olarak filtrelensin mi? (sadece kısıtlı)
  // Yönetici ve şantiye admini için false → tüm kayıtlar görünür
  sadeceKendiKayitlari: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [kullanici, setKullanici] = useState<Kullanici | null>(null);
  const [loading, setLoading] = useState(true);
  // Giriş yapılıp yapılmadığını event listener içinde okumak için ref
  const girisYapildiRef = useRef(false);

  // Son giriş kaydı + yeni oturumda yöneticilere bildirim. 2 dk throttle (localStorage).
  // Hem mount'ta hem de uygulama ÖNE GELDİĞİNDE (visibilitychange/focus) çağrılır —
  // böylece iOS PWA gibi yeniden YÜKLENMEYEN (devam ettirilen) açılışlarda da çalışır.
  const girisKaydet = useCallback(() => {
    if (!girisYapildiRef.current) return;
    try {
      const sonPing = parseInt(localStorage.getItem("sonGirisPing") ?? "0", 10);
      if (Date.now() - sonPing <= 120000) return;
      localStorage.setItem("sonGirisPing", String(Date.now()));
      fetch("/api/kullanicilar/giris", { method: "POST" })
        .then((r) => r.json())
        .then((j) => {
          if (j?.yeniGiris) {
            // Giriş bildirimi — sadece yöneticilere gider (tag → yonetim-kullanicilar).
            // Çağıran (giriş yapan) hariç tutulur; gövdeye 👤 ad otomatik eklenir.
            fetch("/api/push/notify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baslik: "🔐 Kullanıcı Girişi",
                govde: "Siteye giriş yaptı.",
                tag: "kullanici-giris",
                url: "/dashboard/yonetim/kullanicilar",
              }),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    } catch { /* localStorage yoksa sessiz */ }
  }, []);

  // Uygulama öne geldiğinde (PWA resume / sekme aktif olunca) son girişi kaydet.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") girisKaydet(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", girisKaydet);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", girisKaydet);
    };
  }, [girisKaydet]);

  useEffect(() => {
    async function loadProfile() {
      try {
        // Beni hatırla süresi kontrolü
        const rememberMe = localStorage.getItem("rememberMe");
        const expiry = localStorage.getItem("rememberExpiry");
        if (rememberMe && expiry && Date.now() > parseInt(expiry)) {
          // 7 gün dolmuş — çıkış yap
          localStorage.removeItem("rememberMe");
          localStorage.removeItem("rememberExpiry");
          const { createClient } = await import("@/lib/supabase/client");
          const supabase = createClient();
          await supabase.auth.signOut();
          setKullanici(null);
          setLoading(false);
          return;
        }

        const data = await getKullaniciProfil();
        setKullanici(data);
        girisYapildiRef.current = !!data;
        // Son giriş zamanını güncelle + (yeni oturumsa) yöneticilere bildirim gönder.
        if (data) girisKaydet();
      } catch {
        setKullanici(null);
        girisYapildiRef.current = false;
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
    // girisKaydet stabildir (useCallback deps []); mount'ta bir kez çalışması yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPermissionFn = useCallback(
    (moduleKey: string, aksiyon: IzinAksiyonu): boolean => {
      // Profil yüklenirken: yükleme tamamlanana kadar yetki yok varsay
      // (yüklenince re-render olur ve doğru sonuç döner — flicker önlenir)
      if (loading) return false;
      // Profil yüklenememişse (ilk kurulum / kayıt yok): yönetici varsay
      if (!kullanici) return true;
      return checkPermission(kullanici.rol, kullanici.izinler, moduleKey, aksiyon);
    },
    [kullanici, loading]
  );

  // Provider value — useMemo ile sabit referans (her render'da yeni obje
  // yaratmazsa tüm consumer'lar gereksiz re-render olmaz)
  const contextValue = useMemo<AuthContextType>(() => {
    const isYonetici = !loading && (kullanici?.rol === "yonetici" || !kullanici);
    const isShantiyeAdmin = kullanici?.rol === "santiye_admin";
    return {
      kullanici,
      loading,
      hasPermission: hasPermissionFn,
      isYonetici,
      isShantiyeAdmin,
      // Şantiye filtresi: yönetici hariç herkese (admin + kısıtlı) uygulanır
      santiyeFilterUygula: !isYonetici,
      // Kendi kayıtları filtresi: SADECE kısıtlı için
      sadeceKendiKayitlari: !isYonetici && !isShantiyeAdmin,
    };
  }, [kullanici, loading, hasPermissionFn]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
