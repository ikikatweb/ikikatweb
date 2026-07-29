// KASKO teklif mailinde araç SINIFINA göre en üste eklenen şartlar metni.
// Tanımlamalar → "Kasko Teklif Şablonları" kartından düzenlenir (kategori: kasko_teklif_sablon, kisa_ad = sınıf key).
// Kayıt yoksa buradaki varsayılan kullanılır. Trafik sigortası maili DEĞİŞMEZ (yalnız kasko).

export const KASKO_TEKLIF_KATEGORI = "kasko_teklif_sablon";

// Teklif TALEP cümlesi — KASKO ve TRAFİK AYRI KATEGORİ (her kategoride tek satır). Ayrı kategori olması,
// tanimlamalar (kategori,deger) benzersiz kısıtıyla çakışmayı önler (aynı metin iki tipte olsa bile sorun olmaz).
// Yer tutucular: {plaka} = araç plakası, {tip} = "kasko" / "trafik sigortası".
export const TEKLIF_TALEP_KATEGORI = "teklif_talep_metni"; // LEGACY (eski tek "genel" kayıt) — yalnız geri-uyum okuması
export const TEKLIF_TALEP_KASKO_KATEGORI = "teklif_talep_kasko";
export const TEKLIF_TALEP_TRAFIK_KATEGORI = "teklif_talep_trafik";
export const TEKLIF_TALEP_VARSAYILAN =
  "Ekte ruhsat fotokopisi bulunan {plaka} plakalı aracımızın süresi dolan {tip} poliçesi için yenileme teklifi çalışmasının yapılmasını rica ederiz.";

export type KaskoSinif = { key: string; label: string; varsayilan: string };

export const KASKO_TEKLIF_SINIFLAR: KaskoSinif[] = [
  {
    key: "binek",
    label: "Binek",
    varsayilan:
      "İMM: 10.000.000\n" +
      "İkame: 15 x 2\n" +
      "Manevi: Dahil\n" +
      "Araç Yaşına göre ön cam orjinal ( 5 Yaşa kadar )\n" +
      "Servis Seçimi: Tüm Servisler\n" +
      "Hasarsızlık Koruma: Evet ( Şartlar dahilinde )",
  },
  {
    key: "kamyon",
    label: "Kamyon",
    varsayilan:
      "İMM: 20.000.000\n" +
      "İkame: Yok\n" +
      "Manevi: Dahil\n" +
      "Yol Yardım: Max\n" +
      "Servis: Tüm Servisler\n" +
      "Hasarsızlık Koruma: Evet ( Şartlar Dahilinde )\n" +
      "Kasa Tipi: Damper",
  },
  {
    key: "kamyonet",
    label: "Kamyonet",
    varsayilan:
      "İMM: 10.000.000\n" +
      "İkame: Yok\n" +
      "Manevi: Dahil\n" +
      "Yol Yardım: Max\n" +
      "Servis: Tüm Servisler\n" +
      "Hasarsızlık Koruma: Evet ( Şartlar Dahilinde )",
  },
  {
    key: "cekici",
    label: "Çekici",
    varsayilan:
      "İMM: 20.000.000\n" +
      "İkame: Yok\n" +
      "Manevi: Dahil\n" +
      "Yol Yardım: Max\n" +
      "Servis: Tüm Servisler\n" +
      "Hasarsızlık Koruma: Evet ( Şartlar Dahilinde )",
  },
];

// Araç cinsinden kasko sınıf anahtarı türet. Sıra önemli: "kamyonet" "kamyon"dan ÖNCE kontrol edilir.
export function cinsToKaskoSinif(cins: string | null | undefined): string | null {
  const c = (cins ?? "").toLocaleLowerCase("tr");
  if (!c) return null;
  if (c.includes("çekici") || c.includes("cekici")) return "cekici";
  if (c.includes("kamyonet")) return "kamyonet";
  if (c.includes("kamyon")) return "kamyon";
  if (c.includes("binek")) return "binek";
  return null;
}

export function kaskoSablonVarsayilan(sinifKey: string): string {
  return KASKO_TEKLIF_SINIFLAR.find((s) => s.key === sinifKey)?.varsayilan ?? "";
}
