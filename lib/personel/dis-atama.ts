// TEKNİK ROLÜ BORDRO DIŞINDAN DOLDURANLAR (santiyeler.teknik_dis_atama)
//
// Firma sahibi/yetkilisi sigortalanamadığı için şantiyeye personel ataması AÇILMAZ; rolü
// yine de o dolduruyor. Kayıt şantiyenin teknik_dis_atama alanında tutulur.
//
// Saf yardımcılar: hem Bordro Takibi ekranı hem ana ekrandaki "teknik personel ataması
// gerekiyor" uyarısı aynı kuralı kullansın diye burada. Uyarı eskiden yalnız
// personel_teknik satırlarını sayıyordu; bordro kartı rolü dolu gösterirken uyarı
// "gereken 4, atanan 3" demeye devam ediyordu.

export type DisAtamaKayit = { ad: string; giris: string; cikis?: string | null };

/** Alan üç biçimde karşımıza çıkabiliyor (eski kayıtlar): düz metin, tek nesne, dizi. */
export function disAtamaGecmis(v: unknown): DisAtamaKayit[] {
  if (!v) return [];
  if (typeof v === "string") return v.trim() ? [{ ad: v.trim(), giris: "", cikis: null }] : [];
  if (Array.isArray(v)) return (v as DisAtamaKayit[]).filter((x) => x?.ad?.trim());
  const o = v as { ad?: string; tarih?: string | null };
  return o.ad?.trim() ? [{ ad: o.ad.trim(), giris: o.tarih ?? "", cikis: null }] : [];
}

/** Rol listesinde AYNI AD birden çok kez geçebiliyor → anahtar "ad#sıra". */
export const disAtamaAnahtar = (isim: string, idx: number) => `${isim}#${idx}`;

/** (isim, idx) rolünün dış atama geçmişi. Eski kayıtlar yalnız rol adıyla anahtarlı;
 *  o kayıt adın listedeki İLK sırasına ait sayılır (aksi hâlde aynı adlı tüm rolleri
 *  birden doldururdu). Böylece veri taşımaya gerek kalmıyor. */
export function disAtamaGecmisFor(
  disAtama: Record<string, unknown>,
  roller: string[],
  isim: string,
  idx: number,
): DisAtamaKayit[] {
  const indeksli = disAtama[disAtamaAnahtar(isim, idx)];
  if (indeksli !== undefined) return disAtamaGecmis(indeksli);
  if (idx === roller.indexOf(isim) && disAtama[isim] !== undefined) {
    return disAtamaGecmis(disAtama[isim]);
  }
  return [];
}

/** Rol VERİLEN GÜNDE dolu mu? Girişi o günden önce başlamış ve çıkışı verilmemiş
 *  ya da o günden sonraysa doludur. Girişi boş eski kayıtlar "hep vardı" sayılır. */
export function disAtamaDoluMu(kayitlar: DisAtamaKayit[], gun: string): DisAtamaKayit | null {
  return kayitlar.find((k) => (!k.giris || k.giris <= gun) && (!k.cikis || k.cikis > gun)) ?? null;
}

/** Şantiyede o gün dış atamayla DOLU olan rol sayısı. */
export function disAtamaDoluRolSayisi(
  disAtama: Record<string, unknown> | null | undefined,
  roller: string[] | null | undefined,
  gun: string,
): number {
  if (!disAtama || !roller?.length) return 0;
  let n = 0;
  for (let i = 0; i < roller.length; i++) {
    if (disAtamaDoluMu(disAtamaGecmisFor(disAtama, roller, roller[i], i), gun)) n++;
  }
  return n;
}
