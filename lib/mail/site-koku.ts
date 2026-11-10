// MAİLE KONACAK SİTE ADRESİ — yerelden gönderilen bağlantı kimsenin işine yaramaz.
//
// NİYE: doğrulama/şifre yenileme mailleri bağlantıyı NEXT_PUBLIC_SITE_URL'den,
// o yoksa isteğin geldiği adresten kuruyor. Geliştirme makinesinde istek
// http://localhost:3000'den geldiği için mail "gönderildi" diye dönüyor ama
// içindeki bağlantı alıcının telefonunda AÇILMIYOR (10.11.2026'da bir doğrulama
// maili bu şekilde gitti). Gönderen taraf başarı gördüğü için kimse fark etmiyor.
//
// AGENTS.md "sessiz hata yok": bağlantı kurulamıyorsa mail HİÇ gönderilmez,
// sebebi söylenir.

/** Yerel/çalışmayacak bir adres mi? */
export function yerelAdresMi(kok: string): boolean {
  try {
    const h = new URL(kok).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  } catch {
    return true;   // adres çözülemiyorsa güvenme
  }
}

/**
 * Maile konacak kök adres. Kullanılabilir değilse null döner — çağıran mail
 * göndermeden hata vermeli.
 */
export function mailSiteKoku(request: Request): string | null {
  const kok = (process.env.NEXT_PUBLIC_SITE_URL || "").trim() || new URL(request.url).origin;
  return yerelAdresMi(kok) ? null : kok.replace(/\/+$/, "");
}

/** Kullanıcıya gösterilecek açıklama — ne yapılacağı yazsın. */
export const KOK_YOK_MESAJ =
  "Mail gönderilmedi: bağlantı adresi yerel sunucuyu gösteriyor (localhost). "
  + "Bu bağlantı alıcıda açılmaz. İşlemi canlı siteden yapın.";
