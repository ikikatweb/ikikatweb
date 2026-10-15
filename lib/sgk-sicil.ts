// SGK İŞYERİ SİCİL NUMARASI — biçim denetimi ve gösterim.
//
// 26 rakam, 9 bölüm:
//   mahiyet(1) işkolu(4) yeni ünite(2) eski ünite(2) işyeri sıra(7) il(3) ilçe(2)
//   kontrol(2) aracı/alt işveren(3)
//   örnek: 4 4299 01 01 1231527 009 01 20 000
//
// Yapı sitedeki gerçek kayıtlarla doğrulandı: işkolu kodları işin türüyle (4100 bina
// inşaatı, 4299 diğer inşaat, 7112 mühendislik), il kodları da şantiyenin iliyle
// (060 Tokat, 009 Aydın, 026 Eskişehir, 057 Sinop, 037 Kastamonu) tutuyor.
//
// Denetim NEDEN gerekti: 21 kayıttan 4'ü eksik haneyle girilmişti — üçünde 2 haneli ünite
// bölümlerinden biri, birinde ayrıca 3 haneli aracı kodu yoktu. Yazım da karışıktı; kimi
// boşluklu, kimi bitişik, kimi araya "-" konmuş.

/** Bölüm uzunlukları — toplamı 26. */
export const SGK_BOLUMLER = [1, 4, 2, 2, 7, 3, 2, 2, 3] as const;
export const SGK_HANE = 26;

export const SGK_ORNEK = "4 4299 01 01 1231527 009 01 20 000";

/** Yalnız rakamlar (boşluk, tire, nokta atılır). */
export function sgkRakamlar(deger: string | null | undefined): string {
  return String(deger ?? "").replace(/\D/g, "");
}

/** 26 rakam mı? Boş değer "geçersiz" sayılmaz — alan zorunlu değil. */
export function sgkGecerli(deger: string | null | undefined): boolean {
  const r = sgkRakamlar(deger);
  return r.length === SGK_HANE;
}

/** Değer var ama 26 rakam değil → eksik/hatalı. */
export function sgkEksik(deger: string | null | undefined): boolean {
  const r = sgkRakamlar(deger);
  return r.length > 0 && r.length !== SGK_HANE;
}

/** "4429901011231527009012000" → "4 4299 01 01 1231527 009 01 20 000" */
export function sgkBicimle(deger: string | null | undefined): string {
  const r = sgkRakamlar(deger);
  if (!r) return "";
  // Eksik/fazla haneliyi bölmeye kalkmak yanıltıcı olur (bölümler kayar) — olduğu gibi döner.
  if (r.length !== SGK_HANE) return r;
  const parcalar: string[] = [];
  let i = 0;
  for (const uzunluk of SGK_BOLUMLER) {
    parcalar.push(r.slice(i, i + uzunluk));
    i += uzunluk;
  }
  return parcalar.join(" ");
}

/** Kullanıcıya gösterilecek hata metni; sorun yoksa null. */
export function sgkHata(deger: string | null | undefined): string | null {
  const r = sgkRakamlar(deger);
  if (r.length === 0 || r.length === SGK_HANE) return null;
  const fark = SGK_HANE - r.length;
  return fark > 0
    ? `SGK sicil numarası ${SGK_HANE} haneli olmalı — ${r.length} hane girildi, ${fark} hane eksik. Örnek: ${SGK_ORNEK}`
    : `SGK sicil numarası ${SGK_HANE} haneli olmalı — ${r.length} hane girildi, ${-fark} hane fazla. Örnek: ${SGK_ORNEK}`;
}
