// İzin yönetimi - Modül listesi, izin kontrolü, URL→modül anahtar dönüşümü
import type { IzinAksiyonu, Izinler } from "@/lib/supabase/types";

// Tüm modüller - sidebar ve izin matrisi bu listeyi kullanır
export type ModulTanim = {
  key: string;
  label: string;
  grup: string;
};

export const MODUL_LISTESI: ModulTanim[] = [
  // Yönetim
  { key: "yonetim-firmalar", label: "Firmalar", grup: "Yönetim" },
  { key: "yonetim-santiyeler", label: "Şantiyeler", grup: "Yönetim" },
  { key: "yonetim-personel", label: "Personeller", grup: "Yönetim" },
  { key: "yonetim-araclar", label: "Araçlar", grup: "Yönetim" },
  { key: "yonetim-yi-ufe", label: "Yi-ÜFE", grup: "Yönetim" },
  { key: "yonetim-tanimlamalar", label: "Tanımlamalar", grup: "Yönetim" },
  // Yazışmalar
  { key: "yazismalar-gelen-evrak", label: "Gelen Evrak", grup: "Yazışmalar" },
  { key: "yazismalar-giden-evrak", label: "Giden Evrak", grup: "Yazışmalar" },
  { key: "yazismalar-banka-yazismalari", label: "Banka Yazışmaları", grup: "Yazışmalar" },
  { key: "yazismalar-silinen", label: "Silinen", grup: "Yazışmalar" },
  // Araçlar
  { key: "araclar-kira-bedeli", label: "Kira Bedeli", grup: "Araçlar" },
  { key: "araclar-sigorta-muayene", label: "Sigorta & Muayene", grup: "Araçlar" },
  { key: "araclar-acente-takip", label: "Acente Takip", grup: "Araçlar" },
  { key: "araclar-acente-raporu", label: "Acente Raporu", grup: "Araçlar" },
  { key: "arac-bakim", label: "Araç Bakım", grup: "Araçlar" },
  // Puantaj
  { key: "puantaj-personel", label: "Personel Puantaj", grup: "Puantaj" },
  { key: "puantaj-arac", label: "Araç Puantaj", grup: "Puantaj" },
  // Tek sayfalar
  { key: "iscilik-takibi", label: "İşçilik Takibi", grup: "Tek Sayfa" },
  { key: "yakit", label: "Yakıt", grup: "Tek Sayfa" },
  { key: "kasa-defteri", label: "Kasa Defteri", grup: "Tek Sayfa" },
  { key: "santiye-defteri", label: "Şantiye Defteri", grup: "Tek Sayfa" },
  // İhale
  { key: "ihale", label: "İhale", grup: "İhale" },
];

// Gruplanmış modül listesi (izin matrisi için)
export function getGrupluModuller(): Record<string, ModulTanim[]> {
  const gruplar: Record<string, ModulTanim[]> = {};
  for (const m of MODUL_LISTESI) {
    if (!gruplar[m.grup]) gruplar[m.grup] = [];
    gruplar[m.grup].push(m);
  }
  return gruplar;
}

// URL path → modül anahtarı: /dashboard/yonetim/firmalar → yonetim-firmalar
export function pathToModuleKey(pathname: string): string | null {
  const clean = pathname.replace(/^\/dashboard\/?/, "");
  if (!clean) return null;

  const segments = clean.split("/");

  // Alt route'ları (yeni, [id]/duzenle, kiralik) ana modüle eşle
  const filtered = segments.filter(
    (s) => s !== "yeni" && s !== "duzenle" && s !== "kiralik" && !s.startsWith("[")
  );

  // UUID segmentlerini kaldır
  const withoutIds = filtered.filter(
    (s) => !/^[0-9a-f]{8}-[0-9a-f]{4}/.test(s)
  );

  if (withoutIds.length === 0) return null;

  // İlk iki segment veya tek segment → anahtar
  const key =
    withoutIds.length >= 2
      ? `${withoutIds[0]}-${withoutIds[1]}`
      : withoutIds[0];

  // Geçerli modül mü kontrol et
  const exists = MODUL_LISTESI.some((m) => m.key === key);
  return exists ? key : null;
}

// URL path → gerekli aksiyon
export function pathToAction(pathname: string): IzinAksiyonu {
  if (pathname.includes("/yeni") || pathname.includes("/kiralik")) return "ekle";
  if (pathname.includes("/duzenle")) return "duzenle";
  return "goruntule";
}

type Rol = "yonetici" | "santiye_admin" | "kisitli";

// İzin kontrolü
// Hem "kisitli" hem "santiye_admin" izin matrisinden geçer; aralarındaki fark
// VERİ KAPSAMINDA: kisitli sadece kendi kayıtlarını görür, santiye_admin
// atandığı şantiyelerin TÜM kullanıcılarının kayıtlarını görür. Modül erişimi
// her iki rol için de "izinler" matrisine göre belirlenir.
export function hasPermission(
  rol: Rol,
  izinler: Izinler,
  moduleKey: string,
  aksiyon: IzinAksiyonu
): boolean {
  // Yönetici her şeye erişebilir
  if (rol === "yonetici") return true;

  // Kullanıcılar modülü sadece yönetici
  if (moduleKey === "yonetim-kullanicilar") return false;

  // Kısıtlı + Şantiye admini: izin matrisi kontrolü
  const modulIzin = izinler[moduleKey];
  if (!modulIzin) return false;

  return modulIzin[aksiyon] === true;
}

// Kullanıcının görebileceği modül anahtarları
export function getAccessibleModuleKeys(
  rol: Rol,
  izinler: Izinler
): Set<string> {
  if (rol === "yonetici") {
    const all = new Set(MODUL_LISTESI.map((m) => m.key));
    all.add("yonetim-kullanicilar");
    return all;
  }

  // Kısıtlı + Şantiye admini: izinler matrisinden gelen modüller
  const keys = new Set<string>();
  for (const m of MODUL_LISTESI) {
    if (izinler[m.key]?.goruntule) {
      keys.add(m.key);
    }
  }
  return keys;
}

// Sidebar href → modül anahtarı (basit dönüşüm)
export function hrefToModuleKey(href: string): string {
  return href.replace("/dashboard/", "").replace(/\//g, "-");
}
