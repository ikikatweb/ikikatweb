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
  isYonetici: boolean;
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
      if (!kullanici) return true; // Profil yüklenemezse (ilk kurulum) her şeye izin ver
      return checkPermission(kullanici.rol, kullanici.izinler, moduleKey, aksiyon);
    },
    [kullanici]
  );

  return (
    <AuthContext.Provider
      value={{
        kullanici,
        loading,
        hasPermission: hasPermissionFn,
        isYonetici: kullanici?.rol === "yonetici" || !kullanici,
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
