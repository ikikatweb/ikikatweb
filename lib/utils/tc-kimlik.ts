// TC Kimlik Numarası doğrulaması.
//
// Neden var: 11.09.2026'da Fatih SOYLU'nun kartı 10535968163 ile açıldı — bu sayı
// geçerli bir TC değil, son hanesi (kontrol hanesi) tutmuyor. Hata fark edilmeyince
// muhasebenin gönderdiği bildirge (doğru TC: 10535968164) bekleyen talebe eşleşemedi
// ve ana sayfadaki uyarıda SGK sicil numarası da boş kaldı — çünkü sicil zinciri
// TC → personel → atama → şantiye → sicil şeklinde ilerliyor ve ilk halka kopmuştu.
// Tek hanelik bir yazım hatası üç yerde birden soruna yol açtı; formda baştan yakalanır.
//
// Kural (Nüfus ve Vatandaşlık İşleri):
//   - 11 hane, sadece rakam, ilk hane 0 olamaz
//   - 10. hane: ((1,3,5,7,9. hanelerin toplamı × 7) − (2,4,6,8. hanelerin toplamı)) mod 10
//   - 11. hane: (ilk 10 hanenin toplamı) mod 10

export function tcGecerliMi(tc: string | null | undefined): boolean {
  const s = (tc ?? "").replace(/\D/g, "");
  if (s.length !== 11) return false;
  if (s[0] === "0") return false;

  const d = [...s].map(Number);
  const tek = d[0] + d[2] + d[4] + d[6] + d[8];   // 1,3,5,7,9. haneler
  const cift = d[1] + d[3] + d[5] + d[7];          // 2,4,6,8. haneler

  const onuncu = ((tek * 7) - cift) % 10;
  if (((onuncu + 10) % 10) !== d[9]) return false;

  const ilkOnToplam = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return (ilkOnToplam % 10) === d[10];
}

// Formda gösterilecek hata metni — geçerliyse null.
export function tcHataMetni(tc: string | null | undefined): string | null {
  const s = (tc ?? "").replace(/\D/g, "");
  if (s.length === 0) return null;                       // boş: "zorunlu" kontrolü ayrı yapılıyor
  if (s.length !== 11) return `${s.length}/11 hane`;
  if (s[0] === "0") return "TC kimlik numarası 0 ile başlayamaz.";
  if (!tcGecerliMi(s)) return "Bu TC kimlik numarası geçersiz — bir hane yanlış girilmiş olabilir.";
  return null;
}
