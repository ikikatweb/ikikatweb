// SGK İŞYERİ SİCİL — saf yardımcılar. IMAP/DB/Node bağımlılığı YOK → hem sunucu sync'i (bildirge-fetch)
// hem client (dashboard: getBekleyenBildirgeler) güvenle import eder. bildirge-fetch bunları re-export eder.

// SGK işyeri sicil no — grup: mahiyet(1) işkolu(4) ünite(2) sıra(7) il(3) ilçe(2) aracı(2) [kontrol(3)].
// Örnek (çıkış): "4 4100 01 1070267 060 04 67 000". Boşluk ZORUNLU (\s+): giriş formunda önünde kişinin
// 10 haneli SGK no'su var; \s* olsa gürültüye kayar. KONTROL grubu (000) OPSİYONEL: çıkış 8 grup verir,
// GİRİŞ formu son "000"i düşürür ("...64 5120.10") → 7 grupla da eşleşir.
const ISYERI_SICIL_RE = /(\d)\s+(\d{4})\s+(\d{2})\s+(\d{7})\s+(\d{3})\s+(\d{2})\s+(\d{2})(?:\s+(\d{3}))?(?!\d)/;

// `norm`: trUpper + boşluk teke inmiş metin. Dönüş: tek boşluklu sicil ("4 4100 ...") | null.
export function isyeriSicili(norm: string): string | null {
  const m = norm.match(ISYERI_SICIL_RE);
  return m ? m.slice(1).filter(Boolean).join(" ") : null; // opsiyonel grup boşsa (giriş) undefined'ı at
}

// Karşılaştırma: yalnız rakamlar
export const sicilDuz = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// Sicil AYIRT EDİCİ ÇEKİRDEĞİ: işkolu(4) + sıra(7) + il(3) + ilçe(2) + aracı(2). Kullanıcı işçilik takibine
// PDF'ten farklı biçim girebiliyor (fazladan "01" grubu / tire) + giriş formu kontrolü düşürür → bu 5 alan
// işyerini benzersiz belirler; ünite/kontrol/biçim farkı yok sayılır, gerçek fark (sıra/il typo) yakalanır.
export function sicilCekirdek(s: string | null): string | null {
  const g = (s ?? "").match(/\d+/g) ?? [];
  const i7 = g.findIndex((x) => x.length === 7);          // işyeri sıra no = tek 7 haneli grup
  if (i7 < 1) return null;                                // önünde en az işkolu olmalı
  const isKolu = [...g.slice(0, i7)].reverse().find((x) => x.length === 4); // sıra öncesi son 4-haneli
  const sonra = g.slice(i7 + 1);                          // sıra sonrası: il(3) ilçe(2) aracı(2) [kontrol(3)]
  if (!isKolu || sonra.length < 3) return null;
  return [isKolu, g[i7], sonra[0], sonra[1], sonra[2]].join("|");
}

// İki sicil aynı işyeri mi? Çekirdek ayrıştırılabiliyorsa çekirdek eşitliği; değilse yalnız rakam eşitliği.
export function sicilEslesir(a: string | null, b: string | null): boolean {
  const ca = sicilCekirdek(a), cb = sicilCekirdek(b);
  if (ca && cb) return ca === cb;
  return sicilDuz(a).length > 0 && sicilDuz(a) === sicilDuz(b);
}
