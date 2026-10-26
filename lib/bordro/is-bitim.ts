// İŞİN BİTİM TARİHİ — tek sıralama.
//
// Tarih dört yerden gelebiliyor ve ekranlar ayrı sıra kullanınca ayrışıyordu:
// Bordro kartı türetmeyi (başlangıç + süre) öne alıyor, prim dengesi uyarısı ise
// yalnız şantiye kaydına bakıyordu. Lojman işinde biri 03.11, diğeri 04.11 diyordu.
//
// SIRA (kullanıcı kararı): şantiye kaydına GİRİLEN tarih esastır, türetme yalnız
// o alan boşken devreye girer. Girilen tarih sözleşmeden okunmuş veridir; türetme
// "süre teslim gününden mi ertesi günden mi sayılır" varsayımına dayanır.
//   1) süre uzatımlı nihai tarih
//   2) girilen iş bitim tarihi
//   3) başlangıç + süre (toplam gün, "30+15" gibi yazımlar toplanır)
//   4) işyeri teslim + iş süresi

export type IsBitimGirdi = {
  sureUzatimliTarih?: string | null;
  isBitimTarihi?: string | null;
  baslangicTarihi?: string | null;
  /** "40" ya da "30+15" — toplanır. */
  sureText?: string | null;
  isyeriTeslimTarihi?: string | null;
  isSuresi?: number | null;
};

/** Tarihe gün ekler, YEREL tarihi döndürür. toISOString() UTC+3'te bir gün geri kaydırır. */
function gunEkle(tarih: string, gun: number): string {
  const d = new Date(tarih + "T00:00:00");
  d.setDate(d.getDate() + gun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isBitimHesapla(g: IsBitimGirdi): string | null {
  if (g.sureUzatimliTarih) return g.sureUzatimliTarih;
  if (g.isBitimTarihi) return g.isBitimTarihi;
  if (g.baslangicTarihi && g.sureText) {
    const toplamGun = g.sureText.split("+").reduce((t, p) => t + (parseInt(p.trim()) || 0), 0);
    if (toplamGun > 0) return gunEkle(g.baslangicTarihi, toplamGun - 1);
  }
  if (g.isyeriTeslimTarihi && g.isSuresi && g.isSuresi > 0) {
    return gunEkle(g.isyeriTeslimTarihi, g.isSuresi - 1);
  }
  return null;
}
