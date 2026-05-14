// Kısıtlı kullanıcı şantiye filtreleme yardımcısı
// - Kısıtlı kullanıcı sadece atandığı şantiyeleri görebilir
// - Tek şantiye atandıysa otomatik seçilir
// - Yönetici tüm şantiyeleri görebilir
// - santiyesiz_veri_gor=true → atanmış şantiyeler + şantiye_id NULL olan kayıtlar/araçlar

type SantiyeLike = { id: string; is_adi: string };
type KullaniciMinimal = { rol: string; santiye_ids: string[] } | null;

// Daha kapsamlı kullanıcı tipi (santiyesiz_veri_gor dahil) — kayıt filtreleme için.
type KullaniciVeri = {
  rol: string;
  santiye_ids?: string[] | null;
  santiyesiz_veri_gor?: boolean | null;
} | null | undefined;

// Bir kaydın (santiye_id'si null olabilir) kullanıcıya görünür olup olmadığını döner.
//   - Yönetici → her zaman true
//   - santiye_id null + santiyesiz_veri_gor=true → görünür
//   - santiye_id, kullanıcının atandığı şantiyeler arasında → görünür
//   - Diğer durumlar → gizli
// Pattern: tüm modüllerde filter callback'inde direkt kullanılabilir.
export function kayitGorunur(
  santiyeId: string | null | undefined,
  kullanici: KullaniciVeri,
): boolean {
  if (!kullanici) return true;
  if (kullanici.rol === "yonetici") return true;
  const izinli = new Set(kullanici.santiye_ids ?? []);
  if (santiyeId == null) return !!kullanici.santiyesiz_veri_gor;
  return izinli.has(santiyeId);
}

// Kullanıcının görebileceği santiye_id setini döndürür (NULL özel olarak Set'e konmaz —
// santiyesizDahil bayrağıyla ayrı taşınır). DB sorgularında kullanışlı.
export function izinliKayitFiltre(kullanici: KullaniciVeri): {
  izinliIds: Set<string>;
  santiyesizDahil: boolean;
} | null {
  if (!kullanici || kullanici.rol === "yonetici") return null;
  return {
    izinliIds: new Set(kullanici.santiye_ids ?? []),
    santiyesizDahil: !!kullanici.santiyesiz_veri_gor,
  };
}

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
