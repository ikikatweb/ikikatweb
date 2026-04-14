// Personel düzenleme sayfası
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPersonelById } from "@/lib/supabase/queries/personel";
import type { Personel } from "@/lib/supabase/types";
import PageHeader from "@/components/shared/page-header";
import PersonelForm from "@/components/shared/personel-form";
import toast from "react-hot-toast";

export default function PersonelDuzenlePage() {
  const params = useParams();
  const personelId = params.id as string;
  const [personel, setPersonel] = useState<Personel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPersonel() {
      try {
        const data = await getPersonelById(personelId);
        setPersonel(data);
      } catch {
        toast.error("Personel bilgileri yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }
    loadPersonel();
  }, [personelId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Personel Düzenle" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!personel) {
    return (
      <div>
        <PageHeader title="Personel Düzenle" />
        <p className="text-gray-500">Personel bulunamadı.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Personel Düzenle" />
      <PersonelForm personel={personel} />
    </div>
  );
}
