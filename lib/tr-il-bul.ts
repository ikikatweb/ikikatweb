// İŞ ADINDAN İL BULMA — "Tokat Niksar İş Merkezi Çatı Onarımı İşi" → Tokat.
//
// Yeni iş formunda il kutusu elle seçiliyordu; oysa iş adı çoğu kez ya ili ya ilçeyi
// zaten söylüyor ("Amasya Merzifon…", "Erbaa Myo…", "Zile Myo…").
//
// SIRA: önce 81 il adı aranır, bulunamazsa ilçe adı aranır (lib/tr-ilce-il.ts).
// İl adı her zaman önceliklidir: "Amasya Merzifon" → Amasya (ikisi de doğru, ama il
// bilgisi daha kesindir).
//
// BULAMAZSA null döner ve kutu BOŞ kalır. Tahminle doldurmak yanlış ili sessizce yazardı;
// aynı adlı ilçeler (Ulubey → Ordu/Uşak gibi 23 ad) bu yüzden tabloya hiç alınmadı.
import { TR_ILLER } from "@/lib/tr-iller";
import { ILCE_IL } from "@/lib/tr-ilce-il";

/**
 * Karşılaştırma biçimi: küçük harf, Türkçe harfler sadeleştirilmiş, harf dışı atılmış.
 * Düzeltme işaretli harfler de sadeleştirilir (Devrekâni → devrekani); yoksa harf tümden
 * atılıp "devrekni" çıkıyor ve ilçe bulunamıyordu.
 * DİKKAT: scripts/ilce-il-uret.mjs içindeki eşi ile AYNI kalmalı — tablo anahtarları
 * oradan üretiliyor.
 */
export function ilNormalize(s: string): string {
  return (s || "")
    .toLocaleLowerCase("tr")
    .replace(/i̇/g, "i")
    .replace(/[çğıöşüâîûêô]/g, (c) =>
      (({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u", ê: "e", ô: "o" }) as Record<string, string>)[c] || c)
    .replace(/[^a-z]/g, "");
}

/** Resmi ad dışındaki yaygın yazımlar. */
const ALIAS: Record<string, string> = {
  afyonkarahisar: "Afyon", icel: "Mersin", urfa: "Şanlıurfa", antep: "Gaziantep",
  maras: "Kahramanmaraş", kmaras: "Kahramanmaraş", hakkari: "Hakkari",
};

const IL_ARAMA = new Map<string, string>();
for (const ad of TR_ILLER) IL_ARAMA.set(ilNormalize(ad), ad);
for (const [k, v] of Object.entries(ALIAS)) IL_ARAMA.set(ilNormalize(k), v);

export type IlBulgusu = {
  /** Bulunan ilin resmi adı (TR_ILLER yazımıyla). */
  il: string;
  /** İl adından mı ilçe adından mı bulundu. */
  kaynak: "il" | "ilce";
  /** Eşleşen kelime — kullanıcıya "neden bu il" diye gösterilir. */
  kelime: string;
};

/**
 * İş adında geçen ilk il adını, yoksa ilk ilçe adını bulur.
 * Tek harfli/çok kısa kelimeler ve "iş", "ili" gibi ekler zaten tabloda olmadığı için elenir.
 */
export function isAdindanIl(isAdi: string): IlBulgusu | null {
  const kelimeler = (isAdi || "").split(/[\s,./()\-–—]+/).filter(Boolean);

  // 1) İl adı — her zaman öncelikli.
  for (const kelime of kelimeler) {
    const n = ilNormalize(kelime);
    const il = n && IL_ARAMA.get(n);
    if (il) return { il, kaynak: "il", kelime };
  }

  // 2) İlçe adı.
  for (const kelime of kelimeler) {
    const n = ilNormalize(kelime);
    const il = n && ILCE_IL[n];
    if (il) return { il, kaynak: "ilce", kelime };
  }

  return null;
}
