// Araç düzenleme sayfası
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAracById } from "@/lib/supabase/queries/araclar";
import type { Arac } from "@/lib/supabase/types";
import PageHeader from "@/components/shared/page-header";
import AracForm from "@/components/shared/arac-form";
import toast from "react-hot-toast";

export default function AracDuzenlePage() {
  const params = useParams();
  const aracId = params.id as string;
  const [arac, setArac] = useState<Arac | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadArac() {
      try {
        const data = await getAracById(aracId);
        setArac(data);
      } catch {
        toast.error("Araç bilgileri yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }
    loadArac();
  }, [aracId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Araç Düzenle" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!arac) {
    return (
      <div>
        <PageHeader title="Araç Düzenle" />
        <p className="text-gray-500">Araç bulunamadı.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Araç Düzenle" />
      <AracForm arac={arac} tip={arac.tip} />
    </div>
  );
}
