// YER TUTUCU DENETİMİ — şablon metinlerindeki {plaka} {tip} gibi alanları doğrular.
//
// NEDEN: 05.11.2026'da poliçeleştirme şablonuna "{gonderen" diye kapanış parantezi
// eksik yazıldı. Kod bunu bir yer tutucu olarak tanımadığı için metne OLDUĞU GİBİ
// bastı — acenteye "İyi çalışmalar.\n{gonderen\nAhmet Can KILINÇ" gidiyordu ve
// kaydeden kişi bunu hiçbir yerde göremiyordu. Artık KAYDEDİLMİYOR.

/** Metinde bozuk/tanınmayan yer tutucu varsa anlatan bir cümle, yoksa null. */
export function yerTutucuHatasi(metin: string, gecerli: string[]): string | null {
  const liste = gecerli.map((g) => `{${g}}`).join(", ");
  // Kapanmamış: { var ama ardından } gelmiyor
  const acik = metin.match(/\{(?![^{}]*\})[^\s{}]{0,24}/);
  if (acik) return `Kapanmamış yer tutucu: "${acik[0]}" — sonuna } koymalısınız. Geçerli olanlar: ${liste}`;
  // Açılmamış: } var ama öncesinde { yok
  const kapali = metin.match(/(?<!\{[^{}]{0,40})\}/);
  if (kapali) return `Başında { olmayan bir } var — yer tutucular {şöyle} yazılır. Geçerli olanlar: ${liste}`;
  for (const m of metin.matchAll(/\{([^{}]*)\}/g)) {
    if (!gecerli.includes(m[1])) return `Tanınmayan yer tutucu: "{${m[1]}}" — geçerli olanlar: ${liste}`;
  }
  return null;
}
