// Şantiye seçim bileşeni — aktif şantiyeler üstte, diğerleri optgroup ile altta
"use client";

import { useState } from "react";

type SantiyeItem = { id: string; is_adi: string; durum?: string; gecici_kabul_tarihi?: string | null; tasfiye_tarihi?: string | null; devir_tarihi?: string | null };

type Props = {
  santiyeler: SantiyeItem[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  showAll?: boolean;
};

export default function SantiyeSelect({ santiyeler, value, onChange, placeholder = "Şantiye seçiniz", className = "", showAll = false }: Props) {
  const [digerAcik, setDigerAcik] = useState(false);

  const aktifler = santiyeler.filter((s) =>
    s.durum === "aktif" && !s.gecici_kabul_tarihi && !s.tasfiye_tarihi && !s.devir_tarihi
  );
  const digerleri = santiyeler.filter((s) =>
    s.durum !== "aktif" || s.gecici_kabul_tarihi || s.tasfiye_tarihi || s.devir_tarihi
  );

  const seciliDigerde = digerleri.some((s) => s.id === value);
  const gosterDigerleri = digerAcik || seciliDigerde;

  return (
    <div className="flex items-center gap-1 min-w-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={(className || "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50") + " min-w-0 truncate"}
      >
        <option value="">{showAll ? "Tümü" : placeholder}</option>
        {aktifler.length > 0 && aktifler.map((s) => (
          <option key={s.id} value={s.id}>{s.is_adi}</option>
        ))}
        {gosterDigerleri && digerleri.length > 0 && (
          <optgroup label="Diğer Şantiyeler">
            {digerleri.map((s) => {
              const etiket = s.tasfiye_tarihi ? " (Tasfiye)" : s.devir_tarihi ? " (Devir)" : s.gecici_kabul_tarihi ? " (Tamamlandı)" : s.durum === "pasif" ? " (Pasif)" : "";
              return <option key={s.id} value={s.id}>{s.is_adi}{etiket}</option>;
            })}
          </optgroup>
        )}
      </select>
      {digerleri.length > 0 && (
        <button
          type="button"
          onClick={() => setDigerAcik((p) => !p)}
          className="h-9 px-2 text-[9px] rounded-lg border bg-gray-50 hover:bg-gray-100 text-gray-500 whitespace-nowrap"
          title={gosterDigerleri ? "Diğer şantiyeleri gizle" : `Diğer şantiyeler (${digerleri.length})`}
        >
          {gosterDigerleri ? "▲ Gizle" : `▼ +${digerleri.length}`}
        </button>
      )}
    </div>
  );
}
