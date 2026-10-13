// Yeni iş (şantiye) ekleme sayfası
"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/shared/page-header";
import SantiyeForm, { type NetsimBaslangic } from "@/components/shared/santiye-form";
import { createClient } from "@/lib/supabase/client";

const NETSIM_ALANLAR =
  "sozlesme_bedeli, ihale_tarihi, ilan_tarihi, ihale_kayit_no, sozlesme_tarihi, isyeri_teslim_tarihi, ortaklik_orani, yuklenici_firma_id, ortak_girisim, firma_adlari";

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const trh = (g: string) => new Date(g + "T00:00:00").toLocaleDateString("tr-TR");

/** Netsim'den dolu gelen alanları kullanıcıya sayar — neyin hazır geldiği görünsün. */
function dolanlar(b: NetsimBaslangic): string[] {
  const x: string[] = [];
  if (b.sozlesme_bedeli != null) x.push(`sözleşme bedeli ${tl(b.sozlesme_bedeli)}`);
  if (b.ihale_kayit_no) x.push(`İKN ${b.ihale_kayit_no}`);
  if (b.ihale_tarihi) x.push(`ihale ${trh(b.ihale_tarihi)}`);
  if (b.ilan_tarihi) x.push(`ilan ${trh(b.ilan_tarihi)}`);
  if (b.sozlesme_tarihi) x.push(`sözleşme ${trh(b.sozlesme_tarihi)}`);
  if (b.isyeri_teslim_tarihi) x.push(`işyeri teslim ${trh(b.isyeri_teslim_tarihi)}`);
  if (b.ortaklik_orani != null) x.push(`ortaklık oranı %${b.ortaklik_orani}`);
  if (b.yuklenici_firma_id) x.push("yüklenici firma");
  return x;
}

/**
 * Ana ekrandaki "Netsim'de yeni iş açılmış" uyarısından gelindiğinde iş adı ve Netsim
 * işlem noktası numarası adres çubuğunda taşınır. İşin diğer bilgileri (sözleşme bedeli,
 * ihale tarihi, İKN…) adres çubuğunda taşınmaz — 7 alan URL'i okunmaz hâle getirirdi;
 * netsim_yeni_nokta kaydından okunur.
 *
 * Form veri GELDİKTEN SONRA kurulur: formData useState ile bir kez kurulduğu için
 * sonradan gelen değerler alanlara işlemez, kullanıcı yine boş form görürdü.
 */
function YeniSantiyeIcerik() {
  const q = useSearchParams();
  const netsimNo = q.get("netsim");
  const ad = q.get("ad");
  const [bilgi, setBilgi] = useState<NetsimBaslangic | null>(null);
  const [yukleniyor, setYukleniyor] = useState(!!netsimNo);

  const yukle = useCallback(async (no: string) => {
    try {
      const sb = createClient();
      const { data } = await sb
        .from("netsim_yeni_nokta")
        .select(NETSIM_ALANLAR)
        .eq("nokta_no", Number(no))
        .maybeSingle();
      // Bilgi yoksa (ya da sütunlar henüz açılmamışsa) form yalnız ad ve nokta no ile
      // açılır — eski davranış. Sayfa bozulmaz.
      if (data) setBilgi(data as unknown as NetsimBaslangic);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (netsimNo) void yukle(netsimNo);
  }, [netsimNo, yukle]);

  const hazir = bilgi ? dolanlar(bilgi) : [];

  return (
    <div>
      <PageHeader title="Yeni İş Ekle" />
      {netsimNo && (
        <div className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Netsim&apos;deki <b>[{netsimNo}]</b> numaralı işlem noktası için açılıyor —
          kaydettiğinizde Netsim bağı kurulur, hakedişler buraya akar.
          {hazir.length > 0 && (
            <div className="mt-1 text-sky-700">
              Netsim&apos;den dolu geldi: {hazir.join(" · ")}. Kaydetmeden önce kontrol edin.
            </div>
          )}
          {/* Firma eşleşmediyse kullanıcı neyi aradığını görsün — Netsim'deki ad yazılır. */}
          {bilgi && !bilgi.yuklenici_firma_id && bilgi.firma_adlari && (
            <div className="mt-1 text-amber-700">
              Netsim&apos;de firma <b>{bilgi.firma_adlari}</b> yazıyor; sitede buna birebir
              uyan kayıt yok, yüklenici firmayı siz seçin.
            </div>
          )}
        </div>
      )}
      {yukleniyor ? (
        <p className="text-sm text-gray-400">Netsim bilgileri alınıyor…</p>
      ) : (
        <SantiyeForm
          baslangicIsAdi={ad ?? undefined}
          baslangicNetsimNo={netsimNo ? Number(netsimNo) : undefined}
          baslangicNetsim={bilgi ?? undefined}
        />
      )}
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
