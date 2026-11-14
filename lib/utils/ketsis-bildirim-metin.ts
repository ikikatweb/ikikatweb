// KETSİS BİLDİRİMİNİN TEK CÜMLESİ:
//   "Emniyet Genel Müdürlüğünden MC10790796 belge numaralı bildirim aldınız"
//
// Eskiden ana sayfadaki kartta ve telefon bildiriminde mailin konusu yazıyordu
// ("KETSİS Tebliğ Bilgilendirme İletisi - BELGE NO[MC1…") — her tebligatta aynı kalıp,
// kimden geldiği okunmuyordu. Ayırt edici olan iki şey var: KURUM ve BELGE NO.
//
// AYNI MANTIK scripts/ketsis-mail-cek.mjs içinde de var (telefon bildirimi oradan
// gidiyor, .mjs bu dosyayı içe alamıyor). Birini değiştiren ötekini de değiştirsin.

/** Kurum adı bundan uzunsa kesilir — telefon bildiriminde satır taşmasın. */
export const KURUM_AZAMI = 45;

const KALIN = "aıou";
const INCE = "eiöü";
const SERT = "fstkçşhp";

/**
 * "-den" eki (çıkma hâli), ünlü ve ünsüz uyumuyla: Müdürlüğü → nden, Başkanlığı → ndan,
 * Dairesi → nden, Başkanlık → tan. Kurum adları neredeyse hep belirtisiz tamlama
 * ("… Müdürlüğü") olduğundan ı/i/u/ü ile bitenlere kaynaştırma "n"si gelir.
 */
export function cikmaEki(ad: string): string {
  const harfler = ad.toLocaleLowerCase("tr").replace(/[^a-zçğıöşü]/g, "");
  if (!harfler) return "den";
  const son = harfler[harfler.length - 1];
  const sonUnlu = [...harfler].reverse().find((h) => KALIN.includes(h) || INCE.includes(h));
  const unlu = sonUnlu && KALIN.includes(sonUnlu) ? "a" : "e";
  if ("ıiuü".includes(son)) return `nd${unlu}n`;
  return `${SERT.includes(son) ? "t" : "d"}${unlu}n`;
}

/**
 * @returns cümle; ne kurum ne belge no varsa null (çağıran eski metne — konuya — düşer).
 */
export function ketsisBildirimCumlesi(kurum?: string | null, belgeNo?: string | null): string | null {
  const k = (kurum ?? "").replace(/\s+/g, " ").trim();
  const b = (belgeNo ?? "").trim();
  if (!k && !b) return null;
  const belge = b ? `${b} belge numaralı bildirim aldınız` : "bildirim aldınız";
  if (!k) return belge.charAt(0).toLocaleUpperCase("tr") + belge.slice(1);
  let ek = cikmaEki(k);
  // Ad BÜYÜK HARFLE yazılmışsa ek de öyle ("EMNİYET GENEL MÜDÜRLÜĞÜNDEN").
  if (k === k.toLocaleUpperCase("tr")) ek = ek.toLocaleUpperCase("tr");
  // Kesilen ada ek yapışmaz ("Gaziosmanpaşa V…nden" okunmuyor) → kesme işaretiyle ayrılır.
  const kurumlu = k.length > KURUM_AZAMI ? `${k.slice(0, KURUM_AZAMI).trimEnd()}…’${ek}` : `${k}${ek}`;
  return `${kurumlu} ${belge}`;
}
