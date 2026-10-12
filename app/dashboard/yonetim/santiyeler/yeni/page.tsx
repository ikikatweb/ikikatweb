// Yeni iş (şantiye) ekleme sayfası
"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import PageHeader from "@/components/shared/page-header";
import SantiyeForm from "@/components/shared/santiye-form";

/**
 * Ana ekrandaki "Netsim'de yeni iş açılmış" uyarısından gelindiğinde iş adı ve Netsim
 * işlem noktası numarası adres çubuğunda taşınır; form bunlarla açılır. Böylece kullanıcı
 * adı yeniden yazmaz ve Netsim bağı ilk kayıtta kurulur — sonradan elle eşleştirme gerekmez.
 */
function YeniSantiyeIcerik() {
  const q = useSearchParams();
  const netsimNo = q.get("netsim");
  const ad = q.get("ad");
  return (
    <div>
      <PageHeader title="Yeni İş Ekle" />
      {netsimNo && (
        <div className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Netsim&apos;deki <b>[{netsimNo}]</b> numaralı işlem noktası için açılıyor —
          kaydettiğinizde Netsim bağı kurulur, hakedişler buraya akar.
        </div>
      )}
      <SantiyeForm
        baslangicIsAdi={ad ?? undefined}
        baslangicNetsimNo={netsimNo ? Number(netsimNo) : undefined}
      />
    </div>
  );
}

export default function YeniSantiyePage() {
  // useSearchParams istemci tarafında çözülür; Suspense olmadan derleme uyarı veriyor.
  return (
    <Suspense fallback={<div><PageHeader title="Yeni İş Ekle" /></div>}>
      <YeniSantiyeIcerik />
    </Suspense>
  );
}
