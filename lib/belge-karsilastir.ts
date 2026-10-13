// Belgeden okunan alanlarla sitedeki kaydı karşılaştırır.
//
// Yalnız FARK ÜRETİR, hiçbir şey yazmaz; yazma kararı kullanıcıda
// (components/shared/belge-fark-dialog.tsx).

import type { BelgeFark } from "@/components/shared/belge-fark-dialog";
import { alanAdi, degerGoster } from "@/lib/kayit-gecmisi-alanlar";

type Kayit = Record<string, unknown>;
type Okunan = Record<string, string | number | null | undefined>;

/** Karşılaştırılacak alanlar ve karşılaştırma biçimi. */
const ALANLAR: { alan: string; tip: "tarih" | "sayi" | "metin" }[] = [
  { alan: "ihale_kayit_no", tip: "metin" },
  { alan: "sozlesme_tarihi", tip: "tarih" },
  { alan: "sozlesme_bedeli", tip: "sayi" },
  { alan: "sozlesme_fiyatlariyla_gerceklesen", tip: "sayi" },
  { alan: "ortaklik_orani", tip: "sayi" },
  { alan: "isyeri_teslim_tarihi", tip: "tarih" },
  { alan: "is_suresi", tip: "sayi" },
  { alan: "is_bitim_tarihi", tip: "tarih" },
  { alan: "gecici_kabul_itibar_tarihi", tip: "tarih" },
  { alan: "gecici_kabul_tarihi", tip: "tarih" },
  { alan: "kesin_kabul_tarihi", tip: "tarih" },
];
// is_adi bilerek YOK: Netsim ve resmî belgeler adı BÜYÜK HARF yazıyor, sitede başlık
// biçiminde duruyor — her belgede "fark" çıkar, gerçek bir fark olmadığı hâlde.

const bos = (v: unknown) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));

function ayni(a: unknown, b: unknown, tip: string): boolean {
  if (tip === "sayi") return Math.abs(Number(a) - Number(b)) < 0.01;
  if (tip === "tarih") return String(a).slice(0, 10) === String(b).slice(0, 10);
  return String(a).replace(/\s+/g, "").toLocaleUpperCase("tr")
      === String(b).replace(/\s+/g, "").toLocaleUpperCase("tr");
}

/**
 * Belgedeki değer sitedekinden farklıysa bir fark satırı üretir.
 * Belgede okunamayan (null) alan hiç önerilmez — "boşalt" diye bir öneri çıkmaz,
 * belgeyi okuyamamak kaydı silmek için gerekçe değil.
 */
export function belgeFarklari(
  kayit: Kayit,
  okunan: Okunan,
  alinti: Record<string, string> = {},
  tablo = "santiyeler",
): BelgeFark[] {
  const farklar: BelgeFark[] = [];
  for (const { alan, tip } of ALANLAR) {
    const yeni = okunan[alan];
    if (bos(yeni)) continue;
    const mevcut = kayit[alan];
    if (!bos(mevcut) && ayni(mevcut, yeni, tip)) continue;

    farklar.push({
      alan,
      etiket: alanAdi(tablo, alan),
      site: bos(mevcut) ? "boş" : degerGoster(alan, String(mevcut)),
      belge: degerGoster(alan, String(yeni)),
      deger: tip === "sayi" ? Number(yeni) : String(yeni),
      alinti: alinti[alan],
      bosDoldurma: bos(mevcut),
    });
  }
  return farklar;
}
