// Giden evrak yazışma ön izleme — Dilekçe Standart Sayfa Formatı
// A4, Arial, resmi dilekçe düzeni
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
  ilgiListesi: string[];
  metin: string | null;
  ekler: string[];
  kaseDahil: boolean;
};

// Word HTML çöpünü (MSO attribute'leri, conditional comments, namespaced tag'lar
// ve metin içine literal olarak sızmış Word CSS kalıntıları) agresif şekilde temizler
function wordCopGidr(text: string): string {
  let result = text
    // === 1. Gerçek HTML tag-level çöp ===
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-z]+:[a-z0-9_-]+\b[^>]*>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    // Tüm tag'lardaki attribute'leri sil
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, "<$1$2>");

  // === 2. Paragraf başlangıcındaki literal Word CSS kalıntısı ===
  // Pattern: metin `something:value;...">` şeklinde başlıyorsa, o kısmı sil
  // (açılış <span style="..."> kısmı kesilmiş, sadece attribute content + "> text kalmış)
  // İki kez uygula — bazen ardışık garbage olabilir
  const cssKalintiRegex = /^\s*"?[^<>"\n]*?[a-zA-Z-]+\s*:\s*[^<>\n]*?">\s*/;
  for (let i = 0; i < 3; i++) {
    const yeni = result.replace(cssKalintiRegex, "");
    if (yeni === result) break;
    result = yeni;
  }

  return result;
}

// HTML yapısını (div/br) koruyarak sadece çöpü temizler — editör çıktısını birebir render için
function sanitizeHtmlTamHtml(text: string): string {
  if (!text) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return text;
  }

  // Word çöpünü temizle
  const cleaned = wordCopGidr(text);

  // DOMParser ile güvenli parse + yeniden serialize
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${cleaned}</div>`, "text/html");
  const root = doc.body.firstChild as HTMLElement | null;
  if (!root) return "";

  const escapeText = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // İzin verilen tag'lar: div, p, br, b, strong, i, em, u, span (içerik için)
  const izinliTag = new Set(["div", "p", "br", "b", "strong", "i", "em", "u", "span"]);

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeText(node.textContent ?? "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const icerik = Array.from(el.childNodes).map(walk).join("");

    if (!izinliTag.has(tag)) return icerik;

    // Tag normalizasyonu
    if (tag === "strong") return `<b>${icerik}</b>`;
    if (tag === "em") return `<i>${icerik}</i>`;
    if (tag === "br") return "<br>";

    // Inline style'da bold/italic/underline varsa tag'a çevir
    const style = el.getAttribute("style") ?? "";
    const bold = /font-weight\s*:\s*(bold|[6-9]00|1000)/i.test(style);
    const italic = /font-style\s*:\s*italic/i.test(style);
    const underline = /text-decoration[^;]*underline/i.test(style);

    if (tag === "span") {
      let sonuc = icerik;
      if (bold) sonuc = `<b>${sonuc}</b>`;
      if (italic) sonuc = `<i>${sonuc}</i>`;
      if (underline) sonuc = `<u>${sonuc}</u>`;
      return sonuc;
    }

    // div, p, b, i, u — tag'ı koru ama attribute'leri at
    return `<${tag}>${icerik}</${tag}>`;
  }

  return walk(root);
}

// Metin içindeki <b>, <i>, <u> tag'larını güvenli şekilde render et
// DOMParser ile parse edip, sadece izin verilen tag'ları koruyarak güvenli HTML üretir
function sanitizeHtml(text: string): string {
  if (!text) return "";
  // SSR ortamında DOMParser yok — basit fallback ile text döndür
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return text.replace(/<[^>]*>/g, "");
  }

  // 1) Word çöplerini agresif temizle
  const cleaned = wordCopGidr(text);

  // 2) DOMParser ile güvenli parse
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${cleaned}</div>`, "text/html");
  const root = doc.body.firstChild as HTMLElement | null;
  if (!root) return "";

  const escapeText = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeText(node.textContent ?? "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const icerik = Array.from(el.childNodes).map(walk).join("");

    // Doğrudan desteklenen tag'lar
    if (tag === "b" || tag === "strong") return `<b>${icerik}</b>`;
    if (tag === "i" || tag === "em") return `<i>${icerik}</i>`;
    if (tag === "u") return `<u>${icerik}</u>`;

    // Diğer tag'lar (span, div, p, font, h1-6 vb.) → sadece içerik
    return icerik;
  }

  return walk(root);
}

export default function GidenEvrakOnIzleme({
  firma,
  evrakTarihi,
  evrakSayiNo,
  konu,
  muhatap,
  ilgiListesi,
  metin,
  ekler,
  kaseDahil,
}: Props) {
  const ilgiHarfler = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const aktifIlgi = (ilgiListesi ?? []).filter((i) => i?.trim());
  const aktifEkler = (ekler ?? []).filter((e) => e?.trim());

  // Metin olduğu gibi (editördeki biçimle birebir) render edilecek
  // Sadece Word çöpü temizlenir, HTML yapısı korunur
  const metinTemiz = sanitizeHtmlTamHtml(metin ?? "");

  return (
    <div
      className="evrak-onizleme bg-white mx-auto"
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        width: "210mm",
        minHeight: "297mm",
        paddingTop: "1.25cm",
        paddingBottom: "0.5cm",
        paddingLeft: "2.25cm",
        paddingRight: "2.25cm",
        boxSizing: "border-box",
        color: "#000",
        position: "relative",
      }}
    >
      {/* ===== 1. ÜST BİLGİ — Antet tam genişlik, logo ortalı ===== */}
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

      {/* Çizgi — antet ile tarih arası */}
      <hr style={{ border: "none", borderTop: "0.5px solid #aaa", margin: "0 0 0.4cm 0" }} />

      {/* ===== 2. TARİH — Sağa yaslı, 10pt, kalın ===== */}
      <div style={{ textAlign: "right", fontSize: "10pt", fontWeight: "bold", marginBottom: "0" }}>
        {evrakTarihi ? new Date(evrakTarihi).toLocaleDateString("tr-TR") : ""}
      </div>

      {/* 1 boş satır */}
      <div style={{ height: "1em" }} />

      {/* ===== 3. SAYI — 0.5cm soldan ===== */}
      {evrakSayiNo && (
        <div style={{ fontSize: "9.5pt", marginBottom: "0.2cm", textAlign: "left", paddingLeft: "0.5cm" }}>
          <span style={{ fontWeight: "bold" }}>Sayı:</span>&nbsp;&nbsp;{evrakSayiNo}
        </div>
      )}

      {/* ===== 4. MUHATAP — Ortalı, 11pt Bold ===== */}
      {muhatap && <MuhatapPrintBlock muhatap={muhatap} />}

      {/* 2 boş satır */}
      <div style={{ height: "2em" }} />

      {/* ===== 5. KONU — 10.5pt, 0.5cm soldan ===== */}
      <div style={{ fontSize: "10.5pt", textAlign: "left", marginBottom: "0", paddingLeft: "0.5cm" }}>
        <span style={{ fontWeight: "bold" }}>Konu:</span>&nbsp;{konu}
      </div>

      {/* 1 boş satır */}
      <div style={{ height: "1em" }} />

      {/* ===== 6. İLGİ — 10.5pt, 0.5cm soldan ===== */}
      {aktifIlgi.length > 0 && (
        <div style={{ fontSize: "10.5pt", textAlign: "left", paddingLeft: "0.5cm" }}>
          {aktifIlgi.map((satir, i) => (
            <div key={i} style={{ marginBottom: "1pt" }}>
              <span style={{ fontWeight: "bold" }}>
                İlgi {aktifIlgi.length > 1 ? `${ilgiHarfler[i] ?? String(i + 1)}` : ""}:
              </span>
              &nbsp;{satir}
            </div>
          ))}
        </div>
      )}

      {/* 2 boş satır */}
      <div style={{ height: "2em" }} />

      {/* ===== 7. METİN — editör çıktısı birebir (tab'lar, boş satırlar, paragraflar korunur) ===== */}
      {metinTemiz && (
        <div
          style={{
            marginLeft: "0.5cm",
            fontSize: "10.5pt",
            lineHeight: "1.5",
            textAlign: "left",
            whiteSpace: "pre-wrap",
            orphans: 3,
            widows: 3,
          }}
          dangerouslySetInnerHTML={{ __html: metinTemiz }}
        />
      )}

      {/* 4 boş satır */}
      <div style={{ height: "4em" }} />

      {/* ===== 8. EKLER (sol) + KAŞE (sağ) yan yana ===== */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", minHeight: "80px" }}>
        {/* Sol: Ekler — 1 punto küçük */}
        <div style={{ fontSize: "9.5pt", flex: 1 }}>
          {aktifEkler.length > 0 && (
            <>
              <div style={{ fontWeight: "bold", paddingLeft: "1.25cm", marginBottom: "2pt" }}>Ek:</div>
              {aktifEkler.map((ek, i) => (
                <div key={i} style={{ paddingLeft: "0.75cm", lineHeight: "1.4", maxWidth: "50ch", wordWrap: "break-word" as const }}>
                  {i + 1}) {ek}
                </div>
              ))}
            </>
          )}
        </div>
        {/* Sağ: Kaşe — 1cm sola, 1cm yukarı */}
        {kaseDahil && firma?.kase_url && (
          <div style={{ flexShrink: 0, marginRight: "1cm", marginTop: "-1cm" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={firma.kase_url} alt="Kaşe" style={{ maxHeight: "105px", width: "auto" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// Muhatap bloğu — ortalı, 11pt Bold, son satır (şehir) önceki satırın son kelimesinin ortasına hizalı
function MuhatapPrintBlock({ muhatap }: { muhatap: string }) {
  const satirlar = muhatap.split("\n").map((s) => s.trim()).filter(Boolean);
  const sonSatirRef = useRef<HTMLDivElement>(null);
  const sehirRef = useRef<HTMLDivElement>(null);
  const [sehirLeft, setSehirLeft] = useState<number | null>(null);

  const tekSatir = satirlar.length < 2;
  const sehir = tekSatir ? "" : satirlar[satirlar.length - 1];
  const oncekiSatirlar = tekSatir ? satirlar : satirlar.slice(0, -1);

  useLayoutEffect(() => {
    if (tekSatir) return;
    if (!sonSatirRef.current || !sehirRef.current) return;
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
    return (
      <div style={{ textAlign: "center", fontSize: "11pt", fontWeight: "bold", lineHeight: "1.4" }}>
        {satirlar[0] ?? ""}
      </div>
    );
  }

  return (
    <div style={{ fontSize: "11pt", fontWeight: "bold", lineHeight: "1.4", position: "relative" }}>
      {oncekiSatirlar.map((s, i) => (
        <div
          key={i}
          ref={i === oncekiSatirlar.length - 1 ? sonSatirRef : undefined}
          style={{ textAlign: "center" }}
        >
          {s}
        </div>
      ))}
      <div
        ref={sehirRef}
        style={{
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
          ...(sehirLeft != null
            ? { paddingLeft: `${Math.max(0, sehirLeft)}px`, textAlign: "left" as const }
            : { textAlign: "center" as const }),
        }}
      >
        {sehir}
      </div>
    </div>
  );
}
