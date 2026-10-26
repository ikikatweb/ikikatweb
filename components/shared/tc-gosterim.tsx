"use client";

// TC KİMLİK GÖSTERİMİ — varsayılan MASKELİ, yetkili kullanıcı tıklayınca açar.
//
// Maskeleme iki ayrı riski karşılıyor:
//  • Yetkisi olmayan kullanıcı (bordro ekranını gören ama personel yetkisi olmayan 5 kişi)
//    numarayı HİÇ açamaz.
//  • Yetkisi olan kullanıcıda bile varsayılan maskelidir — ekran paylaşımı, ekran görüntüsü,
//    yanına gelen biri, projeksiyon. Numara gerektiğinde tek tıkla açılır, tekrar tıklanınca
//    kapanır; 160 satırlık listede hepsi birden açık durmaz.
//
// SINIR: görsel tedbirdir; veri sunucudan tam geliyor, ağ yanıtını okuyabilen yine görür.

import { useState } from "react";
import { tcMaskele } from "@/lib/utils/tc-maske";

export default function TcGosterim({
  tc,
  tamGorebilir,
  className = "",
  bos = "—",
}: {
  tc: string | null | undefined;
  /** Yönetici ya da "Personeller" görüntüleme yetkisi olanlar açabilir. */
  tamGorebilir: boolean;
  className?: string;
  bos?: string;
}) {
  const [acik, setAcik] = useState(false);
  const deger = String(tc ?? "").trim();
  if (!deger) return <span className={className}>{bos}</span>;

  if (!tamGorebilir) {
    return (
      <span className={className} title="TC kimlik numarasını görme yetkiniz yok">
        {tcMaskele(deger)}
      </span>
    );
  }

  return (
    <button
      type="button"
      // stopPropagation: TC satır/kart içinde duruyor; tıklama yukarı sızıp satır seçimini
      // ya da kart açılışını tetiklememeli.
      onClick={(e) => { e.stopPropagation(); setAcik((a) => !a); }}
      title={acik ? "Gizlemek için tıklayın" : "Tam numara için tıklayın"}
      className={`${className} cursor-pointer rounded hover:bg-gray-100 ${acik ? "" : "tracking-wide"}`}
    >
      {acik ? deger : tcMaskele(deger)}
    </button>
  );
}
