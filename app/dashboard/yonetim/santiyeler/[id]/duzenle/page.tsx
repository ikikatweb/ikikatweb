// Şantiye düzenleme sayfası
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSantiyeById } from "@/lib/supabase/queries/santiyeler";
import type { Santiye } from "@/lib/supabase/types";
import PageHeader from "@/components/shared/page-header";
import SantiyeForm from "@/components/shared/santiye-form";
import toast from "react-hot-toast";

export default function SantiyeDuzenlePage() {
  const params = useParams();
  const santiyeId = params.id as string;
  const [santiye, setSantiye] = useState<Santiye | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSantiye() {
      try {
        const data = await getSantiyeById(santiyeId);
        setSantiye(data);
      } catch {
        toast.error("İş bilgileri yüklenemedi.");
      } finally {
        setLoading(false);
      }
    }
    loadSantiye();
  }, [santiyeId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="İş Düzenle" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!santiye) {
    return (
      <div>
        <PageHeader title="İş Düzenle" />
        <p className="text-gray-500">İş bulunamadı.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="İş Düzenle" />
      <SantiyeForm santiye={santiye} />
    </div>
  );
}
