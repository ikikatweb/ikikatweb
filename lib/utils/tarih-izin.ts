// Kısıtlı kullanıcı için geriye dönük tarih kontrolü
// Tüm sayfalarda (puantaj, yakıt, yazışmalar, vb.) tarih bazlı işlem sınırı uygulamak için kullanılır.
// Yönetici her zaman true döner. Kısıtlı kullanıcı geriye_donus_gun kadar geriye gidebilir.

export function tarihIzinliMi(
  kullanici: { rol: string; geriye_donus_gun: number | null } | null,
  tarihStr: string, // "YYYY-MM-DD"
): boolean {
  if (!kullanici) return true; // kullanıcı yüklenmemişse izin ver (sayfa daha yükleniyor)
  if (kullanici.rol === "yonetici") return true;
  if (kullanici.geriye_donus_gun == null) return true; // sınırsız
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  const tarih = new Date(tarihStr + "T00:00:00");
  const farkMs = bugun.getTime() - tarih.getTime();
  const farkGun = Math.floor(farkMs / (1000 * 60 * 60 * 24));
  return farkGun <= kullanici.geriye_donus_gun;
}

// Kısıtlı kullanıcının en eski düzenleyebileceği tarihi döndür
// null = sınırsız
export function enEskiIzinliTarih(
  kullanici: { rol: string; geriye_donus_gun: number | null } | null,
): string | null {
  if (!kullanici) return null;
  if (kullanici.rol === "yonetici") return null;
  if (kullanici.geriye_donus_gun == null) return null;
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  bugun.setDate(bugun.getDate() - kullanici.geriye_donus_gun);
  const y = bugun.getFullYear();
  const m = String(bugun.getMonth() + 1).padStart(2, "0");
  const d = String(bugun.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
