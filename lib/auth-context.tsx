// Auth context - Kullanıcı profili, rol ve izin yönetimi
"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
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
      } catch {
        setKullanici(null);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
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

  // Yükleme bitmeden yönetici varsayma — yetki kontrolünden geçmeden buton görünmesin
  const isYonetici = !loading && (kullanici?.rol === "yonetici" || !kullanici);
  const isShantiyeAdmin = kullanici?.rol === "santiye_admin";

  return (
    <AuthContext.Provider
      value={{
        kullanici,
        loading,
        hasPermission: hasPermissionFn,
        isYonetici,
        isShantiyeAdmin,
        // Şantiye filtresi: yönetici hariç herkese (admin + kısıtlı) uygulanır
        santiyeFilterUygula: !isYonetici,
        // Kendi kayıtları filtresi: SADECE kısıtlı için
        sadeceKendiKayitlari: !isYonetici && !isShantiyeAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
