// GÜNLÜK ASGARİ ÇALIŞMANIN VERİDEN HESABI
//
// Araç kartındaki "günlük asgari çalışma" elle girilmezse bu hesap devreye girer:
// aracın GEÇMİŞTE bir çalışma gününde yaptığı EN DÜŞÜK iş. Mantığı şu — araç daha önce
// bir günde en az bu kadarını yapabildiyse, bunun altına düşen bir gün "çalıştı" sayılmamalı.
//
// Ölçüm birimi araca göre km ya da saat; kaynak, iki yakıt dolumu arasındaki sayaç farkı.
// (Sayaç yalnız yakıt alınırken okunuyor, daha ince kırılım yok.)
//
// Üç şey hesabın dışında tutulur:
//   • DIŞ GÖREV günleri — araç şantiyeden ayrılıp dışarıda yol yapmış; o kilometre bu işin
//     değil. Aralığın sayaç farkı çalışma/dış görev günlerine paylaştırılır, yalnız çalışma
//     payı sayılır.
//   • NAKİL aralıkları — iki dolum arası 45 günden uzunsa araç bekliyor ya da şantiye
//     değiştiriyordur; o kilometre bir günlük çalışmaya bağlanamaz.
//   • Çalışma günü olmayan aralıklar — bölecek gün yok.
//
// Hesap tek yerde duruyor: araç listesi ile Yakıt Denetleme aynı sayıyı göstersin.

/** Bir sayaç okuması (yakıt kaydı). */
export type Okuma = { tarih: string; saat?: string | null; km_saat: number | null };

/** Gün → puantaj durumu. */
export type GunDurum = Map<string, string>;

/** Bu süreden uzun dolum aralıkları günlük çalışmaya bağlanamaz (nakil/bekleme). */
export const NAKIL_ESIK_GUN = 45;

const ertesiGun = (t: string) => new Date(Date.parse(`${t}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const gunFarki = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export type GunlukMinSonuc = {
  deger: number;        // en düşük günlük iş (km ya da saat)
  basTarih: string;     // bu değerin geldiği aralık
  bitTarih: string;
  gun: number;          // aralıktaki çalışma günü
  is: number;           // aralıkta çalışmaya düşen sayaç farkı
  aralikSayisi: number; // değerlendirmeye giren aralık sayısı
};

/**
 * Aracın geçmişteki EN DÜŞÜK günlük işi. Değerlendirilecek aralık yoksa null.
 * okumalar: sayaç girilmiş yakıt kayıtları (sıra önemli değil, burada sıralanır).
 */
export function hesaplaGunlukMin(okumalar: Okuma[], gunler: GunDurum): GunlukMinSonuc | null {
  const sirali = okumalar
    .filter((o) => (o.km_saat ?? 0) > 0)
    .sort((a, b) => `${a.tarih}T${a.saat ?? ""}`.localeCompare(`${b.tarih}T${b.saat ?? ""}`));
  let en: GunlukMinSonuc | null = null;
  let sayi = 0;
  for (let i = 1; i < sirali.length; i++) {
    const onceki = sirali[i - 1], bu = sirali[i];
    const fark = (bu.km_saat ?? 0) - (onceki.km_saat ?? 0);
    if (fark <= 0) continue;                                  // sayaç geri gitmiş/durmuş
    if (gunFarki(onceki.tarih, bu.tarih) > NAKIL_ESIK_GUN) continue;   // nakil/bekleme
    let calisma = 0, dis = 0;
    for (let t = ertesiGun(onceki.tarih); t <= bu.tarih; t = ertesiGun(t)) {
      const d = gunler.get(t);
      if (d === "calisti") calisma += 1;
      else if (d === "yarim_gun") calisma += 0.5;
      else if (d === "dis_gorev") dis += 1;
    }
    if (calisma <= 0) continue;                               // bölecek çalışma günü yok
    const is = dis > 0 ? fark * (calisma / (calisma + dis)) : fark;
    const gunluk = is / calisma;
    sayi++;
    if (!en || gunluk < en.deger) en = { deger: gunluk, basTarih: onceki.tarih, bitTarih: bu.tarih, gun: calisma, is, aralikSayisi: 0 };
  }
  if (en) en.aralikSayisi = sayi;
  return en;
}

/** Ekranda/eşikte kullanılacak yuvarlanmış değer: saat 0,5'e, km 1'e yuvarlanır; en az 1. */
export function yuvarlaGunlukMin(deger: number, sayacTipi: "km" | "saat"): number {
  return sayacTipi === "saat" ? Math.max(0.5, Math.round(deger * 2) / 2) : Math.max(1, Math.round(deger));
}
