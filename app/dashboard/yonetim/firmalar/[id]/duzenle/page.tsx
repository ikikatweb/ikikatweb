// Firma düzenleme sayfası - Mevcut firma bilgilerini yükler ve düzenlemeye açar
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getFirmaById } from "@/lib/supabase/queries/firmalar";
import type { Firma } from "@/lib/supabase/types";
import PageHeader from "@/components/shared/page-header";
import FirmaForm from "@/components/shared/firma-form";
import toast from "react-hot-toast";

export default function FirmaDuzenlePage() {
  const params = useParams();
  const firmaId = params.id as string;
  const [firma, setFirma] = useState<Firma | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFirma() {
      try {
        const data = await getFirmaById(firmaId);
        setFirma(data);
      } catch {
        toast.error("Firma bilgileri yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }
    loadFirma();
  }, [firmaId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Firma Düzenle" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!firma) {
    return (
      <div>
        <PageHeader title="Firma Düzenle" />
        <p className="text-gray-500">Firma bulunamadı.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Firma Düzenle" />
      <FirmaForm firma={firma} />
    </div>
  );
}
