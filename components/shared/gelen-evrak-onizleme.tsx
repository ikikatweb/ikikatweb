// Gelen evrak yazışma ön izleme — Dilekçe Standart Sayfa Formatı
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hesaplaSehirOfset } from "@/lib/utils/muhatap";

type Firma = {
  firma_adi: string;
  kisa_adi: string | null;
  adres: string | null;
  antet_url: string | null;
  kase_url: string | null;
};

type Props = {
  firma: Firma | null | undefined;
  evrakTarihi: string;
  evrakSayiNo: string;
  konu: string;
  muhatap: string | null;
  ilgi: string | null;
  icerik: string | null;
  ekler: string | null;
};

function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>")
    .replace(/&lt;i&gt;/g, "<i>").replace(/&lt;\/i&gt;/g, "</i>")
    .replace(/&lt;u&gt;/g, "<u>").replace(/&lt;\/u&gt;/g, "</u>");
}

export default function GelenEvrakOnIzleme({
  firma, evrakTarihi, evrakSayiNo, konu, muhatap, ilgi, icerik, ekler,
}: Props) {
  const ilgiHarfler = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const ilgiSatirlari = ilgi ? ilgi.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const eklerSatirlari = ekler ? ekler.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const metinParagraflar = (icerik ?? "").split("\n").filter((p) => p.trim());

  return (
    <div className="evrak-onizleme bg-white mx-auto" style={{
      fontFamily: "Arial, Helvetica, sans-serif", width: "210mm", minHeight: "297mm",
      paddingTop: "1.25cm", paddingBottom: "0.5cm", paddingLeft: "2.25cm", paddingRight: "2.25cm",
      boxSizing: "border-box", color: "#000",
    }}>
      {/* Logo */}
      <div style={{ marginBottom: "0.3cm" }}>
        {firma?.antet_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={firma.antet_url} alt="Antet" style={{ width: "100%", height: "auto" }} />
        ) : (
          <div style={{ textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Logo" style={{ height: "1.5cm", objectFit: "contain" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
        )}
      </div>

      {/* Tarih */}
      <div style={{ textAlign: "right", fontSize: "10pt", fontWeight: "bold" }}>
        {evrakTarihi ? new Date(evrakTarihi).toLocaleDateString("tr-TR") : ""}
      </div>
      <div style={{ height: "2em" }} />

      {/* Sayı */}
      {evrakSayiNo && (
        <div style={{ fontSize: "10.5pt", marginBottom: "0.2cm", textIndent: "3cm" }}>
          <span style={{ fontWeight: "bold" }}>Sayı:</span>&nbsp;&nbsp;{evrakSayiNo}
        </div>
      )}

      {/* Muhatap */}
      {muhatap && <MuhatapPrintBlock muhatap={muhatap} />}
      <div style={{ height: "3em" }} />

      {/* Konu */}
      <div style={{ fontSize: "10.5pt", textAlign: "left", textIndent: "3cm" }}>
        <span style={{ fontWeight: "bold" }}>Konu:</span>&nbsp;{konu}
      </div>
      <div style={{ height: "1em" }} />

      {/* İlgi */}
      {ilgiSatirlari.length > 0 && (
        <div style={{ fontSize: "10.5pt", textAlign: "left", paddingLeft: "0cm" }}>
          {ilgiSatirlari.map((satir, i) => (
            <div key={i} style={{ marginBottom: "1pt" }}>
              <span style={{ fontWeight: "bold" }}>
                İlgi {ilgiSatirlari.length > 1 ? `${ilgiHarfler[i] ?? String(i + 1)}` : ""}:
              </span>&nbsp;{satir}
            </div>
          ))}
        </div>
      )}
      <div style={{ height: "2em" }} />

      {/* Metin */}
      {metinParagraflar.length > 0 && (
        <div style={{ marginLeft: "0.5cm" }}>
          {metinParagraflar.map((p, i) => (
            <div key={i} style={{ fontSize: "10.5pt", lineHeight: "1.5", textAlign: "justify", textIndent: "1.5cm", marginBottom: "3pt" }}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(p) }} />
          ))}
        </div>
      )}
      <div style={{ height: "4em" }} />

      {/* Ekler (sol) + Kaşe (sağ) yan yana */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", minHeight: "80px" }}>
        <div style={{ fontSize: "9.5pt", flex: 1 }}>
          {eklerSatirlari.length > 0 && (
            <>
              <div style={{ fontWeight: "bold", paddingLeft: "1.25cm", marginBottom: "2pt" }}>Ek:</div>
              {eklerSatirlari.map((ek, i) => (
                <div key={i} style={{ paddingLeft: "0.75cm", lineHeight: "1.4" }}>{i + 1}) {ek}</div>
              ))}
            </>
          )}
        </div>
        {firma?.kase_url && (
          <div style={{ flexShrink: 0, marginRight: "1cm", marginTop: "-1cm" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={firma.kase_url} alt="Kaşe" style={{ maxHeight: "80px", width: "auto" }} />
          </div>
        )}
      </div>
    </div>
  );
}

function MuhatapPrintBlock({ muhatap }: { muhatap: string }) {
  const satirlar = muhatap.split("\n").map((s) => s.trim()).filter(Boolean);
  const sonSatirRef = useRef<HTMLDivElement>(null);
  const sehirRef = useRef<HTMLDivElement>(null);
  const [sehirLeft, setSehirLeft] = useState<number | null>(null);
  const tekSatir = satirlar.length < 2;
  const sehir = tekSatir ? "" : satirlar[satirlar.length - 1];
  const oncekiSatirlar = tekSatir ? satirlar : satirlar.slice(0, -1);

  useLayoutEffect(() => {
    if (tekSatir || !sonSatirRef.current || !sehirRef.current) return;
    const ofset = hesaplaSehirOfset(sonSatirRef.current, sehirRef.current);
    if (ofset !== null) setSehirLeft(ofset);
  }, [muhatap, tekSatir, sehir]);

  useEffect(() => {
    if (tekSatir) return;
    const handler = () => {
      if (sonSatirRef.current && sehirRef.current) {
        const ofset = hesaplaSehirOfset(sonSatirRef.current, sehirRef.current);
        if (ofset !== null) setSehirLeft(ofset);
      }
    };
    window.addEventListener("beforeprint", handler);
    return () => window.removeEventListener("beforeprint", handler);
  }, [tekSatir]);

  if (tekSatir) {
    return <div style={{ textAlign: "center", fontSize: "11pt", fontWeight: "bold", lineHeight: "1.4" }}>{satirlar[0] ?? ""}</div>;
  }

  return (
    <div style={{ fontSize: "11pt", fontWeight: "bold", lineHeight: "1.4", position: "relative" }}>
      {oncekiSatirlar.map((s, i) => (
        <div key={i} ref={i === oncekiSatirlar.length - 1 ? sonSatirRef : undefined} style={{ textAlign: "center" }}>{s}</div>
      ))}
      <div ref={sehirRef} style={{
        letterSpacing: "0.05em", whiteSpace: "nowrap",
        ...(sehirLeft != null ? { paddingLeft: `${Math.max(0, sehirLeft)}px`, textAlign: "left" as const } : { textAlign: "center" as const }),
      }}>{sehir}</div>
    </div>
  );
}
