// TELEFON GÖSTERİMİ — tek biçim: 0 (533) 316 55 05
//
// NEDEN VAR: numaralar ekrana kullanıcının yazdığı gibi düşüyordu. Aynı listede
// "+90 (506) 793 06 82" ile "05333598347" yan yana duruyor, göz numarayı okumak
// yerine biçimi çözmeye çalışıyordu. Veri DEĞİŞTİRİLMİYOR: veritabanında ne
// yazıyorsa o duruyor, yalnız gösterim tek biçime getiriliyor.
//
// NUMARA OLMAYANA DOKUNULMAZ: bu alanlar serbest metin. İçinde harf varsa
// ("Ali Bey 0533..."), rakam sayısı tutmuyorsa (dahili numaralı santral,
// iki numara birden) OLDUĞU GİBİ bırakılır. Tahminle biçimlendirmek, var olan
// bilgiyi kırpmak demek olurdu — yarısı silinmiş bir numara, biçimsiz
// numaradan çok daha kötüdür.

/** Kabul edilen gövde: 10 hane, ilk hane 2-5 (sabit hat alan kodları ve cep). */
const GOVDE = /^[2-5]\d{9}$/;

/**
 * Ham metni "0 (533) 316 55 05" biçimine çevirir.
 * Numaraya benzemiyorsa ham metni OLDUĞU GİBİ döndürür.
 *
 * Tanınan girişler:  05333165505 · 5333165505 · +90 533 316 55 05 · 905333165505
 */
export function telefonGoster(ham: string | null | undefined): string {
  const metin = (ham ?? "").trim();
  if (!metin) return "";
  // Harf varsa bu düz bir numara değil (isim, not, e-posta) — karışma.
  if (/\p{L}/u.test(metin)) return metin;

  let h = metin.replace(/\D/g, "");
  if (h.length === 12 && h.startsWith("90")) h = h.slice(2);   // +90 533...
  else if (h.length === 11 && h.startsWith("0")) h = h.slice(1); // 0533...
  if (!GOVDE.test(h)) return metin;

  return `0 (${h.slice(0, 3)}) ${h.slice(3, 6)} ${h.slice(6, 8)} ${h.slice(8)}`;
}
