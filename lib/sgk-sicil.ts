// SGK İŞYERİ SİCİL NUMARASI — yalnız GÖSTERİM biçimi.
//
// Bitişik girilen numarayı mevzuattaki bölümlerine ayırarak gösterir:
//   44221010110673790370887000  →  4 4221 01 01 1067379 037 08 87 000
//
// Kaynak: Gelir İdaresi Başkanlığı, Muhtasar ve Prim Hizmet Beyannamesi kılavuzu.
// Kılavuz "26 karakterli işyeri SGK numarası" diyor ve karakter konumlarını veriyor:
//   mahiyet kodu            1
//   işkolu kodu             2-5
//   yeni ünite kodu         6-7
//   eski ünite kodu         8-9
//   işyeri sıra numarası    10-16
//   il kodu                 17-19
//   ilçe + kontrol numarası 20-23
//   alt işveren kodu        24-26
// Bileşenlerin tanımı: Sosyal Sigorta İşlemleri Yönetmeliği m.28.
//
// DENETİM YOK: 26 haneden kısa yazılmış numaralar OLDUĞU GİBİ döner. Mevzuat temel
// bileşenleri 26'dan kısa tanımlıyor (eski ünite kodu ve alt işveren kodu eklenti), bu
// yüzden kısa bir numarayı "hatalı" saymak doğru olmaz — bölmeye kalkmak da bölümleri
// kaydırıp yanlış gösterirdi.

/** Bölüm uzunlukları — toplamı 26. */
const BOLUMLER = [1, 4, 2, 2, 7, 3, 2, 2, 3] as const;
const TAM_HANE = 26;

/** Yalnız rakamlar (boşluk, tire, nokta atılır). */
export function sgkRakamlar(deger: string | null | undefined): string {
  return String(deger ?? "").replace(/\D/g, "");
}

/**
 * Gösterim biçimi. 26 rakamsa bölümlere ayrılır; değilse girildiği gibi döner.
 * Boş değer için boş string.
 */
export function sgkBicimle(deger: string | null | undefined): string {
  const ham = String(deger ?? "").trim();
  if (!ham) return "";
  const r = sgkRakamlar(ham);
  if (r.length !== TAM_HANE) return ham;
  const parcalar: string[] = [];
  let i = 0;
  for (const uzunluk of BOLUMLER) {
    parcalar.push(r.slice(i, i + uzunluk));
    i += uzunluk;
  }
  return parcalar.join(" ");
}
