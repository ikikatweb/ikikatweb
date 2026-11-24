// SAYFA TANITIM VİDEOLARI — hangi ekranın videosu hangi dosya adıyla aranır.
//
// Kullanıcı panelde herhangi bir yere SAĞ TIKLAYINCA "Sayfayı Tanı" menüsü çıkar; tıklayınca
// bulunduğu ekranın tanıtım videosu küçük pencerede oynar (bkz. components/shared/tanitim-video).
//
// Video dosyaları Supabase Storage'da ÖZEL `tanitim` kovasında durur ve dosya adı buradaki
// `slug` ile aynıdır: ör. "yakit" ekranı → tanitim/yakit.mp4. Kabul edilen uzantılar:
// mp4, webm, m4v, mov. Dosya yoksa pencere bunu açıkça söyler — sessizce boş açılmaz.

export const TANITIM_KOVA = "tanitim";

/** Kovada aranacak uzantılar (küçük harf). */
export const TANITIM_UZANTILAR = ["mp4", "webm", "m4v", "mov"] as const;

/**
 * KARŞILAMA VİDEOSU — bir sayfanın tanıtımı DEĞİL; "bu tanıtım videoları bilgisayardan ve
 * telefondan nasıl izlenir" anlatımı. Girişten sonra bir kez açılır, kullanıcı izleyince
 * bir daha açılmaz (bkz. components/shared/karsilama-videosu).
 * Kovadaki dosya: tanitim/nasil-izlenir.mp4 — dosya yoksa pencere HİÇ açılmaz.
 */
export const KARSILAMA_SLUG = "nasil-izlenir";

export type TanitimSayfa = {
  /** Rota. Alt rotalar (ör. .../yeni, .../[id]/duzenle) bu sayfanın videosunu kullanır. */
  yol: string;
  /** Storage'daki dosya adının uzantısız hâli. */
  slug: string;
  /** Pencere başlığında görünen ekran adı. */
  baslik: string;
};

// Sıra önemli değil: eşleştirme en UZUN yola göre yapılır (bkz. sayfaBul).
export const TANITIM_SAYFALAR: TanitimSayfa[] = [
  { yol: "/dashboard", slug: "panel", baslik: "Ana Panel" },

  // Büro Yönetimi
  { yol: "/dashboard/iscilik-takibi", slug: "iscilik-durum-raporu", baslik: "İşçilik Durum Raporu" },
  { yol: "/dashboard/iscilik-takibi/:id", slug: "is-detayi", baslik: "İş Detayı" },
  { yol: "/dashboard/bordro-takibi", slug: "bordro-takibi", baslik: "Bordro Takibi" },
  { yol: "/dashboard/odeme-plani", slug: "odeme-plani", baslik: "Ödeme Planı" },
  { yol: "/dashboard/kredi-kartlari", slug: "kredi-kartlari", baslik: "Kredi Kartları" },
  { yol: "/dashboard/icra", slug: "icra-dosyalari", baslik: "İcra Dosyaları" },
  { yol: "/dashboard/ihale", slug: "sinir-deger-hesabi", baslik: "Sınır Değer Hesabı" },

  // Yazışmalar
  { yol: "/dashboard/yazismalar/e-tebligat", slug: "tebligatlar", baslik: "Tebligatlar" },
  { yol: "/dashboard/yazismalar/gelen-evrak", slug: "gelen-evrak", baslik: "Gelen Evrak" },
  { yol: "/dashboard/yazismalar/giden-evrak", slug: "giden-evrak", baslik: "Giden Evrak" },
  { yol: "/dashboard/yazismalar/banka-yazismalari", slug: "banka-yazismalari", baslik: "Banka Yazışmaları" },
  { yol: "/dashboard/yazismalar/silinen", slug: "silinen-yazismalar", baslik: "Silinen Yazışmalar" },

  // Kasko & Sigorta
  { yol: "/dashboard/araclar/sigorta-muayene", slug: "kasko-arac-listesi", baslik: "Kasko & Sigorta — Araç Listesi" },
  { yol: "/dashboard/araclar/acente-takip", slug: "kasko-belgeler", baslik: "Kasko & Sigorta — Belgeler" },
  { yol: "/dashboard/araclar/acente-raporu", slug: "acente-raporu", baslik: "Acente Raporu" },

  // Araç Takip
  { yol: "/dashboard/araclar/arvento-raporu", slug: "arac-calisma-raporu", baslik: "Araç Çalışma Raporu" },

  // Maliyet / Bakım / Puantaj
  { yol: "/dashboard/maliyet-raporu", slug: "sezon-maliyeti", baslik: "Sezon Maliyeti" },
  { yol: "/dashboard/arac-bakim/arac-listesi", slug: "bakim-arac-listesi", baslik: "Araç Bakım — Araç Listesi" },
  { yol: "/dashboard/arac-bakim", slug: "arac-bakim", baslik: "Bakım, Tamirat, Yedek Parça" },
  { yol: "/dashboard/puantaj/personel", slug: "personel-puantaj", baslik: "Personel Puantaj" },
  { yol: "/dashboard/puantaj/arac", slug: "arac-puantaj", baslik: "Araç Puantaj" },

  // Yakıt / Kasa / Şantiye
  { yol: "/dashboard/yakit", slug: "yakit-hareketleri", baslik: "Yakıt Hareketleri" },
  { yol: "/dashboard/kasa-defteri", slug: "kasa-hareketleri", baslik: "Kasa Hareketleri" },
  { yol: "/dashboard/santiye-defteri", slug: "santiye-defteri", baslik: "Şantiye Günlük Kayıtlar" },

  // Ayarlar
  { yol: "/dashboard/yonetim/kullanicilar", slug: "kullanicilar", baslik: "Kullanıcılar" },
  { yol: "/dashboard/yonetim/firmalar", slug: "firmalar", baslik: "Firmalar" },
  { yol: "/dashboard/yonetim/santiyeler", slug: "is-deneyim-belgeleri", baslik: "İş Deneyim Belgeleri" },
  { yol: "/dashboard/yonetim/haberler", slug: "haberler", baslik: "Bizden Haberler" },
  { yol: "/dashboard/yonetim/personel", slug: "personeller", baslik: "Personeller" },
  { yol: "/dashboard/yonetim/araclar", slug: "araclar", baslik: "Araçlar" },
  { yol: "/dashboard/yonetim/araclar/kiralik", slug: "kiralik-araclar", baslik: "Kiralık Araçlar" },
  { yol: "/dashboard/yonetim/yi-ufe", slug: "yi-ufe", baslik: "Yi-ÜFE" },
  { yol: "/dashboard/yonetim/tanimlamalar", slug: "tanimlamalar", baslik: "Tanımlamalar" },
  { yol: "/dashboard/yedek", slug: "veri-yedegi", baslik: "Veri Yedeği" },
  { yol: "/dashboard/yonetim/hakkinda", slug: "hakkinda", baslik: "Hakkında" },
  { yol: "/dashboard/bilgilerim", slug: "bilgilerim", baslik: "Bilgilerim" },
];

// En uzun yol önce denensin: "/dashboard/arac-bakim/arac-listesi", "/dashboard/arac-bakim"ten
// önce; "/dashboard" ise en sonda kalıp genel karşılık olur.
const SIRALI = [...TANITIM_SAYFALAR].sort((a, b) => b.yol.length - a.yol.length);

/** "/dashboard/iscilik-takibi/:id" kalıbı gerçek yola uyuyor mu (":" ile başlayan parça her şeyi tutar). */
function kalibaUyuyor(kalip: string, yol: string): boolean {
  const k = kalip.split("/");
  const y = yol.split("/");
  if (k.length !== y.length) return false;
  return k.every((parca, i) => (parca.startsWith(":") ? y[i].length > 0 : parca === y[i]));
}

/**
 * Adres çubuğundaki yola karşılık gelen tanıtım sayfası.
 * Önce birebir/kalıp eşleşmesi aranır (ör. iş detayı, kiralık araçlar kendi videosunu alır),
 * bulunamazsa en yakın ÜST sayfanın videosu kullanılır — "yeni kayıt"/"düzenle" gibi alt
 * ekranlarda üst sayfanın tanıtımı açılır, hiçbir ekran videosuz kalmaz.
 */
export function sayfaBul(pathname: string): TanitimSayfa | null {
  const yol = pathname.replace(/\/+$/, "") || "/dashboard";
  const tam = SIRALI.find((s) => (s.yol.includes(":") ? kalibaUyuyor(s.yol, yol) : s.yol === yol));
  if (tam) return tam;
  return SIRALI.find((s) => !s.yol.includes(":") && yol.startsWith(s.yol + "/")) ?? null;
}

/** Dışarıdan gelen slug'ı doğrular — dosya adı kurgulamadan önce (yol geçişi/enjeksiyon olmasın). */
export function slugGecerli(slug: string): boolean {
  return slug === KARSILAMA_SLUG || TANITIM_SAYFALAR.some((s) => s.slug === slug);
}
