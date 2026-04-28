// İhale — Sınır Değer Hesaplama
// 4734 Sayılı KİK bazlı rekabet analizi otomasyonu
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import {
  getTumTanimlamalar,
  createTanimlama,
  updateTanimlama,
  deleteTanimlama,
} from "@/lib/supabase/queries/tanimlamalar";
import {
  getIhaleler,
  getKatilimcilar,
  insertIhale,
  updateIhale,
  deleteIhale,
  insertKatilimcilar,
  deleteKatilimcilar,
} from "@/lib/supabase/queries/ihale";
import type { Ihale, IhaleKatilimci, Firma } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Calculator, FileDown, FileSpreadsheet, Plus, Trash2, Search,
  Upload, Eye, Share2, Pencil, AlertTriangle, CheckCircle2,
  UserPlus,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

// Türkçe karakter temizleme (PDF için)
function tr(s: string): string {
  return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
    .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
    .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
}

function formatSayi(n: number, digits = 2): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatTL(n: number): string { return formatSayi(n) + " TL"; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }

// Firma adı kısaltma — Türkçe büyük/küçük harf uyumlu
function kisaltFirmaAdi(ad: string): string {
  // Türkçe küçük harfe çevir (JS toLowerCase Türkçe İ/I'yı doğru çevirmez)
  function trLower(s: string): string {
    return s.replace(/İ/g, "i").replace(/I/g, "ı").replace(/Ü/g, "ü")
      .replace(/Ö/g, "ö").replace(/Ş/g, "ş").replace(/Ç/g, "ç")
      .replace(/Ğ/g, "ğ").toLowerCase();
  }

  // Çok kelimeli kısaltmalar (önce bunlar uygulanır)
  const cokKelimeli: [string[], string][] = [
    [["anonim şirketi"], "A.Ş."],
    [["limited şirketi"], "LTD. ŞTİ."],
  ];

  // Tek kelime kısaltmaları: [normalleştirilmiş_halller[], kısaltma]
  const tekKelime: [string[], string][] = [
    [["mühendisliği", "mühendislik"], "MÜH."],
    [["müteahhitliği", "müteahhitlik"], "MÜT."],
    [["müşavirliği", "müşavirlik"], "MÜŞ."],
    [["danışmanlığı", "danışmanlık"], "DAN."],
    [["inşaatı", "inşaat"], "İNŞ."],
    [["ticareti", "ticaret"], "TİC."],
    [["sanayii", "sanayi"], "SAN."],
    [["taahhüdü", "taahhüt"], "TAAH."],
    [["hayvancılığı", "hayvancılık"], "HAYV."],
    [["madenciliği", "madencilik"], "MAD."],
    [["nakliyatı", "nakliyat", "nakliye"], "NAK."],
    [["otomotiv"], "OTO."],
    [["pazarlama"], "PAZ."],
    [["peyzaj"], "PEY."],
    [["yapımcılık"], "YAPIMC."],
    [["elektronik"], "ELKT."],
    [["elektrik"], "ELK."],
    [["mimarlığı", "mimarlık"], "MİM."],
    [["organizasyon"], "ORG."],
    [["tekstil"], "TKST."],
    [["lojistik"], "LOJ."],
    [["turizm"], "TUR."],
    [["kadastro"], "KAD."],
    [["temizliği", "temizlik"], "TEM."],
    [["reklam"], "REK."],
    [["film"], "FLM."],
    [["gıda"], "GIDA"],
    [["harita"], "HRT."],
    [["imar"], "İMAR"],
    [["proje"], "PRJ."],
    [["yapı"], "YAP."],
    [["limited"], "LTD."],
    [["şirketi"], "ŞTİ."],
    [["ithalat"], "İTH."],
    [["ihracat"], "İHR."],
    [["kontrollük"], "KONT."],
    [["taşımacılık", "taşımacılığı"], "TAŞ."],
    [["maden"], "MAD."],
    [["enerji"], "ENR."],
    [["dış"], "DIŞ"],
  ];
  let result = ad;

  // Çok kelimeli kısaltmaları uygula
  for (const [variants, abbr] of cokKelimeli) {
    for (const v of variants) {
      const words = v.split(" ");
      // Orijinal metindeki her kelimenin trLower'ını kontrol et
      const tokens = result.split(/\s+/);
      for (let i = 0; i <= tokens.length - words.length; i++) {
        const slice = tokens.slice(i, i + words.length);
        if (slice.map((t) => trLower(t)).join(" ") === v) {
          tokens.splice(i, words.length, abbr);
          result = tokens.join(" ");
          break;
        }
      }
    }
  }

  // Tek kelime kısaltmaları uygula
  const tokens = result.split(/\s+/);
  const out: string[] = [];
  for (const token of tokens) {
    const lower = trLower(token);
    let replaced = false;
    for (const [variants, abbr] of tekKelime) {
      if (variants.includes(lower)) {
        out.push(abbr);
        replaced = true;
        break;
      }
    }
    if (!replaced) out.push(token);
  }

  return out.join(" ").replace(/\s{2,}/g, " ").trim();
}

// Kendi firması mı kontrol
// SADECE bizim_firma=true olarak işaretli firmalar dikkate alınır → flag yeterli güvenlik.
// Eşleşme normalize edilmiş substring kontrolüyle yapılır (ünvan ekleri/Türkçe karakterler temizli).
function normalizeUnvan(s: string): string {
  return s.toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(ins|insaat|inş|inşaat|taah|taahhut|taahhüt|tic|san|ltd|sti|şti|a\.?s|a\.?ş|as|aş|muh|muhendislik|mühendislik|mad|nak|enr|enrj|enerji|gida|gıda|tarim|tarım|elek|elektrik|otom|otomasyon|nakliye|turz|turizm|sirketi|şirketi|ve)\b/g, " ")
    .replace(/[ığüşöç]/g, (c) => ({ "ı": "i", "ğ": "g", "ü": "u", "ş": "s", "ö": "o", "ç": "c" }[c] ?? c))
    .replace(/\s+/g, " ")
    .trim();
}
function isOwnCompany(firmaAdi: string, firmalar: Firma[]): boolean {
  const adNorm = normalizeUnvan(firmaAdi);
  if (!adNorm) return false;
  // Sadece "bizim_firma" işaretli firmaları dikkate al
  const bizimler = firmalar.filter((f) => f.bizim_firma === true);
  if (bizimler.length === 0) return false;
  return bizimler.some((f) => {
    const fAdNorm = normalizeUnvan(f.firma_adi);
    const fKisaNorm = f.kisa_adi ? normalizeUnvan(f.kisa_adi) : "";
    // Substring eşleşmesi — bizim firma adı veya kısa adı rakipte geçiyorsa eşleşir
    // (flag zaten "bizim" olarak işaretlemiş, geniş eşleşme güvenli)
    if (fAdNorm && (adNorm.includes(fAdNorm) || fAdNorm.includes(adNorm))) return true;
    if (fKisaNorm && (adNorm.includes(fKisaNorm) || fKisaNorm.includes(adNorm))) return true;
    return false;
  });
}

// Geçersizlik kontrol
function checkGecersizlik(metin: string): string | null {
  const lower = metin.toLowerCase();
  if (lower.includes("yasaklı")) return "Yasaklı";
  if (lower.includes("geçersiz")) return "Geçersiz";
  if (lower.includes("elendi")) return "Elendi";
  if (lower.includes("vergi borcu")) return "Vergi borcu var";
  if (lower.includes("sgk borcu")) return "SGK borcu var";
  return null;
}

// Sınır Değer Hesaplama Fonksiyonu
type HesapSonuc = {
  ortalama1: number;   // YM × 0.40 — ön filtre alt sınırı
  ortalama2: number;   // YM × 1.20 — ön filtre üst sınırı
  t1: number;          // Nihai veri setinin aritmetik ortalaması
  standartSapma: number; // Örneklem standart sapması (σ)
  stdSapmaAlt: number; // T1 - σ
  stdSapmaUst: number; // T1 + σ
  t2: number;          // [T1-σ, T1+σ] aralığındaki tekliflerin ortalaması
  c: number;           // T2 / YM (3 hane)
  k: number;           // Ampirik katsayı (3 hane)
  sinirDeger: number;  // (T2 × K) / (C × N) — 2 hane
  gecerliSayi: number; // Nihai veri setindeki teklif sayısı
  makulSayi: number;   // [T1-σ, T1+σ] aralığındaki teklif sayısı
};

function hesaplaSinirDeger(
  teklifler: number[],
  yaklasikMaliyet: number,
  nKatsayisi: number
): HesapSonuc | null {
  if (teklifler.length === 0 || yaklasikMaliyet <= 0) return null;

  // AŞAMA 1: Ön filtre — YM×%40 altı ve YM×%120 üstü dikkate alınmaz
  const ort1 = yaklasikMaliyet * 0.40;
  const ort2 = yaklasikMaliyet * 1.20;
  const gecerli = teklifler.filter((t) => t >= ort1 && t <= ort2);

  if (gecerli.length === 0) {
    return {
      ortalama1: round2(ort1), ortalama2: round2(ort2),
      t1: 0, standartSapma: 0, stdSapmaAlt: 0, stdSapmaUst: 0,
      t2: 0, c: 0, k: 0,
      sinirDeger: round2(ort1),
      gecerliSayi: 0, makulSayi: 0,
    };
  }

  const n = gecerli.length;

  // Tort1 = ΣTn / n  — geçerli tekliflerin aritmetik ortalaması (parasal → 2 hane)
  const t1 = round2(gecerli.reduce((a, b) => a + b, 0) / n);

  // σ = √(Σ(Tn - Tort1)² / (n-1)) — örneklem standart sapması (KİK Tebliği Madde 45.1.1)
  const sigma = round2(
    n > 1
      ? Math.sqrt(gecerli.reduce((sum, t) => sum + (t - t1) ** 2, 0) / (n - 1))
      : 0
  );

  // Tort1 - σ  ve  Tort1 + σ  aralığı (parasal → 2 hane)
  const sapmaAlt = round2(t1 - sigma);
  const sapmaUst = round2(t1 + sigma);

  // Tort2 — [Tort1-σ, Tort1+σ] aralığındaki tekliflerin ortalaması (parasal → 2 hane)
  // Ti: { Ti: (Tort1 - σ ≤ Ti ≤ Tort1 + σ) }
  const makulTeklifler = gecerli.filter((t) => t >= sapmaAlt && t <= sapmaUst);
  const t2 = round2(
    makulTeklifler.length > 0
      ? makulTeklifler.reduce((a, b) => a + b, 0) / makulTeklifler.length
      : t1
  );

  // C = Tort2 / YM  (katsayı → 3 hane)
  const c = round3(t2 / yaklasikMaliyet);

  // K değeri — KİK Tebliği Madde 45.1.1 (katsayı → 3 hane)
  let k: number;
  if (c < 0.60) {
    k = round3(c); // C < 0.60 → K = C
  } else if (c <= 1.00) {
    k = round3((3.2 * c - c * c - 0.60) / (c + 1));
  } else {
    k = round3((c * c - 0.8 * c + 1.4) / (c + 1));
  }

  // SD = (K × Tort2) / (C × N)  (parasal → 2 hane)
  let sinirDeger = round2((k * t2) / (c * nKatsayisi));
  if (sinirDeger < round2(ort1)) sinirDeger = round2(ort1);

  return {
    ortalama1: round2(ort1),
    ortalama2: round2(ort2),
    t1, standartSapma: sigma, stdSapmaAlt: sapmaAlt, stdSapmaUst: sapmaUst,
    t2, c, k, sinirDeger,
    gecerliSayi: gecerli.length,
    makulSayi: makulTeklifler.length,
  };
}

// docx parse (mammoth import dinamik)
type ParsedKatilimci = {
  firmaAdi: string;
  teklif: number;
  yasaklilik: string;
  teminat: string;
  vergiBorcu: string;
  sgkBorcu: string;
  gecersizNedeni: string | null;
  uyarilar: string[];
};

type ParsedData = {
  idareAdi: string;
  isAdi: string;
  ihaleTarihi: string;
  ihaleSaati: string;
  teklifAcmaTarihi: string;
  ihaleKayitNo: string;
  yaklasikMaliyet: number;
  katilimcilar: ParsedKatilimci[];
};

// Hücre metnini temizle
function cleanCell(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

// Tutar parse: "1.234.567,89" → 1234567.89
function parseTutar(text: string): number {
  const match = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)/);
  if (!match) return 0;
  return parseFloat(match[1].replace(/\./g, "").replace(",", ".")) || 0;
}

// Olumsuz durum tespiti (hücre değeri)
// İhale tutanaklarında genelde:
//   Olumlu: "Yasaklı değildir", "Borcu yoktur", "Uygundur", "Yoktur", "Teyit edilmiştir"
//   Olumsuz: "Yasaklıdır", "Borcu vardır", "Uygun değildir", "Var", "Geçersiz"
// Boş hücre = olumlu kabul edilir
function isOlumsuz(val: string): boolean {
  if (!val || !val.trim()) return false;
  const lower = trLowerUtil(val); // Türkçe-safe lowercase

  // Önce olumlu ifadeleri kontrol et — bunlar varsa olumsuz DEĞİLDİR
  const olumluIfadeler = [
    "değildir", "değil", "yoktur", "yok", "uygundur", "uygun",
    "teyit", "onaylanmıştır", "bulunmamaktadır", "bulunmamakta",
    "borcu yoktur", "borcu yok", "yasaklı değildir", "yasaklı değil",
  ];
  for (const olumlu of olumluIfadeler) {
    if (lower.includes(olumlu)) return false;
  }

  // Olumsuz ifadeler
  const olumsuzIfadeler = [
    "yasaklıdır", "yasaklı", "vardır", "var",
    "borcu var", "uygun değildir", "uygun değil",
    "geçersiz", "elendi", "reddedildi",
  ];
  for (const olumsuz of olumsuzIfadeler) {
    if (lower.includes(olumsuz)) return true;
  }

  return false;
}

// Geçersizlik nedeni — SADECE yasaklı ve teminat sorunlu firmalar geçersiz olur
function belirleGecersizlik(yasaklilik: string, teminat: string): string | null {
  const nedenler: string[] = [];
  if (isOlumsuz(yasaklilik)) nedenler.push("Yasaklı");
  if (isOlumsuz(teminat)) nedenler.push("Teminat uygun değil");
  return nedenler.length > 0 ? nedenler.join(", ") : null;
}

// Uyarılar — vergi/SGK borcu hesabı etkilemez, sadece bilgi amaçlı gösterilir
function belirleUyarilar(vergiBorcu: string, sgkBorcu: string): string[] {
  const uyarilar: string[] = [];
  if (isOlumsuz(vergiBorcu)) uyarilar.push("Vergi Borcu Var");
  if (isOlumsuz(sgkBorcu)) uyarilar.push("SGK Borcu Var");
  return uyarilar;
}

// HTML tablosundan satırları ve hücreleri çıkar
function extractTableRows(tableHtml: string): string[][] {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [...tableHtml.matchAll(rowRegex)];
  return rows.map((r) => {
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    return [...r[1].matchAll(cellRegex)].map((m) => cleanCell(m[1]));
  });
}

// Türkçe-safe lowercase (İ→i, I→ı, Ş→ş, vs.)
function trLowerUtil(s: string): string {
  return s.replace(/İ/g, "i").replace(/I/g, "ı").replace(/Ü/g, "ü")
    .replace(/Ö/g, "ö").replace(/Ş/g, "ş").replace(/Ç/g, "ç")
    .replace(/Ğ/g, "ğ").toLowerCase();
}

// İhale bilgi tablosundan anahtar-değer çiftlerini çıkar
function parseIhaleBilgiTablosu(rows: string[][]): { idareAdi: string; isAdi: string; ihaleKayitNo: string; ihaleTarihi: string; ihaleSaati: string; teklifAcmaTarihi: string; yaklasikMaliyet: number } {
  let idareAdi = "", isAdi = "", ihaleKayitNo = "", ihaleTarihi = "", ihaleSaati = "", teklifAcmaTarihi = "";
  let yaklasikMaliyet = 0;

  for (const cells of rows) {
    for (let ci = 0; ci < cells.length; ci++) {
      const label = trLowerUtil(cells[ci]);
      const val = cells[ci + 1] ?? "";

      // İdare adı
      if ((label.includes("idare") && label.includes("ad")) || label.includes("ihaleyi yapan")) {
        if (val) idareAdi = val.trim().replace(/^[:\s]+/, "");
      }
      // İhale konusu / iş adı
      if (label.includes("ihale") && (label.includes("konusu") || label.includes("adı"))) {
        if (val) isAdi = val.trim().replace(/^[:\s]+/, "");
      }
      // İKN
      if (label.includes("ikn") || label.includes("ihale kayıt") || label.includes("kayıt no") || label.includes("kayıt numarası")) {
        const iknVal = val || cells[ci];
        const iknMatch = iknVal.match(/([\d]{4}\s*\/\s*[\d]+|[\d\/\-]{5,})/);
        if (iknMatch) ihaleKayitNo = iknMatch[1].trim();
      }
      // İhale tarihi — "İhale Tarih ve Saati", "İhale Tarihi"
      if (label.includes("ihale") && label.includes("tarih") && !label.includes("teklif") && !label.includes("açıl")) {
        const tarihStr = val || cells[ci];
        const tarihMatch = tarihStr.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{2,4})/);
        if (tarihMatch) {
          const [, g, a, y] = tarihMatch;
          ihaleTarihi = `${y.length === 4 ? y : "20" + y}-${a.padStart(2, "0")}-${g.padStart(2, "0")}`;
        }
        // Saat bilgisi
        const saatMatch = tarihStr.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (saatMatch) ihaleSaati = saatMatch[1];
      }
      // Tekliflerin açıldığı tarih ve saat
      if (label.includes("teklif") && (label.includes("açıl") || label.includes("açma"))) {
        const tarihStr = val || cells[ci];
        const tarihMatch = tarihStr.match(/(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{2,4})/);
        const saatMatch = tarihStr.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (tarihMatch) {
          const [, g, a, y] = tarihMatch;
          teklifAcmaTarihi = `${g.padStart(2, "0")}.${a.padStart(2, "0")}.${y.length === 4 ? y : "20" + y}`;
          if (saatMatch) teklifAcmaTarihi += " " + saatMatch[1];
        }
      }
      // Yaklaşık maliyet
      if (label.includes("yaklaşık") && (label.includes("maliyet") || label.includes("bedel"))) {
        const ymStr = val || cells[ci];
        const ym = parseTutar(ymStr);
        if (ym > 0) yaklasikMaliyet = ym;
      }
    }
    // Hücrelerde satır içi arama (label ve değer aynı hücrede olabilir)
    for (const cell of cells) {
      const cellLower = trLowerUtil(cell);
      if (!yaklasikMaliyet && cellLower.includes("yaklaşık") && cellLower.includes("maliyet")) {
        const ym = parseTutar(cell);
        if (ym > 0) yaklasikMaliyet = ym;
      }
      if (!ihaleKayitNo) {
        const iknMatch = cell.match(/(20\d{2}\s*\/\s*\d{3,})/);
        if (iknMatch) ihaleKayitNo = iknMatch[1].trim();
      }
    }
  }

  return { idareAdi, isAdi, ihaleKayitNo, ihaleTarihi, ihaleSaati, teklifAcmaTarihi, yaklasikMaliyet };
}

// Katılımcı tablosunu parse et — yaklaşık maliyet ayrı döndürülür
function parseKatilimciTablosu(rows: string[][]): { katilimcilar: ParsedKatilimci[]; yaklasikMaliyet: number } {
  const katilimcilar: ParsedKatilimci[] = [];
  let yaklasikMaliyet = 0;
  if (rows.length < 2) return { katilimcilar, yaklasikMaliyet };

  // Başlık satırını bul: "istekli", "firma", "teklif" gibi kelimeler aranır
  let headerIdx = -1;
  let firmaCol = -1, teklifCol = -1, yasaklilikCol = -1, teminatCol = -1, vergiCol = -1, sgkCol = -1;

  for (let ri = 0; ri < Math.min(rows.length, 3); ri++) {
    const headerCells = rows[ri].map((c) => trLowerUtil(c));
    const hasFirma = headerCells.findIndex((c) => c.includes("istekli") || c.includes("firma") || (c.includes("ad") && c.includes("soyad")));
    const hasTeklif = headerCells.findIndex((c) => c.includes("teklif") || c.includes("tutar") || c.includes("bedel") || c.includes("fiyat"));

    if (hasFirma >= 0 && hasTeklif >= 0) {
      headerIdx = ri;
      firmaCol = hasFirma;
      teklifCol = hasTeklif;
      // Durum sütunlarını bul
      yasaklilikCol = headerCells.findIndex((c) => c.includes("yasaklı") || c.includes("yasaklılık"));
      teminatCol = headerCells.findIndex((c) => c.includes("teminat"));
      vergiCol = headerCells.findIndex((c) => c.includes("vergi"));
      sgkCol = headerCells.findIndex((c) => c.includes("sgk") || c.includes("sosyal güvenlik") || c.includes("sigorta"));
      break;
    }
  }

  // Başlık bulunamadıysa varsayılan sütun sırası kullan
  if (headerIdx === -1) {
    headerIdx = 0;
    // İlk satır başlık gibi görünüyorsa atla
    const firstRow = trLowerUtil(rows[0].join(" "));
    if (firstRow.includes("no") || firstRow.includes("sıra") || firstRow.includes("istekli")) {
      headerIdx = 0;
    }
    // Varsayılan: sıra | firma | teklif | yasaklılık | teminat | vergi | sgk
    const colCount = rows[0]?.length ?? 0;
    if (colCount >= 2) {
      firmaCol = colCount >= 3 ? 1 : 0; // İlk sütun sıra no ise 1, değilse 0
      teklifCol = firmaCol + 1;
      if (colCount >= 4) yasaklilikCol = teklifCol + 1;
      if (colCount >= 5) teminatCol = teklifCol + 2;
      if (colCount >= 6) vergiCol = teklifCol + 3;
      if (colCount >= 7) sgkCol = teklifCol + 4;
    }
  }

  // Debug: sütun eşleştirme sonuçları
  console.log("=== KATILIMCI TABLO DEBUG ===");
  console.log("Satır sayısı:", rows.length, "| Sütun sayısı:", rows[0]?.length);
  console.log("Başlık satırı:", headerIdx, "| Başlık hücreleri:", rows[headerIdx]?.join(" | "));
  console.log("Sütun eşleştirme → firma:", firmaCol, "teklif:", teklifCol, "yasaklılık:", yasaklilikCol, "teminat:", teminatCol, "vergi:", vergiCol, "sgk:", sgkCol);
  if (rows.length > headerIdx + 1) {
    console.log("İlk veri satırı hücreleri:", rows[headerIdx + 1]?.join(" | "));
  }

  // Veri satırlarını oku
  for (let ri = headerIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri];
    if (cells.length < 2) continue;

    const firmaAdi = (cells[firmaCol] ?? "").trim();
    if (!firmaAdi || firmaAdi.length < 2) continue;
    // Sıra numarasıysa atla
    if (/^\d+$/.test(firmaAdi)) continue;
    // İhale bilgi satırlarını atla (yaklaşık maliyet, toplam vs.)
    // Türkçe İ/I sorunu: JS toLowerCase() Türkçe harfleri doğru çevirmez, trLower kullan
    const rowTextLower = cells.join(" ").replace(/İ/g, "i").replace(/I/g, "ı").replace(/Ü/g, "ü")
      .replace(/Ö/g, "ö").replace(/Ş/g, "ş").replace(/Ç/g, "ç").replace(/Ğ/g, "ğ").toLowerCase();
    if (rowTextLower.includes("yaklaşık maliyet") || rowTextLower.includes("yaklaşık bedel")
      || rowTextLower.includes("yaklasık maliyet") || rowTextLower.includes("yaklasik maliyet")) {
      continue;
    }
    if (rowTextLower.includes("toplam") || rowTextLower.includes("ihale komisyon")) continue;

    const teklif = parseTutar(cells[teklifCol] ?? "");
    if (teklif <= 0) continue;

    // Durum sütunlarını oku — sütun indeksi varsa kullan, yoksa tüm hücreleri tara
    let yasaklilik = "", teminat = "", vergiBorcu = "", sgkBorcu = "";

    if (yasaklilikCol >= 0 && yasaklilikCol < cells.length) yasaklilik = cells[yasaklilikCol] ?? "";
    if (teminatCol >= 0 && teminatCol < cells.length) teminat = cells[teminatCol] ?? "";
    if (vergiCol >= 0 && vergiCol < cells.length) vergiBorcu = cells[vergiCol] ?? "";
    if (sgkCol >= 0 && sgkCol < cells.length) sgkBorcu = cells[sgkCol] ?? "";

    // Sütun indeksleri veri satırında yoksa (colspan/merged cells durumu)
    // Firma ve teklif dışındaki TÜM hücreleri tara
    if (!yasaklilik && !teminat && !vergiBorcu && !sgkBorcu && cells.length > 2) {
      for (let ci = 0; ci < cells.length; ci++) {
        if (ci === firmaCol || ci === teklifCol) continue;
        const cellLower = trLowerUtil(cells[ci]);
        if (cellLower.includes("yasaklı") && !yasaklilik) yasaklilik = cells[ci];
        else if (cellLower.includes("teminat") && !teminat) teminat = cells[ci];
        else if (cellLower.includes("vergi") && !vergiBorcu) vergiBorcu = cells[ci];
        else if ((cellLower.includes("sgk") || cellLower.includes("sigorta") || cellLower.includes("sosyal")) && !sgkBorcu) sgkBorcu = cells[ci];
        else if (isOlumsuz(cells[ci])) {
          // Hangi sütun olduğu belli değilse genel kontrol
          if (!vergiBorcu && cellLower.includes("borcu")) vergiBorcu = cells[ci];
        }
      }
    }

    const gecersizNedeni = belirleGecersizlik(yasaklilik, teminat);
    const uyarilar = belirleUyarilar(vergiBorcu, sgkBorcu);

    katilimcilar.push({
      firmaAdi: firmaAdi.replace(/^\d+[\.\)\-\s]+/, "").trim(),
      teklif,
      yasaklilik,
      teminat,
      vergiBorcu,
      sgkBorcu,
      gecersizNedeni,
      uyarilar,
    });
  }

  return { katilimcilar, yaklasikMaliyet };
}

async function parseDocx(file: File): Promise<ParsedData> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();

  // Hem raw text (yedek) hem HTML (tablolar için) al
  const [textResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer }),
    mammoth.convertToHtml({ arrayBuffer }),
  ]);
  const text = textResult.value;
  const html = htmlResult.value;

  // HTML'den tüm tabloları çıkar
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tableMatches = [...html.matchAll(tableRegex)];
  const allTables = tableMatches.map((m) => extractTableRows(m[1]));

  let idareAdi = "", isAdi = "", ihaleKayitNo = "", ihaleTarihi = "", ihaleSaati = "", teklifAcmaTarihi = "";
  let yaklasikMaliyet = 0;
  let katilimcilar: ParsedKatilimci[] = [];

  if (allTables.length >= 2) {
    // İlk tablo: İhale bilgileri
    const bilgi = parseIhaleBilgiTablosu(allTables[0]);
    idareAdi = bilgi.idareAdi;
    isAdi = bilgi.isAdi;
    ihaleKayitNo = bilgi.ihaleKayitNo;
    ihaleTarihi = bilgi.ihaleTarihi;
    ihaleSaati = bilgi.ihaleSaati;
    teklifAcmaTarihi = bilgi.teklifAcmaTarihi;
    yaklasikMaliyet = bilgi.yaklasikMaliyet;

    // İkinci tablo: Katılımcılar (en alttaki yaklaşık maliyet satırı ayrı çekilir)
    const parsed2 = parseKatilimciTablosu(allTables[1]);
    katilimcilar = parsed2.katilimcilar;
    // Katılımcı tablosundaki yaklaşık maliyet, bilgi tablosundan gelemediyse kullan
    if (!yaklasikMaliyet && parsed2.yaklasikMaliyet > 0) yaklasikMaliyet = parsed2.yaklasikMaliyet;
    // Bilgi tablosu yaklaşık maliyeti yoksa katılımcı tablosundakini al
    if (yaklasikMaliyet === 0 && parsed2.yaklasikMaliyet > 0) yaklasikMaliyet = parsed2.yaklasikMaliyet;

    // İkinci tabloda bulunamadıysa sonraki tabloları dene
    if (katilimcilar.length === 0) {
      for (let ti = 2; ti < allTables.length; ti++) {
        const parsedN = parseKatilimciTablosu(allTables[ti]);
        katilimcilar = parsedN.katilimcilar;
        if (!yaklasikMaliyet && parsedN.yaklasikMaliyet > 0) yaklasikMaliyet = parsedN.yaklasikMaliyet;
        if (katilimcilar.length > 0) break;
      }
    }
  } else if (allTables.length === 1) {
    // Tek tablo varsa: katılımcı tablosu olarak dene
    const parsed1 = parseKatilimciTablosu(allTables[0]);
    katilimcilar = parsed1.katilimcilar;
    if (parsed1.yaklasikMaliyet > 0) yaklasikMaliyet = parsed1.yaklasikMaliyet;
  }

  // Tablolardan ihale bilgileri gelemediyse raw text'ten dene
  if (!idareAdi) {
    const m = text.match(/(?:İdare(?:\s*(?:Adı|ad[ıi]))?|İhaleyi\s*Yapan\s*İdare)\s*[:\-]?\s*(.+)/i);
    idareAdi = (m?.[1]?.trim().split("\n")[0] ?? "").replace(/^[:\s]+/, "");
  }
  if (!isAdi) {
    const m = text.match(/(?:İhale\s*Konusu|İşin\s*Adı)\s*[:\-]?\s*(.+)/i);
    isAdi = (m?.[1]?.trim().split("\n")[0] ?? "").replace(/^[:\s]+/, "");
  }
  if (!ihaleKayitNo) {
    const m = text.match(/(?:İKN|İhale\s*Kayıt\s*(?:No|Numarası))\s*[:\-]?\s*([\d\/\-\s]+)/i);
    ihaleKayitNo = m?.[1]?.trim() ?? "";
  }
  if (!ihaleTarihi) {
    const m = text.match(/İhale\s*Tarihi\s*[:\-]?\s*([\d\.\/\-]+)/i);
    if (m?.[1]) {
      const parts = m[1].split(/[\.\/\-]/);
      if (parts.length === 3) {
        const [g, a, y] = parts;
        ihaleTarihi = `${y.length === 4 ? y : "20" + y}-${a.padStart(2, "0")}-${g.padStart(2, "0")}`;
      }
    }
  }
  if (!yaklasikMaliyet) {
    const m = text.match(/Yaklaşık\s*Maliyet\s*[:\-]?\s*([\d\.\s,]+)/i);
    if (m?.[1]) {
      yaklasikMaliyet = parseFloat(m[1].replace(/\s/g, "").replace(/\./g, "").replace(",", ".")) || 0;
    }
  }

  // Hiçbir tablodan katılımcı bulunamadıysa raw text fallback
  if (katilimcilar.length === 0) {
    const tutarRx = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2}))/g;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const matches = [...trimmed.matchAll(tutarRx)];
      if (matches.length > 0) {
        const last = matches[matches.length - 1][1];
        const val = parseFloat(last.replace(/\./g, "").replace(",", "."));
        if (val >= 10000 && val <= 100000000000) {
          const idx = trimmed.lastIndexOf(last);
          const fa = trimmed.substring(0, idx).replace(/^\d+[\.\)\-\s]+/, "").replace(/[\-\|\t:]+$/, "").trim();
          if (fa.length >= 3) {
            katilimcilar.push({
              firmaAdi: fa, teklif: val,
              uyarilar: [], yasaklilik: "", teminat: "", vergiBorcu: "", sgkBorcu: "",
              gecersizNedeni: checkGecersizlik(trimmed),
            });
          }
        }
      }
    }
  }

  return { idareAdi, isAdi, ihaleTarihi, ihaleSaati, teklifAcmaTarihi, ihaleKayitNo, yaklasikMaliyet, katilimcilar };
}

// İş Grubu tipi
type IsGrubu = { id: string; deger: string; kisa_ad: string | null; sira: number; aktif: boolean };

export default function IhalePage() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  const yEkle = hasPermission("ihale", "ekle");
  const yDuzenle = hasPermission("ihale", "duzenle");
  const ySil = hasPermission("ihale", "sil");

  const [loading, setLoading] = useState(true);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [isGruplari, setIsGruplari] = useState<IsGrubu[]>([]);
  const [gecmisIhaleler, setGecmisIhaleler] = useState<Ihale[]>([]);

  // Ana sekme
  const [aktifTab, setAktifTab] = useState<"hesaplama" | "gecmis">("hesaplama");

  // Hesaplama state
  const [seciliIsGrubu, setSeciliIsGrubu] = useState("");
  const [nKatsayisi, setNKatsayisi] = useState("1,00");
  const [dosya, setDosya] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Analiz sonucu
  const [currentIhaleId, setCurrentIhaleId] = useState<string | null>(null);
  // Mevcut kaydın orijinal mi düzenlenmiş mi olduğunu takip eder.
  // true → orijinal (düzenleme yapılırsa YENİ kayıt oluşur)
  // false → düzenlenmiş veya boş (aynı kayıt üzerine yazılır)
  const [currentIhaleIsOriginal, setCurrentIhaleIsOriginal] = useState<boolean>(false);
  const [idareAdi, setIdareAdi] = useState("");
  const [isAdi, setIsAdi] = useState("");
  const [ihaleKayitNo, setIhaleKayitNo] = useState("");
  const [ihaleTarihi, setIhaleTarihi] = useState("");
  const [ihaleSaati, setIhaleSaati] = useState("");
  const [teklifAcmaTarihi, setTeklifAcmaTarihi] = useState("");
  const [yaklasikMaliyet, setYaklasikMaliyet] = useState("");
  const [katilimcilar, setKatilimcilar] = useState<{
    firmaAdi: string;
    teklif: number;
    durum: "gecerli" | "gecersiz" | "sinir_alti";
    gecersizNedeni: string | null;
    uyarilar: string[];
    yasaklilik: string;
    teminat: string;
    vergiBorcu: string;
    sgkBorcu: string;
    isOwn: boolean;
    isManual: boolean;
    isEdited: boolean;
    eskiTutar: number | null;
  }[]>([]);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [analizYapildi, setAnalizYapildi] = useState(false);

  // İnline edit
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editTutar, setEditTutar] = useState("");

  // Yeni katılımcı dialog
  const [yeniKatOpen, setYeniKatOpen] = useState(false);
  const [yeniKatFirma, setYeniKatFirma] = useState("");
  const [yeniKatTutar, setYeniKatTutar] = useState("");

  // İş grubu dialog
  const [igDialogOpen, setIgDialogOpen] = useState(false);
  const [igEditId, setIgEditId] = useState<string | null>(null);
  const [igAd, setIgAd] = useState("");
  const [igN, setIgN] = useState("1,00");
  const [igSilOnay, setIgSilOnay] = useState<string | null>(null);

  // Geçmiş filtre
  const [gecmisArama, setGecmisArama] = useState("");
  const [hesapDetayAcik, setHesapDetayAcik] = useState(false);

  // Silme onayı
  const [silOnay, setSilOnay] = useState<string | null>(null);

  // Veri yükleme
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fData, tData, iData] = await Promise.all([
        getFirmalar().catch(() => []),
        getTumTanimlamalar().catch(() => []),
        getIhaleler().catch(() => []),
      ]);
      setFirmalar(fData as Firma[]);
      const igList = (tData as { id: string; kategori: string; deger: string; kisa_ad: string | null; sira: number; aktif: boolean }[])
        .filter((t) => t.kategori === "ihale_is_grubu")
        .map((t) => ({ id: t.id, deger: t.deger, kisa_ad: t.kisa_ad, sira: t.sira, aktif: t.aktif }));
      setIsGruplari(igList);
      setGecmisIhaleler(iData);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("ihale tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 10000 });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Düzenleme yapıldığında otomatik kaydet (debounce 1.5s)
  useEffect(() => {
    if (!hasManualEdits || !analizYapildi) return;
    const timer = setTimeout(() => {
      autoSave(null, katilimcilar).catch((err) => console.error("Otomatik kayıt hatası:", err));
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasManualEdits, idareAdi, isAdi, ihaleKayitNo, ihaleTarihi, yaklasikMaliyet, seciliIsGrubu, nKatsayisi, katilimcilar]);

  // Hesap sonucu (otomatik yeniden hesapla)
  const ym = parseParaInput(yaklasikMaliyet);
  const nVal = parseFloat(nKatsayisi.replace(",", ".")) || 1;

  const hesap = useMemo(() => {
    const gecerliTeklifler = katilimcilar
      .filter((k) => k.durum === "gecerli")
      .map((k) => k.teklif);
    const sonuc = hesaplaSinirDeger(gecerliTeklifler, ym, nVal);
    // Debug: konsola detaylı bilgi yaz
    if (sonuc) {
      const ort1 = ym * 0.40;
      const ort2 = ym * 1.20;
      const aralikta = gecerliTeklifler.filter((t) => t >= ort1 && t <= ort2);
      console.log("=== SINIR DEĞER DEBUG ===");
      console.log("Toplam geçerli teklif:", gecerliTeklifler.length);
      console.log("YM:", ym, "| Ort1 (40%):", ort1, "| Ort2 (120%):", ort2);
      console.log("[40%-120%] aralığındaki teklifler (" + aralikta.length + "):", aralikta.sort((a, b) => a - b).map((t) => t.toLocaleString("tr-TR")));
      console.log("T1:", sonuc.t1, "| σ:", sonuc.standartSapma, "| T2:", sonuc.t2);
      console.log("SapmaAlt:", sonuc.stdSapmaAlt, "| SapmaÜst:", sonuc.stdSapmaUst);
      console.log("C:", sonuc.c, "| K:", sonuc.k, "| SD:", sonuc.sinirDeger);
    }
    return sonuc;
  }, [katilimcilar, ym, nVal]);

  // Sınır altı otomatik işaretle + sırala (immutable)
  const siraliKatilimcilar = useMemo(() => {
    const sorted = [...katilimcilar]
      .map((k) => ({ ...k })) // deep copy — orijinal state'i mutate etme
      .sort((a, b) => a.teklif - b.teklif);
    if (hesap) {
      for (const k of sorted) {
        if (k.durum === "gecerli" && k.teklif < hesap.sinirDeger) {
          k.durum = "sinir_alti";
        } else if (k.durum === "sinir_alti" && k.teklif >= hesap.sinirDeger) {
          k.durum = "gecerli";
        }
      }
    }
    return sorted;
  }, [katilimcilar, hesap]);

  // Muhtemel kazanan: sınır değerin hemen üstündeki geçerli teklif
  const muhtemelKazanan = useMemo(() => {
    if (!hesap) return null;
    const gecerliler = siraliKatilimcilar.filter((k) => k.durum === "gecerli" && k.teklif >= hesap.sinirDeger);
    return gecerliler.length > 0 ? gecerliler[0] : null;
  }, [hesap, siraliKatilimcilar]);

  // Tenzilat hesapla
  function tenzilat(teklif: number): number {
    if (ym <= 0) return 0;
    return round2(((ym - teklif) / ym) * 100);
  }

  // İş grubu seçilince N otomatik dol
  function isGrubuSec(val: string) {
    setSeciliIsGrubu(val);
    const ig = isGruplari.find((g) => g.deger === val);
    if (ig?.kisa_ad) {
      setNKatsayisi(ig.kisa_ad.replace(".", ","));
    }
  }

  // Dosya analiz et
  async function analizEtWithFile(file: File) {
    if (!file) return;
    setAnalyzing(true);
    try {
      const parsed = await parseDocx(file);
      setIdareAdi(parsed.idareAdi);
      setIsAdi(parsed.isAdi);
      setIhaleKayitNo(parsed.ihaleKayitNo);
      setIhaleTarihi(parsed.ihaleTarihi);
      setIhaleSaati(parsed.ihaleSaati);
      setTeklifAcmaTarihi(parsed.teklifAcmaTarihi);
      if (parsed.yaklasikMaliyet > 0) {
        setYaklasikMaliyet(formatParaInput(parsed.yaklasikMaliyet.toFixed(2).replace(".", ",")));
      }

      const yeniKat = parsed.katilimcilar.map((k) => ({
        firmaAdi: kisaltFirmaAdi(k.firmaAdi),
        teklif: k.teklif,
        durum: k.gecersizNedeni ? "gecersiz" as const : "gecerli" as const,
        gecersizNedeni: k.gecersizNedeni,
        uyarilar: k.uyarilar,
        yasaklilik: k.yasaklilik,
        teminat: k.teminat,
        vergiBorcu: k.vergiBorcu,
        sgkBorcu: k.sgkBorcu,
        isOwn: isOwnCompany(k.firmaAdi, firmalar),
        isManual: false,
        isEdited: false,
        eskiTutar: null,
      }));
      setKatilimcilar(yeniKat);
      setHasManualEdits(false);
      setAnalizYapildi(true);
      setCurrentIhaleId(null);
      setCurrentIhaleIsOriginal(true); // Dosyadan okunan kayıt orijinaldir

      toast.success(`${yeniKat.length} firma bulundu.`);

      // Otomatik kaydet
      await autoSave(parsed, yeniKat);
    } catch (err) {
      console.error(err);
      toast.error(`Dosya okunamadı: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  // Otomatik kaydet
  async function autoSave(
    parsed: ParsedData | null,
    kat: typeof katilimcilar,
  ) {
    try {
      const ymVal = parsed ? parsed.yaklasikMaliyet : parseParaInput(yaklasikMaliyet);
      const gecerliTeklifler = kat.filter((k) => k.durum === "gecerli").map((k) => k.teklif);
      const h = hesaplaSinirDeger(gecerliTeklifler, ymVal, nVal);
      const mk = (() => {
        if (!h) return null;
        const sorted = [...kat].sort((a, b) => a.teklif - b.teklif);
        const g = sorted.filter((k) => k.durum === "gecerli" && k.teklif >= h.sinirDeger);
        return g[0]?.firmaAdi ?? null;
      })();

      const ihaleData = {
        idare_adi: parsed?.idareAdi ?? idareAdi,
        is_adi: (parsed?.isAdi ?? isAdi) || null,
        ihale_kayit_no: parsed?.ihaleKayitNo ?? ihaleKayitNo,
        ihale_tarihi: (parsed?.ihaleTarihi ?? ihaleTarihi) || null,
        yaklasik_maliyet: ymVal || null,
        is_grubu: seciliIsGrubu || null,
        n_katsayisi: nVal,
        sinir_deger: h?.sinirDeger ?? null,
        t1: h?.t1 ?? null,
        t2: h?.t2 ?? null,
        c_degeri: h?.c ?? null,
        k_degeri: h?.k ?? null,
        standart_sapma: h?.standartSapma ?? null,
        muhtemel_kazanan: mk,
        has_manual_edits: hasManualEdits,
        created_by: kullanici?.id ?? null,
      };

      let ihaleId = currentIhaleId;
      // Orijinal bir kayıt üzerinde ilk kez düzenleme yapılıyorsa,
      // orijinali koru ve düzenlemeyi YENİ kayıt olarak oluştur.
      if (ihaleId && hasManualEdits && currentIhaleIsOriginal) {
        ihaleId = null;
      }
      if (ihaleId) {
        await updateIhale(ihaleId, ihaleData);
      } else {
        const saved = await insertIhale(ihaleData);
        ihaleId = saved.id;
        setCurrentIhaleId(saved.id);
        // Yeni oluşturulan kayıt düzenlenmişse bu artık "düzenlenmiş" kayıttır,
        // sonraki düzenlemeler aynı kaydı günceller.
        setCurrentIhaleIsOriginal(!hasManualEdits);
      }

      // Katılımcıları kaydet
      await deleteKatilimcilar(ihaleId);
      const katRows = kat.map((k, i) => ({
        firma_adi: k.firmaAdi,
        teklif_tutari: k.teklif,
        durum: k.durum,
        gecersizlik_nedeni: k.gecersizNedeni,
        tenzilat: ymVal > 0 ? round2(((ymVal - k.teklif) / ymVal) * 100) : null,
        is_own_company: k.isOwn,
        is_manual: k.isManual,
        sira: i + 1,
      }));
      await insertKatilimcilar(ihaleId, katRows);
      // Geçmiş listeyi güncelle
      const fresh = await getIhaleler().catch(() => []);
      setGecmisIhaleler(fresh);
    } catch (err) {
      console.error("Otomatik kaydetme hatası:", err);
    }
  }

  // Inline tutar düzenleme
  function startEdit(idx: number) {
    setEditIdx(idx);
    setEditTutar(formatParaInput(String(Math.round(siraliKatilimcilar[idx].teklif))));
  }
  function saveEdit() {
    if (editIdx === null) return;
    const val = parseParaInput(editTutar);
    if (val <= 0) { toast.error("Geçerli tutar girin."); return; }
    const target = siraliKatilimcilar[editIdx];
    // Orijinal katılımcılar listesinde bul
    const updated = katilimcilar.map((k) => {
      if (k.firmaAdi === target.firmaAdi && Math.abs(k.teklif - target.teklif) < 0.01) {
        return {
          ...k,
          eskiTutar: k.isEdited ? k.eskiTutar : k.teklif,
          teklif: val,
          isEdited: true,
        };
      }
      return k;
    });
    setKatilimcilar(updated);
    setHasManualEdits(true);
    setEditIdx(null);
    setTimeout(() => autoSave(null, updated), 500);
  }

  // Katılımcı sil
  function katilimciSil(idx: number) {
    const target = siraliKatilimcilar[idx];
    const updated = katilimcilar.filter((k) => !(k.firmaAdi === target.firmaAdi && k.teklif === target.teklif));
    setKatilimcilar(updated);
    setHasManualEdits(true);
    setTimeout(() => autoSave(null, updated), 500);
  }

  // Yeni katılımcı ekle
  function yeniKatilimciEkle() {
    if (!yeniKatFirma.trim()) { toast.error("Firma adı girin."); return; }
    const tutar = parseParaInput(yeniKatTutar);
    if (tutar <= 0) { toast.error("Geçerli tutar girin."); return; }
    const updated = [...katilimcilar, {
      firmaAdi: kisaltFirmaAdi(yeniKatFirma.trim()),
      teklif: tutar,
      durum: "gecerli" as const,
      gecersizNedeni: null,
      uyarilar: [], yasaklilik: "", teminat: "", vergiBorcu: "", sgkBorcu: "",
      isOwn: isOwnCompany(yeniKatFirma.trim(), firmalar),
      isManual: true,
      isEdited: false,
      eskiTutar: null,
    }];
    setKatilimcilar(updated);
    setHasManualEdits(true);
    setAnalizYapildi(true);
    setYeniKatOpen(false);
    setYeniKatFirma("");
    setYeniKatTutar("");
    setTimeout(() => autoSave(null, updated), 500);
  }

  // Geçmiş ihaleyi yükle
  async function gecmisYukle(ihale: Ihale) {
    try {
      const kat = await getKatilimcilar(ihale.id);
      // Zaten düzenlenmiş bir kayıt ise aynı kaydın üzerine yazılır (yeni düzenlenmiş kopya oluşmaz).
      // Orijinal kayıt ise düzenlendiğinde YENİ bir düzenlenmiş kayıt oluşur, orijinal korunur.
      const zatenDuzenlendi = ihale.has_manual_edits ?? false;
      setCurrentIhaleId(ihale.id);
      setCurrentIhaleIsOriginal(!zatenDuzenlendi);
      setIdareAdi(ihale.idare_adi ?? "");
      setIsAdi(ihale.is_adi ?? "");
      setIhaleKayitNo(ihale.ihale_kayit_no ?? "");
      setIhaleTarihi(ihale.ihale_tarihi ?? "");
      setIhaleSaati("");
      setTeklifAcmaTarihi("");
      if (ihale.yaklasik_maliyet) {
        setYaklasikMaliyet(formatParaInput(ihale.yaklasik_maliyet.toFixed(2).replace(".", ",")));
      }
      setSeciliIsGrubu(ihale.is_grubu ?? "");
      setNKatsayisi(String(ihale.n_katsayisi).replace(".", ","));
      setHasManualEdits(zatenDuzenlendi);
      setKatilimcilar(kat.map((k) => ({
        firmaAdi: k.firma_adi,
        teklif: k.teklif_tutari,
        durum: k.durum,
        gecersizNedeni: k.gecersizlik_nedeni,
        uyarilar: [], yasaklilik: "", teminat: "", vergiBorcu: "", sgkBorcu: "",
        // Eski kayıtlarda is_own_company yanlış hesaplanmış olabilir.
        // Her yüklemede güncel firmalar listesine + güncel mantığa göre yeniden hesapla.
        isOwn: isOwnCompany(k.firma_adi, firmalar),
        isManual: k.is_manual,
        isEdited: false,
        eskiTutar: null,
      })));
      setAnalizYapildi(true);
      setAktifTab("hesaplama");
      toast.success(zatenDuzenlendi
        ? "Düzenlenmiş ihale yüklendi. Değişiklikler aynı kayıt üzerine yazılır."
        : "İhale yüklendi. Değişiklik yaparsanız yeni kayıt olarak kaydedilir.");
    } catch (err) {
      toast.error(`Yükleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Geçmiş ihale sil
  async function gecmisSil() {
    if (!silOnay) return;
    try {
      await deleteIhale(silOnay);
      if (currentIhaleId === silOnay) {
        setCurrentIhaleId(null);
        setAnalizYapildi(false);
        setKatilimcilar([]);
      }
      const fresh = await getIhaleler().catch(() => []);
      setGecmisIhaleler(fresh);
      toast.success("İhale silindi.");
      setSilOnay(null);
    } catch (err) {
      toast.error(`Silme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // İş grubu kaydet
  async function igKaydet() {
    if (!igAd.trim()) { toast.error("İş grubu adı girin."); return; }
    try {
      const nStr = igN.replace(",", ".");
      if (igEditId) {
        await updateTanimlama(igEditId, { deger: igAd.trim(), kisa_ad: nStr });
      } else {
        const maxSira = isGruplari.length > 0 ? Math.max(...isGruplari.map((g) => g.sira)) + 1 : 1;
        await createTanimlama({
          kategori: "ihale_is_grubu",
          sekme: "ihale",
          deger: igAd.trim(),
          kisa_ad: nStr,
          sira: maxSira,
          aktif: true,
        });
      }
      await loadAll();
      toast.success(igEditId ? "İş grubu güncellendi." : "İş grubu eklendi.");
      setIgDialogOpen(false);
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // İş grubu sil
  async function igSil() {
    if (!igSilOnay) return;
    try {
      await deleteTanimlama(igSilOnay);
      await loadAll();
      toast.success("İş grubu silindi.");
      setIgSilOnay(null);
    } catch (err) {
      toast.error(`Silme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // PDF Export
  function exportPDF() {
    if (!hesap) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    // Üst bilgi tablosu — 4 sütunlu düzen
    const ihaleTarihStr = ihaleTarihi ? ihaleTarihi.split("-").reverse().join(".") : "-";
    const duzenlendi = hasManualEdits ? "DUZENLENDI" : "";

    autoTable(doc, {
      startY: 10,
      head: [[
        { content: "", styles: {} },
        { content: "", styles: {} },
        { content: "", styles: {} },
        { content: duzenlendi, styles: { halign: "right" } },
      ]],
      body: [
        // İşin Adı — tek satır, 4 sütun birleşik
        [{ content: tr("Isin Adi:  ") + tr(isAdi || "-"), colSpan: 4, styles: { fontStyle: "bold", fontSize: 10 } }],
        // Yan yana 2'li satırlar
        [{ content: tr("Idare Adi"), styles: { fontStyle: "bold" } }, tr(idareAdi || "-"), { content: "IKN", styles: { fontStyle: "bold" } }, tr(ihaleKayitNo || "-")],
        [{ content: tr("Ihale Tarihi"), styles: { fontStyle: "bold" } }, `${ihaleTarihStr}${ihaleSaati ? " " + ihaleSaati : ""}`, { content: tr("Is Grubu"), styles: { fontStyle: "bold" } }, tr(seciliIsGrubu || "-")],
        [{ content: tr("Yaklasik Maliyet"), styles: { fontStyle: "bold" } }, formatTL(ym), { content: tr("Sinir Deger"), styles: { fontStyle: "bold" } }, formatTL(hesap.sinirDeger)],
        [{ content: "N Katsayisi", styles: { fontStyle: "bold" } }, nVal.toFixed(2), "", ""],
        // Muhtemel Kazanan — tek satır
        [{ content: tr("Muhtemel Kazanan:  ") + tr(muhtemelKazanan?.firmaAdi ?? "-") + (muhtemelKazanan ? "  (" + formatTL(muhtemelKazanan.teklif) + ")" : ""), colSpan: 4, styles: { fontStyle: "bold", fillColor: [255, 237, 213] } }],
      ],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 35 },
        2: { fontStyle: "bold", cellWidth: 35 },
      },
      theme: "grid",
    });

    const bilgiEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

    // Teklif listesi başlığı
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Teklif Listesi", 14, bilgiEndY);
    doc.setFont("helvetica", "normal");

    const body = siraliKatilimcilar.map((k, i) => {
      const isMK = muhtemelKazanan?.firmaAdi === k.firmaAdi && muhtemelKazanan?.teklif === k.teklif;
      let durumText = "";
      if (isMK) durumText = "MUHTEMEL KAZANAN";
      else if (k.durum === "sinir_alti") durumText = "Sinir Alti";
      else if (k.durum === "gecersiz") durumText = tr(k.gecersizNedeni ?? "Gecersiz");
      // Uyarılar
      if (k.uyarilar.length > 0) {
        const uyariStr = k.uyarilar.map((u) => tr(u)).join(", ");
        durumText = durumText ? durumText + " | " + uyariStr : uyariStr;
      }
      return [
        String(i + 1),
        tr(k.firmaAdi),
        formatSayi(k.teklif, 2),
        "%" + tenzilat(k.teklif).toFixed(2),
        durumText || "-",
      ];
    });

    autoTable(doc, {
      startY: bilgiEndY + 3,
      head: [["No", "Firma Adi", "Teklif Tutari (TL)", "Tenzilat", "Durum"]],
      body,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        2: { cellWidth: "wrap" as unknown as number, halign: "right" },
        3: { cellWidth: "wrap" as unknown as number, halign: "right" },
        4: { cellWidth: "wrap" as unknown as number },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section === "body") {
          const k = siraliKatilimcilar[data.row.index];
          if (!k) return;
          const isMK = muhtemelKazanan?.firmaAdi === k.firmaAdi && muhtemelKazanan?.teklif === k.teklif;
          if (isMK) {
            data.cell.styles.fillColor = [255, 237, 213];
          } else if (k.isOwn) {
            data.cell.styles.fillColor = [220, 252, 231];
          } else if (k.durum === "gecersiz") {
            data.cell.styles.fillColor = [243, 244, 246];
            data.cell.styles.textColor = [156, 163, 175];
          }
        }
      },
    });

    const pdfAdi = (isAdi || ihaleKayitNo || "sinir-deger-rapor").replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ\s-]/g, "").replace(/\s+/g, "-").slice(0, 100);
    doc.save(`${pdfAdi}.pdf`);
  }

  // Excel Export
  function exportExcel() {
    const headers = ["Sıra", "Firma Adı", "Teklif Tutarı", "Tenzilat (%)", "Durum"];
    const data = siraliKatilimcilar.map((k, i) => {
      const isMK = muhtemelKazanan?.firmaAdi === k.firmaAdi && muhtemelKazanan?.teklif === k.teklif;
      return [
        i + 1,
        k.firmaAdi,
        k.teklif,
        tenzilat(k.teklif),
        k.durum === "gecerli" ? (isMK ? "Muhtemel Kazanan" : "Geçerli")
          : k.durum === "sinir_alti" ? "Sınır Altı"
          : k.gecersizNedeni ?? "Geçersiz",
      ];
    });
    // Üst bilgiler
    const ws = XLSX.utils.aoa_to_sheet([
      ["İdare", idareAdi],
      ["İşin Adı", isAdi],
      ["İKN", ihaleKayitNo],
      ["Tarih", ihaleTarihi],
      ["Yaklaşık Maliyet", ym],
      ["Sınır Değer", hesap?.sinirDeger ?? ""],
      ["T1", hesap?.t1 ?? ""], ["T2", hesap?.t2 ?? ""],
      ["C", hesap?.c ?? ""], ["K", hesap?.k ?? ""], ["N", nVal],
      [],
      headers,
      ...data,
    ]);
    ws["!cols"] = [{ wch: 6 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sınır Değer");
    XLSX.writeFile(wb, `sinir-deger-${ihaleKayitNo || "rapor"}.xlsx`);
  }

  // WhatsApp paylaşım
  function whatsappPaylas() {
    if (!hesap) return;
    const tarihStr = ihaleTarihi ? ihaleTarihi.split("-").reverse().join(".") : "-";
    const metin = [
      `*İhale:* ${idareAdi}`,
      isAdi ? `*İşin Adı:* ${isAdi}` : "",
      `*İKN:* ${ihaleKayitNo}`,
      `*Tarih:* ${tarihStr}${ihaleSaati ? " " + ihaleSaati : ""}`,
      `*Y.M.:* ${formatTL(ym)}`,
      `*Sınır Değer:* ${formatTL(hesap.sinirDeger)}`,
      muhtemelKazanan ? `*Muhtemel Kazanan:* ${muhtemelKazanan.firmaAdi} (${formatTL(muhtemelKazanan.teklif)})` : "",
    ].filter(Boolean).join("\n");
    const encoded = encodeURIComponent(metin);
    window.open(`https://web.whatsapp.com/send?text=${encoded}`, "_blank");
    navigator.clipboard.writeText(metin).catch(() => {});
    toast.success("WhatsApp açıldı. Kişi seçip gönderin.");
  }

  // Geçmiş filtre
  const filtreliGecmis = useMemo(() => {
    const q = gecmisArama.trim().toLowerCase();
    if (!q) return gecmisIhaleler;
    return gecmisIhaleler.filter((i) =>
      [i.idare_adi, i.is_adi, i.ihale_kayit_no, i.muhtemel_kazanan, String(i.yaklasik_maliyet)]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [gecmisIhaleler, gecmisArama]);

  // Sıfırla
  function sifirla() {
    setCurrentIhaleId(null);
    setCurrentIhaleIsOriginal(false);
    setIdareAdi(""); setIsAdi(""); setIhaleKayitNo(""); setIhaleTarihi(""); setIhaleSaati(""); setTeklifAcmaTarihi(""); setYaklasikMaliyet("");
    setKatilimcilar([]); setHasManualEdits(false); setAnalizYapildi(false);
    setDosya(null);
  }

  if (loading) {
    return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Calculator size={24} /> İhale — Sınır Değer
        </h1>
      </div>

      <Tabs value={aktifTab} onValueChange={(v) => setAktifTab(v as typeof aktifTab)} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="hesaplama">Sınır Değer Hesaplama</TabsTrigger>
          <TabsTrigger value="gecmis">Geçmiş İhaleler ({gecmisIhaleler.length})</TabsTrigger>
        </TabsList>

        {/* ======================== SEKME 1: HESAPLAMA ======================== */}
        <TabsContent value="hesaplama">
          {/* Üst: Dosya Yükleme (sol) + İhale Bilgileri (sağ) yan yana */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* Dosya Yükleme Kartı */}
            <div className="bg-white rounded-lg border p-5">
              <h3 className="font-bold text-base text-[#1E3A5F] mb-4">Dosya Yükleme</h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">İş Grubu</Label>
                  <select value={seciliIsGrubu} onChange={(e) => isGrubuSec(e.target.value)} className={selectClass + " w-full"}>
                    <option value="">Seçiniz</option>
                    {isGruplari.filter((g) => g.aktif).map((g) => <option key={g.id} value={g.deger}>{g.deger}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">N Katsayısı</Label>
                  <select value={nKatsayisi} onChange={(e) => setNKatsayisi(e.target.value)} className={selectClass + " w-full"}>
                    <option value="1,00">N = 1,00 (Yapım)</option>
                    <option value="1,20">N = 1,20 (Genel)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className={`text-xs font-semibold ${!seciliIsGrubu ? "text-gray-400" : ""}`}>İhale Tutanağı (.docx)</Label>
                  <input type="file" accept=".docx" disabled={!seciliIsGrubu || analyzing}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f) { setDosya(f); analizEtWithFile(f); }
                    }}
                    className={`w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[#64748B] file:text-white hover:file:bg-[#2a4f7a] ${!seciliIsGrubu ? "opacity-50 cursor-not-allowed" : ""}`} />
                  {!seciliIsGrubu && <p className="text-[10px] text-amber-600">Önce iş grubu seçin</p>}
                </div>
                {analyzing && (
                  <div className="text-center text-sm text-gray-500 py-2">Analiz ediliyor...</div>
                )}
              </div>
            </div>

            {/* İhale Bilgileri Kartı */}
            <div className="bg-white rounded-lg border p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-base text-[#1E3A5F]">İhale Bilgileri</h3>
                {hasManualEdits && <span className="text-red-500 text-[10px] bg-red-50 px-2 py-0.5 rounded border border-red-200">DÜZENLENDİ</span>}
              </div>
              {analizYapildi ? (
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-gray-100">
                      <td className="text-gray-500 py-2 pr-3 whitespace-nowrap w-28">İdare Adı</td>
                      <td className="py-2">
                        <input type="text" value={idareAdi} onChange={(e) => { setIdareAdi(e.target.value); setHasManualEdits(true); }}
                          placeholder="—" className="w-full font-semibold text-gray-800 bg-transparent border-0 outline-none" />
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="text-gray-500 py-2 pr-3 whitespace-nowrap w-28">İşin Adı</td>
                      <td className="py-2">
                        <input type="text" value={isAdi} onChange={(e) => { setIsAdi(e.target.value); setHasManualEdits(true); }}
                          placeholder="—" className="w-full font-semibold text-gray-800 bg-transparent border-0 outline-none" />
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="text-gray-500 py-2 pr-3 whitespace-nowrap">İKN</td>
                      <td className="py-2">
                        <input type="text" value={ihaleKayitNo} onChange={(e) => { setIhaleKayitNo(e.target.value); setHasManualEdits(true); }}
                          placeholder="—" className="w-full font-semibold bg-transparent border-0 outline-none" />
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="text-gray-500 py-2 pr-3 whitespace-nowrap">İhale Tarihi</td>
                      <td className="py-2 flex items-center gap-2">
                        <span className="font-semibold text-gray-800">{ihaleTarihi ? new Date(ihaleTarihi + "T00:00:00").toLocaleDateString("tr-TR") : "—"}</span>
                        {ihaleSaati && <span className="text-gray-600 font-semibold">{ihaleSaati}</span>}
                      </td>
                    </tr>
                    {teklifAcmaTarihi && (
                      <tr className="border-b border-gray-100">
                        <td className="text-gray-500 py-2 pr-3 whitespace-nowrap">Teklif Açma</td>
                        <td className="py-2 font-semibold">{teklifAcmaTarihi}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="text-gray-500 py-2 pr-3 whitespace-nowrap">Yaklaşık Maliyet</td>
                      <td className="py-2">
                        <input type="text" inputMode="decimal" value={yaklasikMaliyet}
                          onChange={(e) => { setYaklasikMaliyet(formatParaInput(e.target.value)); setHasManualEdits(true); }}
                          className="w-full text-lg font-bold text-emerald-700 bg-transparent border-0 outline-none" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                  Dosya yüklendikten sonra bilgiler burada görünecek
                </div>
              )}
            </div>
          </div>

          {/* Teklif Listesi ve Sınır Değer Analizi Barı */}
          {analizYapildi && siraliKatilimcilar.length > 0 && (
            <>
              <div className="bg-white rounded-lg border p-4 mb-0">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-sm text-[#1E3A5F]">Teklif Listesi ve Sınır Değer Analizi</h3>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportExcel} disabled={!hesap}>
                      <FileSpreadsheet size={12} className="mr-1" /> Excel
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportPDF} disabled={!hesap}>
                      <FileDown size={12} className="mr-1" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={whatsappPaylas} disabled={!hesap}>
                      <Share2 size={12} className="mr-1" /> Paylaş / WhatsApp
                    </Button>
                  </div>
                  {hesap && (
                    <div className="bg-[#64748B] text-white px-4 py-1.5 rounded-lg text-sm font-bold">
                      Sınır Değer: {formatTL(hesap.sinirDeger)}
                    </div>
                  )}
                </div>

                {/* Hesaplama Detay Toggle */}
                {hesap && (
                  <>
                    {muhtemelKazanan && (
                      <div className="text-sm font-bold text-emerald-700 mb-2">
                        Muhtemel Kazanan: {muhtemelKazanan.firmaAdi}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <button type="button" onClick={() => setHesapDetayAcik(!hesapDetayAcik)}
                        className="text-xs text-[#1E3A5F] hover:text-blue-700 underline flex items-center gap-1">
                        {hesapDetayAcik ? "Hesaplama Detaylarını Gizle" : "Hesaplama Detaylarını Göster"}
                      </button>
                    </div>
                    {hesapDetayAcik && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-x-6 gap-y-2 text-xs mb-3">
                          <div><span className="text-gray-500">Yaklaşık Maliyet:</span><br/><span className="font-semibold">{formatSayi(ym)}</span></div>
                          <div><span className="text-gray-500">Ortalama-1:</span><br/><span className="font-semibold">{formatSayi(hesap.ortalama1)}</span></div>
                          <div><span className="text-gray-500">Ortalama-2:</span><br/><span className="font-semibold">{formatSayi(hesap.ortalama2)}</span></div>
                          <div><span className="text-gray-500">Alt Sınır (T1):</span><br/><span className="font-semibold">{formatSayi(hesap.t1)}</span></div>
                          <div><span className="text-gray-500">Üst Sınır (T2):</span><br/><span className="font-semibold">{formatSayi(hesap.t2)}</span></div>
                          <div><span className="text-gray-500">Sapma (σ):</span><br/><span className="font-semibold">{formatSayi(hesap.standartSapma)}</span></div>
                          <div><span className="text-gray-500">Std. Sapma Alt:</span><br/><span className="font-semibold">{formatSayi(hesap.stdSapmaAlt)}</span></div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-x-6 gap-y-2 text-xs mb-3">
                          <div><span className="text-gray-500">Std. Sapma Üst:</span><br/><span className="font-semibold">{formatSayi(hesap.stdSapmaUst)}</span></div>
                          <div><span className="text-gray-500">C Değeri:</span><br/><span className="font-semibold">{hesap.c.toFixed(3)}</span></div>
                          <div><span className="text-gray-500">K Değeri:</span><br/><span className="font-semibold">{hesap.k.toFixed(3)}</span></div>
                          <div><span className="text-gray-500">N Kats.:</span><br/><span className="font-semibold">{nVal.toFixed(2)}</span></div>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-1.5 text-xs text-blue-800">
                          Toplam teklif: {katilimcilar.filter((k) => k.durum === "gecerli").length} geçerli
                          {" | "}[%40-%120] aralığında hesaba dahil: <strong>{hesap.gecerliSayi}</strong> firma
                          {" | "}[T1±σ] makul aralıkta: <strong>{hesap.makulSayi}</strong> firma
                        </div>
                      </div>
                    )}
                    <div className="text-[11px] text-gray-400 mb-2">Teklifler düşük fiyattan yükseğe doğru sıralanmıştır.</div>
                  </>
                )}

                {/* Teklif Listesi Tablosu */}
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="border-b-2 border-gray-200">
                      <TableHead className="text-[11px] px-2 w-10 font-semibold text-gray-700">No</TableHead>
                      <TableHead className="text-[11px] px-2 min-w-[180px] font-semibold text-gray-700">Firma / İstekli Adı</TableHead>
                      <TableHead className="text-[11px] px-2 text-right min-w-[100px] font-semibold text-gray-700">Teklif Tutarı</TableHead>
                      <TableHead className="text-[11px] px-2 text-center font-semibold text-gray-700">Tenzilat</TableHead>
                      <TableHead className="text-[11px] px-2 text-center font-semibold text-gray-700">Durum</TableHead>
                      <TableHead className="text-[11px] px-2 text-center w-[40px] font-semibold text-gray-700">Sil</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {siraliKatilimcilar.map((k, i) => {
                      const isMK = muhtemelKazanan?.firmaAdi === k.firmaAdi && muhtemelKazanan?.teklif === k.teklif;
                      const tenzilatVal = tenzilat(k.teklif);
                      const rowClass = isMK
                        ? "bg-orange-50 border-l-4 border-l-orange-400"
                        : k.isOwn
                        ? "bg-emerald-50 border-l-4 border-l-emerald-500"
                        : k.durum === "gecersiz"
                        ? "bg-gray-50"
                        : "hover:bg-gray-50";
                      return (
                        <TableRow key={`${k.firmaAdi}-${k.teklif}-${i}`} className={rowClass}>
                          <TableCell className="px-2 text-center text-gray-400">{i + 1}</TableCell>
                          <TableCell className="px-2">
                            <span className={`uppercase font-medium text-gray-900 ${k.isOwn ? "text-emerald-800 font-bold" : ""}`}>
                              {k.firmaAdi}
                            </span>
                            {(k.gecersizNedeni || k.uyarilar.length > 0 || k.isEdited) && (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {k.isEdited && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                                    <Pencil size={8} /> Düzenlendi {k.eskiTutar != null ? `(Eski: ${formatSayi(k.eskiTutar)} TL)` : ""}
                                  </span>
                                )}
                                {k.gecersizNedeni && k.gecersizNedeni.split(", ").map((neden) => (
                                  <span key={neden} className="inline-flex items-center gap-0.5 text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                                    <AlertTriangle size={9} /> {neden}
                                  </span>
                                ))}
                                {k.uyarilar.map((uyari) => (
                                  <span key={uyari} className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                    <AlertTriangle size={9} /> {uyari}
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="px-2 text-right font-mono">
                            {editIdx === i ? (
                              <div className="flex items-center gap-1 justify-end">
                                <input type="text" inputMode="decimal" value={editTutar}
                                  onChange={(e) => setEditTutar(formatParaInput(e.target.value))}
                                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditIdx(null); }}
                                  className="w-28 h-7 text-right text-xs border rounded px-1" autoFocus />
                                <button type="button" onClick={saveEdit} className="text-emerald-600"><CheckCircle2 size={14} /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => startEdit(i)}
                                className="hover:underline cursor-pointer" title="Tıklayarak düzenle">
                                {formatSayi(k.teklif, 2)} TL
                              </button>
                            )}
                          </TableCell>
                          <TableCell className="px-2 text-center">
                            <span className={`font-bold ${tenzilatVal > 0 ? "text-emerald-600" : "text-red-600"}`}>
                              %{tenzilatVal > 0 ? "" : ""}{tenzilatVal.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="px-2 text-center">
                            {isMK ? (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold border border-orange-300">
                                <AlertTriangle size={10} /> İlk Makul Teklif
                              </span>
                            ) : k.durum === "gecerli" ? (
                              <span className="text-gray-400 text-[10px]">—</span>
                            ) : k.durum === "sinir_alti" ? (
                              <span className="text-amber-600 text-[10px]">Sınır Altı</span>
                            ) : (
                              <span className="text-red-500 text-[10px]">Geçersiz</span>
                            )}
                          </TableCell>
                          <TableCell className="px-2 text-center">
                            <button type="button" onClick={() => katilimciSil(i)} className="p-1 text-red-300 hover:text-red-600">
                              <Trash2 size={14} />
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Satır içi yeni firma ekleme */}
                    <TableRow className="bg-gray-50/50">
                      <TableCell className="px-2 text-center text-gray-300">{siraliKatilimcilar.length + 1}</TableCell>
                      <TableCell className="px-2">
                        <input type="text" value={yeniKatFirma} onChange={(e) => setYeniKatFirma(e.target.value)}
                          placeholder="Firma adı girin..." className="w-full h-7 text-xs border border-dashed border-gray-300 rounded px-2 bg-white outline-none focus:border-[#1E3A5F]" />
                      </TableCell>
                      <TableCell className="px-2 text-right">
                        <input type="text" inputMode="decimal" value={yeniKatTutar}
                          onChange={(e) => setYeniKatTutar(formatParaInput(e.target.value))}
                          placeholder="Tutar" className="w-28 h-7 text-xs text-right border border-dashed border-gray-300 rounded px-2 bg-white outline-none focus:border-[#1E3A5F]" />
                      </TableCell>
                      <TableCell className="px-2 text-center" colSpan={2}>
                        <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={yeniKatilimciEkle} disabled={!yeniKatFirma.trim() || !yeniKatTutar}>
                          <Plus size={12} className="mr-1" /> Ekle
                        </Button>
                      </TableCell>
                      <TableCell className="px-2"></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {!analizYapildi && (
            <div className="text-center py-16 bg-white rounded-lg border">
              <Upload size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">İş grubunu seçin ve ihale tutanağını (.docx) yükleyin.</p>
              <p className="text-gray-400 text-sm mt-1">Dosya yüklenir yüklenmez otomatik analiz başlar.</p>
            </div>
          )}
        </TabsContent>

        {/* ======================== SEKME 2: GEÇMİŞ İHALELER ======================== */}
        <TabsContent value="gecmis">
          <div className="bg-white rounded-lg border p-3 mb-4">
            <div className="relative max-w-sm">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={gecmisArama} onChange={(e) => setGecmisArama(e.target.value)}
                placeholder="İKN, idare, firma ara..." className={selectClass + " w-full pl-8"} />
            </div>
          </div>

          {filtreliGecmis.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-lg border">
              <Calculator size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Henüz kaydedilmiş ihale bulunmuyor.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border overflow-x-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-[#64748B]">
                    <TableHead className="text-white text-[11px] px-2">Tarih</TableHead>
                    <TableHead className="text-white text-[11px] px-2">İKN</TableHead>
                    <TableHead className="text-white text-[11px] px-2 min-w-[200px]">İdare</TableHead>
                    <TableHead className="text-white text-[11px] px-2 min-w-[150px]">İşin Adı</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right">Y. Maliyet</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right">Sınır Değer</TableHead>
                    <TableHead className="text-white text-[11px] px-2">Muhtemel Kazanan</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-center">Durum</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-center w-[80px]">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtreliGecmis.map((i) => (
                    <TableRow key={i.id} className="hover:bg-gray-50">
                      <TableCell className="px-2 whitespace-nowrap">{i.ihale_tarihi ? i.ihale_tarihi.split("-").reverse().join(".") : "—"}</TableCell>
                      <TableCell className="px-2 font-mono text-[11px]">{i.ihale_kayit_no ?? "—"}</TableCell>
                      <TableCell className="px-2 truncate max-w-[200px]" title={i.idare_adi ?? ""}>{i.idare_adi ?? "—"}</TableCell>
                      <TableCell className="px-2 truncate max-w-[150px]" title={i.is_adi ?? ""}>{i.is_adi ?? "—"}</TableCell>
                      <TableCell className="px-2 text-right">{i.yaklasik_maliyet ? formatTL(i.yaklasik_maliyet) : "—"}</TableCell>
                      <TableCell className="px-2 text-right font-bold text-[#1E3A5F]">{i.sinir_deger ? formatTL(i.sinir_deger) : "—"}</TableCell>
                      <TableCell className="px-2">{i.muhtemel_kazanan ?? "—"}</TableCell>
                      <TableCell className="px-2 text-center">
                        {i.has_manual_edits && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">DÜZENLENDİ</span>}
                      </TableCell>
                      <TableCell className="px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => gecmisYukle(i)} className="p-1 text-gray-400 hover:text-blue-600" title="Görüntüle">
                            <Eye size={13} />
                          </button>
                          {ySil && (
                            <button type="button" onClick={() => setSilOnay(i.id)} className="p-1 text-gray-400 hover:text-red-600" title="Sil">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* İş Grupları sekmesi kaldırıldı — tanımlamalar sayfasından yönetiliyor */}
      </Tabs>

      {/* ====================== DİALOGLAR ====================== */}

      {/* Yeni Katılımcı Dialog */}
      <Dialog open={yeniKatOpen} onOpenChange={setYeniKatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Yeni Katılımcı Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Firma Adı <span className="text-red-500">*</span></Label>
              <input type="text" value={yeniKatFirma} onChange={(e) => setYeniKatFirma(e.target.value)}
                placeholder="Firma adı" className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Teklif Tutarı (TL) <span className="text-red-500">*</span></Label>
              <input type="text" inputMode="decimal" value={yeniKatTutar}
                onChange={(e) => setYeniKatTutar(formatParaInput(e.target.value))}
                placeholder="0,00" className={selectClass + " w-full"} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setYeniKatOpen(false)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={yeniKatilimciEkle}>Ekle</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* İş Grubu Dialog */}
      <Dialog open={igDialogOpen} onOpenChange={setIgDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{igEditId ? "İş Grubu Düzenle" : "Yeni İş Grubu"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">İş Grubu Adı <span className="text-red-500">*</span></Label>
              <input type="text" value={igAd} onChange={(e) => setIgAd(e.target.value)}
                placeholder="Örn: Yapım İşleri" className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">N Katsayısı <span className="text-red-500">*</span></Label>
              <select value={igN} onChange={(e) => setIgN(e.target.value)} className={selectClass + " w-full"}>
                <option value="1,00">N = 1,00 (Yapım)</option>
                <option value="1,20">N = 1,20 (Genel)</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setIgDialogOpen(false)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={igKaydet}>
                {igEditId ? "Güncelle" : "Ekle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* İş Grubu Silme Onayı */}
      <Dialog open={!!igSilOnay} onOpenChange={(o) => !o && setIgSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>İş Grubunu Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu iş grubunu silmek istediğinize emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setIgSilOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={igSil}>Sil</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* İhale Silme Onayı */}
      <Dialog open={!!silOnay} onOpenChange={(o) => !o && setSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>İhaleyi Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu ihale ve tüm katılımcı verileri silinecek. Emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setSilOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={gecmisSil}>Sil</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
