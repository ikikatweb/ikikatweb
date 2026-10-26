// Storage dosyaları için oturumlu geçit adresi.
//
// Bucket'lar ÖZEL (private). Veritabanındaki genel-URL'ler olduğu gibi duruyor; görüntülerken
// /api/dosya geçidinden geçilir, geçit oturumu doğrulayıp kısa ömürlü imzalı adrese yönlendirir.
//
// İSTİSNA — haberler: kurumsal sitede (oturumsuz) gösterildiği için o bucket genel kalır ve
// haber görselleri bu sarmalayıcıdan GEÇİRİLMEZ.

/** Kayıtlı Storage URL'ini oturumlu geçit adresine çevirir. Boş/yabancı adres olduğu gibi döner. */
export function dosyaUrl(u: string | null | undefined): string {
  if (!u) return "";
  // Zaten geçitten geçiyorsa ya da yerel/veri adresiyse dokunma.
  if (u.startsWith("/api/dosya") || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("/")) return u;
  if (!/\/storage\/v1\/object\//.test(u)) return u;   // Storage adresi değil → olduğu gibi
  return `/api/dosya?u=${encodeURIComponent(u)}`;
}
