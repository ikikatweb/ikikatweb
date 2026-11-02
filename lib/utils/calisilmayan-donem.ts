// ÇALIŞILMAYAN DÖNEM — şantiyenin her yıl tekrar eden kış/ara dönemi.
//
// Şantiye kaydında yıl YOKTUR, "AA-GG" metni olarak tutulur (sql/santiye_calisilmayan_donem.sql):
// "11-25" = 25 Kasım. Dönem yıl dönümünü sarabilir (25.11 → 05.03). Tek uç girilmişse
// diğer yön açık kabul edilir.
//
// Burası TEK KAYNAK: bordroda satırın gri+italik olması, iş adının yanındaki dönem rozeti
// ve ana ekrandaki "dönem başladı" uyarısı aynı hesabı kullanır.

/** YEREL bugün (YYYY-MM-DD). toISOString() UTC verir, gece yarısı kayması olur. */
export function bugunYerel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "AA-GG" → AAGG sayısı (1125). Geçersizse null. */
function ayGunSayisi(v: string | null | undefined): number | null {
  const [a, g] = (v ?? "").split("-").map(Number);
  return a >= 1 && a <= 12 && g >= 1 && g <= 31 ? a * 100 + g : null;
}

/** Seçili ayın (YYYY-MM) AYI dönem aralığına düşüyor mu? Yalnız AY ölçüsü — gün bakılmaz. */
export function ayCalisilmayanMi(
  bas: string | null | undefined,
  bit: string | null | undefined,
  seciliAy: string,
): boolean {
  const ay = Number(seciliAy.split("-")[1]);
  if (!ay) return false;
  const ayOf = (v: string | null | undefined): number | null => {
    const m = Number((v ?? "").split("-")[0]);
    return m >= 1 && m <= 12 ? m : null;
  };
  const bA = ayOf(bas), tA = ayOf(bit);
  if (bA == null && tA == null) return false;      // hiç geçerli ay yok
  const basAy = bA ?? 1;                            // tek uç girildiyse diğer yön açık
  const bitAy = tA ?? 12;
  return basAy <= bitAy ? (ay >= basAy && ay <= bitAy) : (ay >= basAy || ay <= bitAy);
}

/** Seçili ayda çalışılmayan dönem BAŞLADI mı? (bordroda satırı gri+italik yapan ölçü)
 *
 *  ayCalisilmayanMi yalnız AY'a baktığı için, dönem 25 Kasım'da başlasa bile Kasım'ın
 *  1'inden itibaren herkes gri görünüyordu — henüz çalışılıyorken. Burada GÜNE de bakılır:
 *    - İçinde bulunduğumuz ay  → ayın 1'i ile BUGÜN arasına dönemden bir gün düşüyor mu?
 *    - Geçmiş/gelecek ay      → ayın tamamına bakılır (o ay fiilen dönem içinde geçmiş/geçecek)
 *  İş adının yanındaki dönem rozeti de aynı ölçüyü kullanır: gri satırla birlikte,
 *  tam başlangıç gününde çıkar. */
export function calisilmayanBasladiMi(
  bas: string | null | undefined,
  bit: string | null | undefined,
  seciliAy: string,
  bugun: string = bugunYerel(),
): boolean {
  if (!ayCalisilmayanMi(bas, bit, seciliAy)) return false;
  const [yil, ay] = seciliAy.split("-").map(Number);
  if (!yil || !ay) return false;
  const b = ayGunSayisi(bas) ?? 101;    // tek uç girildiyse diğer yön açık
  const t = ayGunSayisi(bit) ?? 1231;
  const donemde = (gun: number) => {
    const ag = ay * 100 + gun;
    return b <= t ? (ag >= b && ag <= t) : (ag >= b || ag <= t);
  };
  const sonGun = new Date(yil, ay, 0).getDate();
  // Bugün bu ayın içindeyse tarama bugünde durur; değilse ayın tamamı taranır.
  const son = bugun.slice(0, 7) === seciliAy ? Number(bugun.slice(8, 10)) : sonGun;
  for (let g = 1; g <= son; g++) if (donemde(g)) return true;
  return false;
}

/** BUGÜN dönemin içindeyse, İÇİNDE BULUNULAN tekrarın gerçek tarihleri (yıllı).
 *  Dışındaysa null. Yıl dönümünü saran dönemlerde (25.11 → 05.03) başlangıç bir
 *  önceki yıla düşebilir: 2 Ocak'ta dönem 25.11.2026'da başlamış, 05.03.2027'de biter.
 *  Ana ekran uyarısı hem "başladı mı" sorusunu hem de onay anahtarının yılını buradan alır —
 *  dönem her yıl tekrar ettiği için "Anladım" yalnız O YILKİ tekrarı kapatmalı. */
export function aktifDonem(
  bas: string | null | undefined,
  bit: string | null | undefined,
  bugun: string = bugunYerel(),
): { basTarih: string; bitTarih: string } | null {
  const bHam = ayGunSayisi(bas), tHam = ayGunSayisi(bit);
  if (bHam == null && tHam == null) return null;
  const b = bHam ?? 101, t = tHam ?? 1231;
  const yil = Number(bugun.slice(0, 4));
  const bugunAG = Number(bugun.slice(5, 7)) * 100 + Number(bugun.slice(8, 10));
  const aktif = b <= t ? (bugunAG >= b && bugunAG <= t) : (bugunAG >= b || bugunAG <= t);
  if (!aktif) return null;
  // Saran dönemde yıl sonunu geçtiysek başlangıç geçen yıldadır.
  const basYil = b <= t ? yil : (bugunAG >= b ? yil : yil - 1);
  const bitYil = b <= t ? yil : basYil + 1;
  const ag = (yl: number, v: number) =>
    `${yl}-${String(Math.floor(v / 100)).padStart(2, "0")}-${String(v % 100).padStart(2, "0")}`;
  return { basTarih: ag(basYil, b), bitTarih: ag(bitYil, t) };
}
