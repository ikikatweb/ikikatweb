// Ödeme Planı — Kasa Defteri'nden BAĞIMSIZ, kendi sayfası (elle girilen nakit planı).
"use client";

import { useAuth } from "@/hooks";
import OdemePlani from "@/components/shared/odeme-plani";

export default function OdemePlaniPage() {
  const { hasPermission, isYonetici, loading } = useAuth();
  const gor = isYonetici || hasPermission("odeme-plani", "goruntule");

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!gor) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;

  return (
    <OdemePlani
      canEkle={isYonetici || hasPermission("odeme-plani", "ekle")}
      canDuzenle={isYonetici || hasPermission("odeme-plani", "duzenle")}
      canSil={isYonetici || hasPermission("odeme-plani", "sil")}
    />
  );
}
