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

// Toplama/çıkarma İFADESİ olarak para değeri: "500+100" → 600, "1.500,50-250" → 1250,5
// Kullanıcı mevcut değerin üzerine ekleme yapabilsin diye (işçilik durum raporunda fiyat farkı,
// keşif artışı vb. hücrelerde). Düz sayı da kabul edilir. Geçersiz ifadede null döner —
// çağıran eski değeri koruyup uyarı gösterebilir.
//
// TR biçimi korunur: nokta BİNLİK ayraç, virgül ONDALIK. Yani "1.500" bin beş yüzdür.
export function paraIfadeHesapla(ham: string): number | null {
  const s = (ham ?? "").replace(/[\s₺]/g, "");
  if (!s) return null;
  // Terimlere ayır: baştaki işaret dahil ("-500+100" → ["-500", "+100"])
  const terimler = s.match(/[+-]?[^+-]+/g);
  if (!terimler) return null;
  let toplam = 0;
  for (const t of terimler) {
    const isaret = t.startsWith("-") ? -1 : 1;
    const govde = t.replace(/^[+-]/, "");
    const temiz = govde.replace(/\./g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(temiz)) return null;   // rakam dışı içerik → geçersiz
    toplam += isaret * parseFloat(temiz);
  }
  return Number.isFinite(toplam) ? toplam : null;
}
