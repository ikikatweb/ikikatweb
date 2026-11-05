// BELGENİN KENDİ TARİHİNDEKİ ANTETİ
//
// Antet firmaya bağlı tutuluyordu; firma antetini değiştirince GEÇMİŞ bütün yazışmalar
// da yeni antetle açılıyordu (05.11.2026, Kad-Tem–Atılım ortaklığı: nisan–ekim arası
// 30 belge). Artık her antet "şu tarihten itibaren geçerli" kaydıyla saklanıyor
// (sql/firma_antet_gecmisi.sql) ve belge KENDİ TARİHİNDE geçerli olanı basıyor.
//
// Mailler bu seçimi KULLANMAZ: mail bugün gidiyor, firmanın bugünkü (renkli) antetiyle.

export type AntetGecmisSatiri = {
  firma_id: string;
  antet_url: string;
  antet_renkli_url: string | null;
  gecerli_baslangic: string; // "YYYY-MM-DD"
};

/**
 * Verilen firmanın `tarih` günündeki anteti. Geçmişte o tarihe kadar başlamış
 * kayıtların EN YENİSİ seçilir.
 *
 * Kayıt yoksa (ya da tarih bilinmiyorsa) null döner — çağıran taraf firmanın şu anki
 * antetine düşer, yani davranış eskisi gibi kalır.
 */
export function antetSec(
  firmaId: string | null | undefined,
  tarih: string | null | undefined,
  gecmis: AntetGecmisSatiri[],
): { antet_url: string; antet_renkli_url: string | null } | null {
  if (!firmaId || !tarih) return null;
  const gun = String(tarih).slice(0, 10);
  let secili: AntetGecmisSatiri | null = null;
  for (const s of gecmis) {
    if (s.firma_id !== firmaId) continue;
    if (s.gecerli_baslangic > gun) continue;                       // henüz geçerli değil
    if (!secili || s.gecerli_baslangic > secili.gecerli_baslangic) secili = s;
  }
  return secili ? { antet_url: secili.antet_url, antet_renkli_url: secili.antet_renkli_url } : null;
}

/** Sorgudan dönen satırlarda firmalar.antet_url'i belgenin tarihindekiyle değiştirir. */
export function antetiTariheGoreAyarla<
  T extends { firma_id?: string | null; evrak_tarihi?: string | null; firmalar?: { antet_url?: string | null } | null },
>(satirlar: T[], gecmis: AntetGecmisSatiri[]): T[] {
  if (gecmis.length === 0) return satirlar;
  return satirlar.map((s) => {
    const secim = antetSec(s.firma_id, s.evrak_tarihi, gecmis);
    if (!secim || !s.firmalar) return s;
    if ((s.firmalar.antet_url ?? null) === secim.antet_url) return s;
    return { ...s, firmalar: { ...s.firmalar, antet_url: secim.antet_url } };
  });
}
