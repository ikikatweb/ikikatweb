// Renk paletinden seçim yapan bileşen — firma ve iş tanımları için ortak kullanılır
"use client";

import { RENK_PALETI } from "@/lib/utils/renk-palet";

type Props = {
  value: string | null;
  onChange: (hex: string | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
};

export default function RenkSecici({ value, onChange, disabled = false, allowClear = false }: Props) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {allowClear && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          title="Renk yok"
          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-gray-400 text-xs transition-all
            ${!value ? "border-[#1E3A5F] ring-2 ring-[#1E3A5F]/30" : "border-gray-300 hover:border-gray-400"}
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          ✕
        </button>
      )}
      {RENK_PALETI.map((p) => {
        const secili = value?.toLowerCase() === p.hex.toLowerCase();
        return (
          <button
            key={p.hex}
            type="button"
            onClick={() => onChange(p.hex)}
            disabled={disabled}
            title={p.ad}
            className={`w-7 h-7 rounded-full border-2 transition-all
              ${secili ? "ring-2 ring-[#1E3A5F] ring-offset-1" : "hover:scale-110"}
              ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            style={{ backgroundColor: p.hex, borderColor: secili ? "#1E3A5F" : p.hex }}
          />
        );
      })}
    </div>
  );
}
