// Şantiye seçim bileşeni — aktif şantiyeler üstte, diğerleri optgroup ile altta
"use client";

import { useState } from "react";

type SantiyeItem = {
  id: string;
  is_adi: string;
  durum?: string;
  gecici_kabul_tarihi?: string | null;
  kesin_kabul_tarihi?: string | null;
  tasfiye_tarihi?: string | null;
  devir_tarihi?: string | null;
  yuklenici_firma_id?: string | null;
};

type FirmaItem = { id: string; firma_adi: string; sira_no?: number | null };

type Props = {
  santiyeler: SantiyeItem[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  showAll?: boolean;
  // Verilirse aktif şantiyeler firma adı altında <optgroup> ile gruplanır.
  // Firma sırasını korumak için listenin geliş sırası kullanılır (DB sira_no ASC).
  firmalar?: FirmaItem[];
};

export default function SantiyeSelect({
  santiyeler, value, onChange, placeholder = "Şantiye seçiniz", className = "",
  showAll = false, firmalar,
}: Props) {
  const [digerAcik, setDigerAcik] = useState(false);

  const aktifler = santiyeler.filter((s) =>
    s.durum === "aktif" && !s.gecici_kabul_tarihi && !s.kesin_kabul_tarihi && !s.tasfiye_tarihi && !s.devir_tarihi
  );
  const digerleri = santiyeler.filter((s) =>
    s.durum !== "aktif" || s.gecici_kabul_tarihi || s.kesin_kabul_tarihi || s.tasfiye_tarihi || s.devir_tarihi
  );

  const seciliDigerde = digerleri.some((s) => s.id === value);
  const gosterDigerleri = digerAcik || seciliDigerde;

  // Firma gruplaması — opsiyonel.
  // firmalar prop'u verildiyse, aktif şantiyeleri firma adı altında <optgroup> ile gruplanır.
  // Firmasız (yuklenici_firma_id null) şantiyeler "Firmasız" başlığı altında en sonda.
  const gruplaAktiflere = firmalar && firmalar.length > 0;
  const aktifGruplar: { firmaAd: string; santiyeler: SantiyeItem[] }[] = [];
  if (gruplaAktiflere) {
    const firmaSiraMap = new Map<string, number>();
    firmalar.forEach((f, i) => firmaSiraMap.set(f.id, i));
    const firmaAdMap = new Map<string, string>();
    firmalar.forEach((f) => firmaAdMap.set(f.id, f.firma_adi));
    // Firma id'sine göre grupla
    const gruplar = new Map<string, SantiyeItem[]>();
    for (const s of aktifler) {
      const fId = s.yuklenici_firma_id ?? "__firmasiz__";
      if (!gruplar.has(fId)) gruplar.set(fId, []);
      gruplar.get(fId)!.push(s);
    }
    // Firma sırasına göre dizmek için
    const firmaIds = Array.from(gruplar.keys()).sort((a, b) => {
      if (a === "__firmasiz__") return 1; // En sonda
      if (b === "__firmasiz__") return -1;
      return (firmaSiraMap.get(a) ?? Number.MAX_SAFE_INTEGER) - (firmaSiraMap.get(b) ?? Number.MAX_SAFE_INTEGER);
    });
    for (const fId of firmaIds) {
      aktifGruplar.push({
        firmaAd: fId === "__firmasiz__" ? "Firmasız" : (firmaAdMap.get(fId) ?? "Bilinmeyen Firma"),
        santiyeler: gruplar.get(fId)!,
      });
    }
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={(className || "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50") + " min-w-0 truncate"}
      >
        <option value="">{showAll ? "Tümü" : placeholder}</option>
        {gruplaAktiflere ? (
          // Firma grupları içinde aktif şantiyeler
          aktifGruplar.map((grup, i) => (
            <optgroup key={`f-${i}`} label={grup.firmaAd}>
              {grup.santiyeler.map((s) => (
                <option key={s.id} value={s.id}>{s.is_adi}</option>
              ))}
            </optgroup>
          ))
        ) : (
          // Eski davranış: gruplama yok
          aktifler.length > 0 && aktifler.map((s) => (
            <option key={s.id} value={s.id}>{s.is_adi}</option>
          ))
        )}
        {gosterDigerleri && digerleri.length > 0 && (
          <optgroup label="Diğer Şantiyeler">
            {digerleri.map((s) => {
              const etiket = s.tasfiye_tarihi ? " (Tasfiye)" : s.devir_tarihi ? " (Devir)" : (s.gecici_kabul_tarihi || s.kesin_kabul_tarihi) ? " (Tamamlandı)" : s.durum === "pasif" ? " (Pasif)" : "";
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
