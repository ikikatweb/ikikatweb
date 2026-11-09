// İcra sürelerinin TEK hesap yeri — son cevap/itiraz günü ve hatırlatma günü.
//
// NİYE TEK DOSYA: aynı hesap üç yerde duruyordu (ana sayfa icra kartı, ödeme emri
// kartı, şirkete açılan takipler tablosu) ve 09.11.2026'da ikisinde BİR GÜN EKSİK
// çıktığı görüldü. Hatırlatma uyarısı da aynı hesaba dayanacağı için dördüncü bir
// kopya çıkarmak yerine hepsi buradan okuyor.
//
// toISOString() KULLANILMAZ — HATANIN SEBEBİ BUYDU:
//   new Date("2025-07-18T00:00:00")  → YEREL gece yarısı
//   .toISOString()                   → UTC'ye çevirir; Türkiye UTC+3 olduğu için
//                                      "2025-07-17T21:00Z" olur ve slice(0,10)
//                                      BİR ÖNCEKİ GÜNÜ verir.
// 18.07.2025 tebliğ + 7 gün = 25.07.2025 olması gerekirken ekranda 24.07.2025
// yazıyordu. Tarih yalnız yerel alanlardan (getFullYear/getMonth/getDate) kurulur.

/** Date → "yyyy-mm-dd" (YEREL alanlardan; toISOString kullanılmaz). */
export function isoYerel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Bugün, "yyyy-mm-dd" (yerel). */
export function bugunISO(): string {
  return isoYerel(new Date());
}

/** "yyyy-mm-dd" + n gün → "yyyy-mm-dd". Geçersiz tarihte null. */
export function gunEkle(iso: string | null, n: number): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + n);
  return isoYerel(d);
}

/** İki "yyyy-mm-dd" arasındaki tam gün farkı (b - a). */
export function gunFarki(a: string, b: string): number {
  const x = new Date(a + "T00:00:00").getTime();
  const y = new Date(b + "T00:00:00").getTime();
  return Math.round((y - x) / 86400000);
}

/**
 * Son cevap/itiraz günü = tebliğ tarihi + belgede YAZAN süre.
 * Süre yoksa null döner — gün UYDURULMAZ, ekran da gün göstermez.
 */
export function sonGunHesapla(tebligTarihi: string | null, sureGun: number | null | undefined): string | null {
  if (!tebligTarihi || sureGun == null) return null;
  return gunEkle(tebligTarihi, sureGun);
}

/**
 * HATIRLATMA GÜNÜ — ana sayfadaki uyarının çıkacağı ilk gün.
 *
 * Kural: son günden BİR GÜN ÖNCE. O gün hafta sonuna denk gelirse CUMAYA çekilir,
 * çünkü cumartesi-pazar icra dairesine cevap verilemez; pazar günü çıkan bir uyarı
 * "yarın son gün" demekle birlikte elden hiçbir şey gelmeyeceği için geç kalmış olur.
 *
 *   son gün Pazartesi → uyarı Pazar'a düşer   → CUMA
 *   son gün Pazar     → uyarı Cumartesi'ye    → CUMA
 *   son gün Cumartesi → uyarı Cuma            → değişmez
 *
 * Resmî tatiller HESABA KATILMIYOR: panelde tatil takvimi yok ve uydurmak yerine
 * hafta sonu kuralıyla yetiniliyor. Tatile denk gelen bir uyarı bir gün geç görünür.
 */
export function hatirlatmaGunu(sonGun: string | null): string | null {
  if (!sonGun) return null;
  const d = new Date(sonGun + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - 1);
  const g = d.getDay();                       // 0 Pazar … 6 Cumartesi (yerel)
  if (g === 6) d.setDate(d.getDate() - 1);    // Cumartesi → Cuma
  else if (g === 0) d.setDate(d.getDate() - 2); // Pazar → Cuma
  return isoYerel(d);
}

/**
 * Hatırlatma penceresi açık mı? [hatırlatma günü … son gün] arası (iki uç dâhil).
 *
 * SÜRESİ GEÇENLER BURADA DEĞİL: bu bir "son gün yaklaştı" hatırlatması. Geçmiş
 * dosyalar kartların kendisinde kırmızı duruyor ve menü rozetinde sayılıyor;
 * kalıcı olarak üstte de durursa uyarı duvar kâğıdına döner ve okunmaz olur.
 */
export function hatirlatmaZamaniMi(sonGun: string | null, bugun = bugunISO()): boolean {
  if (!sonGun) return false;
  const ilk = hatirlatmaGunu(sonGun);
  if (!ilk) return false;
  return bugun >= ilk && bugun <= sonGun;
}

/**
 * Üçüncü şahıs defterinde belge okunmamış ESKİ kayıtlar için yedek süre.
 * Elimizdeki 25 belgenin 18'inde süre açıkça yazıyor ve hepsinde 7 gün. Yine de
 * belgeden okunan yeğlenir; bu sabit kullanıldığında ekran "(varsayılan)" der.
 */
export const VARSAYILAN_CEVAP_SURESI = 7;
