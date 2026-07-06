// Kredi Kartları — kart durum listesi (Ödeme Planı ile İcra Takibi arasındaki sayfa).
"use client";

import { useAuth } from "@/hooks";
import KrediKartiTablosu from "@/components/shared/kredi-karti-tablosu";

export default function KrediKartlariPage() {
  const { hasPermission, isYonetici, loading } = useAuth();
  const gor = isYonetici || hasPermission("kredi-kartlari", "goruntule");

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!gor) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;

  return (
    <KrediKartiTablosu
      canEkle={isYonetici || hasPermission("kredi-kartlari", "ekle")}
      canDuzenle={isYonetici || hasPermission("kredi-kartlari", "duzenle")}
      canSil={isYonetici || hasPermission("kredi-kartlari", "sil")}
    />
  );
}
