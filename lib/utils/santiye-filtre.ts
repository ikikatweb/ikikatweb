// Kısıtlı kullanıcı şantiye filtreleme yardımcısı
// - Kısıtlı kullanıcı sadece atandığı şantiyeleri görebilir
// - Tek şantiye atandıysa otomatik seçilir
// - Yönetici tüm şantiyeleri görebilir

type SantiyeLike = { id: string; is_adi: string };
type KullaniciMinimal = { rol: string; santiye_ids: string[] } | null;

// Kullanıcının görebileceği şantiyeleri filtrele (generic — orijinal tipi korur)
export function filtreliSantiyeler<T extends SantiyeLike>(
  tumSantiyeler: T[],
  kullanici: KullaniciMinimal,
): T[] {
  if (!kullanici) return tumSantiyeler;
  if (kullanici.rol === "yonetici") return tumSantiyeler;
  if (!kullanici.santiye_ids || kullanici.santiye_ids.length === 0) return [];
  const izinli = new Set(kullanici.santiye_ids);
  return tumSantiyeler.filter((s) => izinli.has(s.id));
}

// Tek şantiye atandıysa otomatik seçilecek ID, yoksa ""
export function otomatikSantiyeId<T extends SantiyeLike>(
  tumSantiyeler: T[],
  kullanici: KullaniciMinimal,
): string {
  if (!kullanici) return "";
  if (kullanici.rol === "yonetici") return "";
  if (!kullanici.santiye_ids || kullanici.santiye_ids.length !== 1) return "";
  // Tek şantiye ve o şantiye listede var mı kontrol
  const tekId = kullanici.santiye_ids[0];
  if (tumSantiyeler.some((s) => s.id === tekId)) return tekId;
  return "";
}
