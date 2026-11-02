/**
 * Acente adına göre SABİT renk. Listede çoğu satır aynı acenteden geliyor; ad düz gri
 * yazıldığında hangisinin kimden olduğu ancak okunarak anlaşılıyordu. Renk ada göre
 * hesaplanır (kayıt tutulmaz), aynı acente HER EKRANDA aynı rengi alır — bu yüzden
 * burada, tek yerde duruyor.
 */
const ACENTE_RENKLERI = [
  "bg-indigo-100 text-indigo-800 border-indigo-300",
  "bg-rose-100 text-rose-800 border-rose-300",
  "bg-amber-100 text-amber-800 border-amber-300",
  "bg-teal-100 text-teal-800 border-teal-300",
  "bg-violet-100 text-violet-800 border-violet-300",
  "bg-sky-100 text-sky-800 border-sky-300",
  "bg-lime-100 text-lime-800 border-lime-300",
  "bg-orange-100 text-orange-800 border-orange-300",
  "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300",
  "bg-cyan-100 text-cyan-800 border-cyan-300",
];

export function acenteRengi(ad: string): string {
  let h = 0;
  for (let i = 0; i < ad.length; i++) h = (h * 31 + ad.charCodeAt(i)) >>> 0;
  return ACENTE_RENKLERI[h % ACENTE_RENKLERI.length];
}
