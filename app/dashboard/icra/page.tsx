// İcra takibi sayfası — Kasa ile Şantiye Defteri arasındaki bağımsız sekme.
"use client";

import { useAuth } from "@/hooks";
import IcraTablosu from "@/components/shared/icra-tablosu";

export default function IcraPage() {
  const { hasPermission, isYonetici, loading } = useAuth();
  const gor = isYonetici || hasPermission("icra", "goruntule");

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!gor) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;

  return (
    <IcraTablosu
      canEkle={isYonetici || hasPermission("icra", "ekle")}
      canDuzenle={isYonetici || hasPermission("icra", "duzenle")}
      canSil={isYonetici || hasPermission("icra", "sil")}
    />
  );
}
