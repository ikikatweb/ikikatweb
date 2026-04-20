// Anlık para formatı — yazarken binlik ayraç ve ondalık gösterimi
// 1234567 → "1.234.567"
// 1234567,89 → "1.234.567,89"

// Input değerini formatla (yazarken çağrılır)
// maxOndalik: ondalık basamak sayısı (varsayılan 2, birim fiyat gibi yerlerde 6 kullanılabilir)
export function formatParaInput(value: string, maxOndalik: number = 2): string {
  // Sadece rakam, virgül ve eksi bırak
  let temiz = value.replace(/[^\d,\-]/g, "");

  // Birden fazla virgül varsa ilkini tut
  const parts = temiz.split(",");
  if (parts.length > 2) {
    temiz = parts[0] + "," + parts.slice(1).join("");
  }

  const [tamKisim, ondalikKisim] = temiz.split(",");

  // Tam kısmı binlik ayraçla formatla
  const rakamlar = tamKisim.replace(/^0+(?=\d)/, ""); // baştaki sıfırları kaldır
  const negatif = rakamlar.startsWith("-");
  const pozitif = negatif ? rakamlar.slice(1) : rakamlar;
  const binlikli = pozitif.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  let sonuc = negatif ? "-" + binlikli : binlikli;

  // Ondalık kısmı ekle (varsa)
  if (temiz.includes(",")) {
    const ondalik = (ondalikKisim ?? "").slice(0, maxOndalik);
    sonuc += "," + ondalik;
  }

  return sonuc;
}

// Formatlı değerden sayıya çevir
export function parseParaInput(formatted: string): number {
  if (!formatted || formatted === "-") return 0;
  const temiz = formatted.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(temiz);
  return isNaN(n) ? 0 : n;
}
