// GÜNLÜK ASGARİ ÇALIŞMANIN VERİDEN HESABI
//
// Araç kartındaki "günlük asgari çalışma" elle girilmezse bu hesap devreye girer:
// aracın geçmişte bir çalışma gününde yaptığı EN DÜŞÜK işin %90'ı (kullanıcı kararı).
// Payın amacı: eşiğin altına ancak daha önce hiç görülmemiş kadar düşük bir gün düşsün.
//
// DİKKAT — ÖLÇÜLMÜŞ SONUÇ: minimum, verinin en bozuk noktasından gelir, %90'ı almak onu
// daha da aşağı çeker. Gerçek veride bu eşikle çalışma açığı uyarısı 60 aralıktan 4'e
// düşüyor; yani tespit pratikte susuyor. Örnek: 60 BP 842'nin eşiği tek bir 1 günlük
// 4 km'lik aralık yüzünden 4 km, 20-00-23-0202'nin eşiği ise tam da uyarı verdiğimiz
// aralıktan gelip 1 saat oluyor. Alt %20'lik dilim denendi (60 aralık / 24 araç) ve
// kullanıcı isteğiyle bu kurala dönüldü. Değiştirmek için MIN_CARPAN'ı ya da
// asagiDilim() çağrısını değiştirmek yeterli.
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
  deger: number;        // alt %20'lik dilimdeki günlük iş (km ya da saat)
  basTarih: string;     // bu değerin geldiği aralık
  bitTarih: string;
  gun: number;          // aralıktaki çalışma günü
  is: number;           // aralıkta çalışmaya düşen sayaç farkı
  aralikSayisi: number; // değerlendirmeye giren aralık sayısı
};

/** En düşük günün kaçta kaçı eşik olur. 0,90 = en düşük günün %90'ı. */
export const MIN_CARPAN = 0.90;
/** Bu sayıdan az aralık varsa hesap yapılmaz — tek iki nokta ölçüt olamaz. */
export const EN_AZ_ARALIK = 3;
/** Fiziksel üst sınır: bir makine günde bundan fazla çalışamaz (bozuk okumaları eler). */
export const SAAT_UST_SINIR = 12;

/**
 * Aracın geçmişteki en düşük günlük işinin %90'ı. Yeterli aralık yoksa null.
 * okumalar: sayaç girilmiş yakıt kayıtları (sıra önemli değil, burada sıralanır).
 */
export function hesaplaGunlukMin(okumalar: Okuma[], gunler: GunDurum, sayacTipi: "km" | "saat" = "km"): GunlukMinSonuc | null {
  const sirali = okumalar
    .filter((o) => (o.km_saat ?? 0) > 0)
    .sort((a, b) => `${a.tarih}T${a.saat ?? ""}`.localeCompare(`${b.tarih}T${b.saat ?? ""}`));
  const adaylar: GunlukMinSonuc[] = [];
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
    // Fiziksel olarak imkânsız okuma (ör. 0,5 günde 31 saat) ölçüte girmesin.
    if (sayacTipi === "saat" && gunluk > SAAT_UST_SINIR) continue;
    adaylar.push({ deger: gunluk, basTarih: onceki.tarih, bitTarih: bu.tarih, gun: calisma, is, aralikSayisi: 0 });
  }
  if (adaylar.length < EN_AZ_ARALIK) return null;   // ölçüt kuracak kadar veri yok
  adaylar.sort((a, b) => a.deger - b.deger);
  const enDusuk = adaylar[0];
  return { ...enDusuk, deger: enDusuk.deger * MIN_CARPAN, aralikSayisi: adaylar.length };
}

/** Ekranda/eşikte kullanılacak yuvarlanmış değer: saat 0,5'e, km 1'e yuvarlanır; en az 1. */
export function yuvarlaGunlukMin(deger: number, sayacTipi: "km" | "saat"): number {
  return sayacTipi === "saat" ? Math.max(0.5, Math.round(deger * 2) / 2) : Math.max(1, Math.round(deger));
}
