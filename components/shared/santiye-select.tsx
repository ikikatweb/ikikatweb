// Şantiye seçim bileşeni — custom aranabilir dropdown.
// Native <select> Chrome mobilede uzun seçeneklere göre dropdown'u genişletiyordu.
// Custom dropdown sabit genişlikte kalır, uzun isimler ellipsis ile kırpılır.
"use client";

import { useEffect, useRef, useState } from "react";
import { trAramaNormalize } from "@/lib/utils/isim";

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
  // Verilirse aktif şantiyeler firma adı altında gruplanır (DB sira_no ASC).
  firmalar?: FirmaItem[];
};

export default function SantiyeSelect({
  santiyeler, value, onChange, placeholder = "Şantiye seçiniz", className = "",
  showAll = false, firmalar,
}: Props) {
  const [acik, setAcik] = useState(false);
  const [arama, setArama] = useState("");
  const [digerAcik, setDigerAcik] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Mobil tespiti — uzun şantiye adlarını trigger'da kısaltmak için
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Açılır panel dışına tıklayınca kapat
  useEffect(() => {
    if (!acik) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setAcik(false);
        setArama("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [acik]);

  const aktifler = santiyeler.filter((s) =>
    s.durum === "aktif" && !s.gecici_kabul_tarihi && !s.kesin_kabul_tarihi && !s.tasfiye_tarihi && !s.devir_tarihi
  );
  const digerleri = santiyeler.filter((s) =>
    s.durum !== "aktif" || s.gecici_kabul_tarihi || s.kesin_kabul_tarihi || s.tasfiye_tarihi || s.devir_tarihi
  );

  const seciliDigerde = digerleri.some((s) => s.id === value);
  const gosterDigerleri = digerAcik || seciliDigerde;

  // Firma gruplaması — opsiyonel
  const gruplaAktiflere = firmalar && firmalar.length > 0;
  const aktifGruplar: { firmaAd: string; santiyeler: SantiyeItem[] }[] = [];
  if (gruplaAktiflere) {
    const firmaSiraMap = new Map<string, number>();
    firmalar.forEach((f, i) => firmaSiraMap.set(f.id, i));
    const firmaAdMap = new Map<string, string>();
    firmalar.forEach((f) => firmaAdMap.set(f.id, f.firma_adi));
    const gruplar = new Map<string, SantiyeItem[]>();
    for (const s of aktifler) {
      const fId = s.yuklenici_firma_id ?? "__firmasiz__";
      if (!gruplar.has(fId)) gruplar.set(fId, []);
      gruplar.get(fId)!.push(s);
    }
    const firmaIds = Array.from(gruplar.keys()).sort((a, b) => {
      if (a === "__firmasiz__") return 1;
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

  // Seçili şantiyenin görünen metni
  const seciliSantiye = santiyeler.find((s) => s.id === value);
  const gosterilenMetin = seciliSantiye
    ? (() => {
        const etiket = seciliSantiye.tasfiye_tarihi
          ? " (Tasfiye)"
          : seciliSantiye.devir_tarihi
            ? " (Devir)"
            : (seciliSantiye.gecici_kabul_tarihi || seciliSantiye.kesin_kabul_tarihi)
              ? " (Tamamlandı)"
              : seciliSantiye.durum === "pasif"
                ? " (Pasif)"
                : "";
        return `${seciliSantiye.is_adi}${etiket}`;
      })()
    : "";

  // Arama filtresi
  const q = trAramaNormalize(arama);
  const aramaFiltreli = (liste: SantiyeItem[]) =>
    q ? liste.filter((s) => trAramaNormalize(s.is_adi).includes(q)) : liste;

  // Stil — className verilmemişse varsayılan
  const triggerClass = (className || "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50") + " min-w-0";

  return (
    <div ref={wrapperRef} className="flex items-center gap-1 min-w-0 relative w-full">
      <button
        type="button"
        onClick={() => setAcik((p) => !p)}
        className={triggerClass + " flex-1 min-w-0 flex items-center justify-between gap-1 text-left cursor-pointer"}
      >
        {/* Uzun isimleri "..." ile kes (mobil 22, masaüstü 38 karakter) — dar dialoglarda
            ad taşıp Kaydet butonunu kaydırmasın. CSS truncate ile birlikte güvenlik kemeri. */}
        <span className={`truncate min-w-0 flex-1 ${!gosterilenMetin ? "text-gray-400" : ""}`}>
          {(() => {
            const ham = gosterilenMetin || (showAll ? "Tümü" : placeholder);
            const limit = isMobile ? 22 : 38;
            if (ham.length > limit) return ham.slice(0, limit) + "...";
            return ham;
          })()}
        </span>
        <span className="flex-shrink-0 text-gray-400 text-xs">▼</span>
      </button>
      {digerleri.length > 0 && (
        <button
          type="button"
          onClick={() => setDigerAcik((p) => !p)}
          className="h-9 px-2 text-[9px] rounded-lg border bg-gray-50 hover:bg-gray-100 text-gray-500 whitespace-nowrap flex-shrink-0"
        >
          {gosterDigerleri ? "▲ Gizle" : `▼ +${digerleri.length}`}
        </button>
      )}
      {acik && (
        <div
          className="absolute left-0 mt-1 bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto"
          style={{
            top: "100%",
            // Trigger ile aynı genişlikte; sağda "Diğer" butonu varsa onu da kapsa
            width: digerleri.length > 0 ? "calc(100% - 0px)" : "100%",
            right: digerleri.length > 0 ? "auto" : 0,
            minWidth: 180,
            // Tablo sticky header'ları z-50/z-60 kullandığı için dropdown z-100
            // ile üstte kalır (sayfa üstündeki notification/toast'lardan düşük).
            zIndex: 100,
          }}
        >
          {/* Arama kutusu */}
          <div className="sticky top-0 bg-white border-b p-1.5 z-10">
            <input
              type="text"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              autoFocus
              placeholder="Ara..."
              className="w-full h-7 text-xs px-2 rounded border border-input outline-none focus:border-ring"
            />
          </div>
          <div className="py-0.5">
            {showAll && (
              <button
                type="button"
                onClick={() => { onChange(""); setAcik(false); setArama(""); }}
                className={`w-full text-left px-3 py-1.5 text-xs truncate hover:bg-blue-50 ${!value ? "bg-blue-50 font-semibold" : ""}`}
              >
                Tümü
              </button>
            )}
            {!showAll && !value && (
              <div className="px-3 py-1 text-[10px] text-gray-400 italic">{placeholder}</div>
            )}
            {gruplaAktiflere ? (
              aktifGruplar.map((grup, i) => {
                const grupSantiyeler = aramaFiltreli(grup.santiyeler);
                if (grupSantiyeler.length === 0) return null;
                return (
                  <div key={`f-${i}`}>
                    <div className="px-3 py-1 text-[10px] font-semibold text-gray-500 bg-gray-50 truncate">
                      {grup.firmaAd}
                    </div>
                    {grupSantiyeler.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { onChange(s.id); setAcik(false); setArama(""); }}
                        className={`w-full text-left px-3 py-1.5 text-xs truncate hover:bg-blue-50 ${value === s.id ? "bg-blue-50 font-semibold" : ""}`}
                      >
                        {s.is_adi}
                      </button>
                    ))}
                  </div>
                );
              })
            ) : (
              aramaFiltreli(aktifler).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onChange(s.id); setAcik(false); setArama(""); }}
                  className={`w-full text-left px-3 py-1.5 text-xs truncate hover:bg-blue-50 ${value === s.id ? "bg-blue-50 font-semibold" : ""}`}
                >
                  {s.is_adi}
                </button>
              ))
            )}
            {gosterDigerleri && digerleri.length > 0 && (() => {
              const filtreliDigerleri = aramaFiltreli(digerleri);
              if (filtreliDigerleri.length === 0) return null;
              return (
                <div>
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-500 bg-gray-50">Diğer Şantiyeler</div>
                  {filtreliDigerleri.map((s) => {
                    const etiket = s.tasfiye_tarihi ? " (Tasfiye)" : s.devir_tarihi ? " (Devir)" : (s.gecici_kabul_tarihi || s.kesin_kabul_tarihi) ? " (Tamamlandı)" : s.durum === "pasif" ? " (Pasif)" : "";
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { onChange(s.id); setAcik(false); setArama(""); }}
                        className={`w-full text-left px-3 py-1.5 text-xs truncate hover:bg-blue-50 ${value === s.id ? "bg-blue-50 font-semibold" : ""}`}
                      >
                        {s.is_adi}<span className="text-gray-400">{etiket}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {/* Hiç sonuç yoksa */}
            {(() => {
              const hicVar =
                (gruplaAktiflere
                  ? aktifGruplar.some((g) => aramaFiltreli(g.santiyeler).length > 0)
                  : aramaFiltreli(aktifler).length > 0) ||
                (gosterDigerleri && aramaFiltreli(digerleri).length > 0);
              if (!hicVar && arama) {
                return <div className="px-3 py-2 text-[11px] text-gray-400 italic">Eşleşen şantiye yok.</div>;
              }
              return null;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
