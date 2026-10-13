// Belgeden okunan alanlarla sitedeki kaydı karşılaştırır ve TEK bir tablo üretir.
//
// Tablo yalnız farkları değil, uyuşanları ve belgede bulunamayanları da içerir: kullanıcı
// belgenin gerçekten o işe ait olduğunu da görmek istiyor. Yazma kararı kullanıcıda
// (components/shared/belge-fark-dialog.tsx); bu dosya hiçbir şey yazmaz.

import { alanAdi, degerGoster } from "@/lib/kayit-gecmisi-alanlar";

type Kayit = Record<string, unknown>;
type Okunan = Record<string, string | number | null | undefined>;

export type SatirDurumu =
  | "ekleme"   // sitede boş, belgede var        → uygulanabilir, varsayılan işaretli
  | "fark"     // ikisi de dolu ama farklı       → uygulanabilir, varsayılan işaretsiz
  | "ayni"     // ikisi de dolu ve aynı          → bilgi
  | "yok";     // sitede dolu, belgede okunmadı  → bilgi

export type BelgeSatir = {
  alan: string;
  etiket: string;
  site: string;
  belge: string;
  durum: SatirDurumu;
  /** Uygulanacak ham değer — yalnız "ekleme" ve "fark" satırlarında. */
  deger?: string | number | boolean | null;
  /** Belgedeki kaynak satır */
  alinti?: string;
};

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
// is_adi bilerek YOK: resmî belgeler adı BÜYÜK HARF yazıyor, sitede başlık biçiminde
// duruyor — her belgede "fark" çıkar, gerçek bir fark olmadığı hâlde.

const bos = (v: unknown) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));

function ayni(a: unknown, b: unknown, tip: string): boolean {
  if (tip === "sayi") return Math.abs(Number(a) - Number(b)) < 0.01;
  if (tip === "tarih") return String(a).slice(0, 10) === String(b).slice(0, 10);
  return String(a).replace(/\s+/g, "").toLocaleUpperCase("tr")
      === String(b).replace(/\s+/g, "").toLocaleUpperCase("tr");
}

/** Satır uygulanabilir mi (kutucuk çıkar mı)? */
export const uygulanabilir = (s: BelgeSatir) => s.durum === "ekleme" || s.durum === "fark";

export function belgeKarsilastir(
  kayit: Kayit,
  okunan: Okunan,
  alinti: Record<string, string> = {},
  tablo = "santiyeler",
): BelgeSatir[] {
  const satirlar: BelgeSatir[] = [];

  for (const { alan, tip } of ALANLAR) {
    const yeni = okunan[alan];
    const mevcut = kayit[alan];
    const etiket = alanAdi(tablo, alan);

    if (bos(yeni)) {
      // Belgede okunamadı. Sitede değer varsa bilgi olarak gösterilir; ikisi de boşsa
      // satır hiç çıkmaz — boş satırlarla tabloyu şişirmenin anlamı yok.
      if (!bos(mevcut)) {
        satirlar.push({ alan, etiket, site: degerGoster(alan, String(mevcut)), belge: "belgede yok", durum: "yok" });
      }
      continue;
    }

    if (bos(mevcut)) {
      satirlar.push({
        alan, etiket, site: "boş", belge: degerGoster(alan, String(yeni)), durum: "ekleme",
        deger: tip === "sayi" ? Number(yeni) : String(yeni), alinti: alinti[alan],
      });
      continue;
    }

    if (ayni(mevcut, yeni, tip)) {
      satirlar.push({
        alan, etiket, site: degerGoster(alan, String(mevcut)),
        belge: degerGoster(alan, String(yeni)), durum: "ayni", alinti: alinti[alan],
      });
      continue;
    }

    satirlar.push({
      alan, etiket, site: degerGoster(alan, String(mevcut)),
      belge: degerGoster(alan, String(yeni)), durum: "fark",
      deger: tip === "sayi" ? Number(yeni) : String(yeni), alinti: alinti[alan],
    });
  }

  // "ONAY TARİHİ YOK" ÖNERİSİ. Belge bir kabul belgesi (itibar tarihi okunabildi) ama
  // tasdik bölümünde tam bir tarih yok — kutu da işaretli değilse sorulur. Yoksa kayıt
  // "onay tarihi henüz girilmedi" ile "belgede onay tarihi yok" arasında askıda kalıyor.
  //
  // Yalnız sitedeki onay tarihi BOŞKEN önerilir: belgede okunamaması, mevcut bir tarihi
  // silmek için gerekçe değil.
  if (!bos(okunan.gecici_kabul_itibar_tarihi)
      && bos(okunan.gecici_kabul_tarihi)
      && bos(kayit.gecici_kabul_tarihi)
      && kayit.onay_tarihi_yok !== true) {
    satirlar.push({
      alan: "onay_tarihi_yok",
      etiket: alanAdi(tablo, "onay_tarihi_yok"),
      site: "işaretli değil",
      belge: "işaretle",
      durum: "ekleme",
      deger: true,
      alinti: "Belgenin tasdik/onay bölümünde tam bir tarih bulunamadı",
    });
  }

  return satirlar;
}
