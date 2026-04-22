// Kısıtlı kullanıcı için tarih kontrolü
// Her modül için 2 sınır: "islem" (yazma/düzenleme) ve "goruntuleme" (okuma/listeleme)
// Yönetici her zaman true döner.

type KullaniciIzinLite = {
  rol: string;
  geriye_donus_gun: number | null; // legacy
  puantaj_islem_gun?: number | null;
  puantaj_goruntuleme_gun?: number | null;
  yakit_islem_gun?: number | null;
  yakit_goruntuleme_gun?: number | null;
  kasa_islem_gun?: number | null;
  kasa_goruntuleme_gun?: number | null;
  santiye_defteri_islem_gun?: number | null;
  santiye_defteri_goruntuleme_gun?: number | null;
} | null;

export type IzinModul = "puantaj" | "yakit" | "kasa" | "santiye_defteri";
export type IzinMod = "islem" | "goruntuleme";

function modulGunSayisi(
  kullanici: NonNullable<KullaniciIzinLite>,
  modul: IzinModul,
  mod: IzinMod,
): number {
  const key = `${modul}_${mod}_gun` as keyof NonNullable<KullaniciIzinLite>;
  const v = kullanici[key];
  if (typeof v === "number") return v;
  // Fallback: legacy alan veya 2
  return kullanici.geriye_donus_gun ?? 2;
}

export function tarihIzinliMi(
  kullanici: KullaniciIzinLite,
  tarihStr: string, // "YYYY-MM-DD"
  modul?: IzinModul,
  mod: IzinMod = "islem", // varsayılan işlem kontrolü
): boolean {
  if (!kullanici) return true;
  if (kullanici.rol === "yonetici") return true;
  const gunLimit = modul
    ? modulGunSayisi(kullanici, modul, mod)
    : (kullanici.geriye_donus_gun ?? 2);
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  const tarih = new Date(tarihStr + "T00:00:00");
  const farkMs = bugun.getTime() - tarih.getTime();
  const farkGun = Math.floor(farkMs / (1000 * 60 * 60 * 24));
  return farkGun <= gunLimit;
}

// En eski izinli tarihi döndür — filtreler için
export function enEskiIzinliTarih(
  kullanici: KullaniciIzinLite,
  modul?: IzinModul,
  mod: IzinMod = "goruntuleme",
): string | null {
  if (!kullanici) return null;
  if (kullanici.rol === "yonetici") return null;
  const gunLimit = modul
    ? modulGunSayisi(kullanici, modul, mod)
    : (kullanici.geriye_donus_gun ?? 2);
  const bugun = new Date();
  bugun.setHours(0, 0, 0, 0);
  bugun.setDate(bugun.getDate() - gunLimit);
  const y = bugun.getFullYear();
  const m = String(bugun.getMonth() + 1).padStart(2, "0");
  const d = String(bugun.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
