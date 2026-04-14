// Muhatap render yardımcısı - Son satır (şehir) önceki satırın son kelimesinin ortasına hizalanır
"use client";

import React, { useRef, useLayoutEffect, useState } from "react";

// Çok satırlı muhatabı tek satıra dönüştürür: "T.C.\nDevlet Su İşleri\nTOKAT" -> "T.C. Devlet Su İşleri TOKAT"
export function tekSatirMuhatap(deger: string | null | undefined): string {
  if (!deger) return "";
  return deger
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Şehir (son satır) elementinin sol ofsetini hesaplar.
 *
 * Yaklaşım: Range.getBoundingClientRect() ile önceki satırın son kelimesinin
 * gerçek render edilmiş pozisyonunu ve şehir metninin gerçek genişliğini
 * (letter-spacing dahil) doğrudan DOM'dan okur. Bu yöntem manuel span
 * ölçümlerine göre çok daha kesindir — kerning, letter-spacing ve font
 * metrik farklılıklarından etkilenmez.
 *
 * Dönüş: şehir div'ine uygulanması gereken paddingLeft değeri (px),
 * ya da ölçüm yapılamıyorsa null.
 */
export function hesaplaSehirOfset(
  sonSatirEl: HTMLElement,
  sehirEl: HTMLElement,
): number | null {
  // Son satırdaki text node'u bul
  let sonSatirTextNode: Text | null = null;
  for (const child of Array.from(sonSatirEl.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim()) {
      sonSatirTextNode = child as Text;
      break;
    }
  }
  if (!sonSatirTextNode) return null;

  const sonSatirText = sonSatirTextNode.textContent ?? "";
  const trimmed = sonSatirText.trim();
  if (!trimmed) return null;

  const kelimeler = trimmed.split(/\s+/);
  const sonKelime = kelimeler[kelimeler.length - 1];
  if (!sonKelime) return null;

  // Son kelimenin text node içindeki başlangıç ve bitiş indeksleri
  const sonKelimeStart = sonSatirText.lastIndexOf(sonKelime);
  if (sonKelimeStart < 0) return null;
  const sonKelimeEnd = sonKelimeStart + sonKelime.length;

  // Range API: son kelimenin gerçek render edilmiş bounding box'ı
  let kelimeRect: DOMRect;
  try {
    const range = document.createRange();
    range.setStart(sonSatirTextNode, sonKelimeStart);
    range.setEnd(sonSatirTextNode, sonKelimeEnd);
    kelimeRect = range.getBoundingClientRect();
  } catch {
    return null;
  }

  if (kelimeRect.width === 0) return null;

  // Son kelimenin container'a göre sol pozisyonu + orta nokta
  const containerRect = sonSatirEl.getBoundingClientRect();
  const kelimeOrtasi = kelimeRect.left - containerRect.left + kelimeRect.width / 2;

  // Şehir metninin gerçek genişliği (letter-spacing dahil)
  let sehirGenislik = 0;
  let sehirTextNode: Text | null = null;
  for (const child of Array.from(sehirEl.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim()) {
      sehirTextNode = child as Text;
      break;
    }
  }
  if (sehirTextNode) {
    try {
      const sehirRange = document.createRange();
      sehirRange.setStart(sehirTextNode, 0);
      sehirRange.setEnd(sehirTextNode, (sehirTextNode.textContent ?? "").length);
      sehirGenislik = sehirRange.getBoundingClientRect().width;
    } catch {
      sehirGenislik = 0;
    }
  }

  if (sehirGenislik === 0) return null;

  // Şehrin sol pozisyonu = kelimeOrtası - şehirGenişlik/2
  return kelimeOrtasi - sehirGenislik / 2;
}

export function renderMuhatap(deger: string, size: "sm" | "xs" = "xs") {
  const satirlar = deger.split("\n").map((s) => s.trim()).filter(Boolean);
  if (satirlar.length < 2) return <div className={`text-center text-${size}`}>{deger}</div>;

  const sonSatir = satirlar[satirlar.length - 1];
  const oncekiSatirlar = satirlar.slice(0, -1);

  return <MuhatapBlock oncekiSatirlar={oncekiSatirlar} sehir={sonSatir} size={size} />;
}

function MuhatapBlock({ oncekiSatirlar, sehir, size }: { oncekiSatirlar: string[]; sehir: string; size: string }) {
  const sonSatirRef = useRef<HTMLDivElement>(null);
  const sehirRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sehirLeft, setSehirLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!sonSatirRef.current || !sehirRef.current) return;
    const ofset = hesaplaSehirOfset(sonSatirRef.current, sehirRef.current);
    if (ofset !== null) setSehirLeft(ofset);
  }, [oncekiSatirlar, sehir]);

  return (
    <div ref={containerRef} className={`inline-block text-${size} leading-tight relative`} style={{ minWidth: "100%" }}>
      {oncekiSatirlar.map((s, i) => (
        <div key={i} ref={i === oncekiSatirlar.length - 1 ? sonSatirRef : undefined} className="text-center">
          {s}
        </div>
      ))}
      <div
        ref={sehirRef}
        className="font-medium tracking-wider mt-0.5 whitespace-nowrap"
        style={sehirLeft != null ? { paddingLeft: `${Math.max(0, sehirLeft)}px` } : { textAlign: "center" }}
      >
        {sehir}
      </div>
    </div>
  );
}
