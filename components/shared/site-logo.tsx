// Ana sayfa header logosu. /logo-kadtem.png (tam lockup) varsa onu gösterir; dosya yoksa (henüz
// yüklenmediyse) KIRIK görsel yerine eski /logo.png + "KAD-TEM A.Ş." yazısına düşer. Header yüksekliği
// her iki durumda da ~81px kalsın diye ikisi de h-14.
/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";

export default function SiteLogo() {
  const [hata, setHata] = useState(false);
  if (hata) {
    return (
      <span className="flex items-center gap-3">
        <img src="/logo.png" alt="KAD-TEM A.Ş." className="h-14 w-auto object-contain" />
        <span className="text-xl font-semibold tracking-tight text-[#1E3A5F]">KAD-TEM A.Ş.</span>
      </span>
    );
  }
  return (
    <img src="/logo-kadtem.png" alt="KAD-TEM A.Ş." className="h-14 w-auto object-contain" onError={() => setHata(true)} />
  );
}
