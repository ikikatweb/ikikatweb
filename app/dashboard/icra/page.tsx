// İcra sayfası — sayfa-içi sekme: [İcra Takibi] tablosu + [Tanımlamalar] (Cevap Şekli seçenekleri).
"use client";

import { useState } from "react";
import { useAuth } from "@/hooks";
import IcraTablosu from "@/components/shared/icra-tablosu";
import IcraTanimlamalar from "@/components/shared/icra-tanimlamalar";
import { Gavel, ListChecks } from "lucide-react";

export default function IcraPage() {
  const { hasPermission, isYonetici, loading } = useAuth();
  const gor = isYonetici || hasPermission("icra", "goruntule");
  const canEkle = isYonetici || hasPermission("icra", "ekle");
  const canDuzenle = isYonetici || hasPermission("icra", "duzenle");
  const canSil = isYonetici || hasPermission("icra", "sil");
  const [sekme, setSekme] = useState<"takip" | "tanim">("takip");

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!gor) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;

  const sekmeler = [
    { id: "takip" as const, label: "İcra Takibi", icon: <Gavel size={15} /> },
    { id: "tanim" as const, label: "Tanımlamalar", icon: <ListChecks size={15} /> },
  ];

  return (
    <div>
      {/* Sayfa-içi sekme çubuğu */}
      <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1 mb-4">
        {sekmeler.map((s) => (
          <button key={s.id} type="button" onClick={() => setSekme(s.id)}
            className={`flex items-center gap-1.5 px-3.5 h-9 rounded-md text-sm font-medium transition-colors ${
              sekme === s.id ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"
            }`}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {sekme === "takip" ? (
        <IcraTablosu canEkle={canEkle} canDuzenle={canDuzenle} canSil={canSil} />
      ) : (
        <IcraTanimlamalar canEkle={canEkle} canSil={canSil} />
      )}
    </div>
  );
}
