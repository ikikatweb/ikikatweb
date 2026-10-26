// SGK PRİM DENGESİ — işin bitimine kadar prim dolacak mı, yoksa çoktan doldu mu?
//
// Eksik kalmak da fazla ödemek de sorun:
//  • Eksik → işin bitiminde yatması gereken prim tamamlanmamış olur.
//  • Fazla → prim dolduğu hâlde sigortalılar durmaya devam eder, boşuna prim ödenir.
//
// Hesap üç büyüklüğe dayanır:
//   kalan prim    = yatması gereken (tahmini FF dâhil) − yatan − tahmini bordro
//   günlük üretim = o işte AKTİF sigortalıların günlük ücret toplamı
//   kalan takvim  = bugünden iş bitimine kadar ÇALIŞILAN günler
//
// Takvim gün gün yürütülür, düz bölme yapılmaz: işlerin çoğunda çalışılmayan dönem var
// (ör. Eskişehir 25.11–05.03) ve düz bölme o kışları yok sayıp dolma tarihini aylarca
// erken gösteriyordu.

export type CalisilmayanDonem = { bas: string | null; bit: string | null }; // "AA-GG"

/** Gün (YYYY-MM-DD) çalışılmayan döneme denk geliyor mu?
 *  Dönem yıldan yıla tekrar eder ve yıl devri yapabilir (12-15 → 04-01). */
export function gunCalisilmayanMi(d: CalisilmayanDonem, gun: string): boolean {
  const { bas, bit } = d;
  if (!bas || !bit) return false;
  const ag = gun.slice(5);              // "AA-GG"
  return bas <= bit
    ? ag >= bas && ag <= bit            // yıl içinde (ör. 06-01 → 09-01)
    : ag >= bas || ag <= bit;           // yıl devri  (ör. 12-15 → 04-01)
}

/** İki tarih arasındaki ÇALIŞILAN gün sayısı (ikisi de dâhil). */
export function calisilanGun(d: CalisilmayanDonem, bas: string, bit: string): number {
  if (bit < bas) return 0;
  let n = 0;
  const t = new Date(bas + "T00:00:00");
  const son = new Date(bit + "T00:00:00");
  while (t <= son) {
    const g = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    if (!gunCalisilmayanMi(d, g)) n++;
    t.setDate(t.getDate() + 1);
  }
  return n;
}

export type DengeGirdi = {
  kalanPrim: number;        // gereken − yatan − tahmini bordro
  gunlukUretim: number;     // aktif sigortalıların günlük ücret toplamı
  kisiBasiUcret: number;    // ortalama günlük ücret (kişi ekleme/çıkarma hesabı için)
  aktifKisi: number;
  teknikKisi: number;       // sözleşme gereği kalması gereken taban
  bugun: string;            // YYYY-MM-DD
  bitim: string;            // YYYY-MM-DD
  calisilmayan: CalisilmayanDonem;
};

export type Denge = {
  durum: "eksik" | "fazla" | "dengede";
  /** İş bitmiş (bitim tarihi geçmiş): prim artık çalışmayla dolmaz, eylem farklıdır. */
  isBitti: boolean;
  kalanPrim: number;
  kalanCalismaGunu: number;
  /** Mevcut kadroyla bitime kadar üretilecek prim. */
  bitimeKadarUretim: number;
  /** Eksikte: kaç kişi EKLENMELİ. Fazlada: kaç kişi ÇIKARILABİLİR. Dengedeyse 0. */
  kisiFarki: number;
  /** Fazlada: şu an gereğinden fazla ödenmiş/ödenecek tutar. */
  fazlaTutar: number;
  /** Mevcut kadroyla primin dolacağı tarih (bitimi aşıyorsa null). */
  dolmaTarihi: string | null;
  /** Teknik personel tabanı yüzünden çıkarılamayan kişi sayısı (bilgi amaçlı). */
  tabanEngeli: number;
};

export function primDengesi(g: DengeGirdi): Denge {
  const { kalanPrim, gunlukUretim, kisiBasiUcret, aktifKisi, teknikKisi, bugun, bitim, calisilmayan } = g;
  const isBitti = bitim < bugun;
  const kalanCalismaGunu = isBitti ? 0 : calisilanGun(calisilmayan, bugun, bitim);
  const bitimeKadarUretim = gunlukUretim * kalanCalismaGunu;

  // PRİM ZATEN DOLMUŞ (ya da fazlası ödenmiş)
  if (kalanPrim <= 0) {
    const cikarilabilir = Math.max(0, aktifKisi - teknikKisi);
    return {
      durum: "fazla", isBitti, kalanPrim, kalanCalismaGunu, bitimeKadarUretim,
      kisiFarki: cikarilabilir, fazlaTutar: -kalanPrim, dolmaTarihi: null,
      tabanEngeli: Math.min(aktifKisi, teknikKisi),
    };
  }

  // Bitime kadar gereken en az kişi sayısı.
  const gerekenKisi = kisiBasiUcret > 0 && kalanCalismaGunu > 0
    ? Math.ceil(kalanPrim / (kisiBasiUcret * kalanCalismaGunu))
    : Infinity;

  // DOLMAYACAK → kişi eklenmeli
  if (!Number.isFinite(gerekenKisi) || gerekenKisi > aktifKisi) {
    return {
      durum: "eksik", isBitti, kalanPrim, kalanCalismaGunu, bitimeKadarUretim,
      kisiFarki: Number.isFinite(gerekenKisi) ? gerekenKisi - aktifKisi : 0,
      fazlaTutar: 0, dolmaTarihi: null, tabanEngeli: 0,
    };
  }

  // ERKEN DOLACAK → kaç kişi şimdi çıkarılabilir (teknik taban korunarak)
  const idealKadro = Math.max(gerekenKisi, teknikKisi);
  const cikarilabilir = Math.max(0, aktifKisi - idealKadro);
  // Dolma tarihi: çalışılan günleri sayarak ilerle.
  let dolmaTarihi: string | null = null;
  if (gunlukUretim > 0) {
    let birikim = 0;
    const t = new Date(bugun + "T00:00:00");
    const son = new Date(bitim + "T00:00:00");
    while (t <= son) {
      const gun = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      if (!gunCalisilmayanMi(calisilmayan, gun)) birikim += gunlukUretim;
      if (birikim >= kalanPrim) { dolmaTarihi = gun; break; }
      t.setDate(t.getDate() + 1);
    }
  }
  return {
    durum: cikarilabilir > 0 ? "fazla" : "dengede",
    isBitti, kalanPrim, kalanCalismaGunu, bitimeKadarUretim,
    kisiFarki: cikarilabilir, fazlaTutar: 0, dolmaTarihi,
    tabanEngeli: Math.max(0, teknikKisi - gerekenKisi),
  };
}
