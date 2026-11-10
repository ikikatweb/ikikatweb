// TARAYICIDAN KONUM ALMA VE İKİ KONUM ARASI MESAFE.
//
// NEREDE KULLANILIYOR: yakıt kaydı (kaydı girenin konumu, zorunlu) ve o konumun
// aracın Arvento konumuyla karşılaştırılması.
//
// ══ GİZLİCE ALINAMAZ ══
// Tarayıcı kullanıcıya izin penceresi gösterir; izin verilmeden konum gelmez.
// Reddedilirse site ayarlarından açılması gerekir (telefonda Ayarlar → Safari/
// Chrome → Konum). Bu yüzden hata metinleri NE YAPILACAĞINI söylüyor.
//
// ══ ARKA PLANDA TAKİP YOK ══
// Burada alınan şey "kullanıcı gün boyu nerede gezdi" değil, "bu kaydı girerken
// neredeydi". Uygulama kapalıyken tarayıcıdan konum alınamaz.

export type Konum = {
  lat: number;
  lng: number;
  /** Sapma payı (metre). Mesafe HER ZAMAN bununla birlikte okunur. */
  dogruluk: number;
  /** Konumun ÖLÇÜLDÜĞÜ an (ISO) — kaydın kaydedildiği an değil. */
  an: string;
};

/** Kullanıcıya gösterilecek sebep; sessiz başarısızlık yok. */
export class KonumHatasi extends Error {
  /**
   * İZİN PENCERESİ HİÇ ÇIKMADI MI?
   *
   * Reddedilme iki türlü oluyor ve ikisi aynı hata koduyla (code 1) geliyor:
   *   · kullanıcı pencereyi görüp "İzin Verme"ye bastı  → saniyeler sürer
   *   · ayar zaten kapalı, pencere HİÇ ÇIKMADI          → anında döner
   * İkincisinde kullanıcı "bana sormadı bile" diyor ve haklı (10.11.2026:
   * iPhone'da Ayarlar → Safari → Konum "Reddet"te duruyordu). Süreyi ölçüp
   * ayırt ediyoruz: yarım saniyeden kısa sürede gelen ret, sorulmamış demektir.
   */
  sorulmadi?: boolean;
  constructor(mesaj: string, sorulmadi = false) { super(mesaj); this.sorulmadi = sorulmadi; }
}

/**
 * Konumu bir kez ölç.
 *
 * YÜKSEK DOĞRULUK AÇIK: pompa ile aracın arasındaki fark metrelerle ölçülüyor;
 * baz istasyonu konumu (1 km sapma) bu işe yaramaz. Bedeli birkaç saniye ve
 * biraz pil.
 *
 * @param saniye Bekleme sınırı. Telefon GPS'i soğukken 10 sn'yi bulabiliyor.
 */
export function konumAl(saniye = 20): Promise<Konum> {
  return new Promise((coz, red) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      red(new KonumHatasi("Bu cihaz/tarayıcı konum vermiyor. Yakıt kaydı için konum zorunlu."));
      return;
    }
    // ══ GÜVENLİ BAĞLAM ŞART ══
    // Tarayıcılar konumu yalnız https'te (ve aynı makinedeki localhost'ta) verir.
    // Telefondan geliştirme sunucusuna IP ile bağlanınca (http://192.168.x.x:3000)
    // izin penceresi HİÇ çıkmaz, istek doğrudan reddedilir — kullanıcı "izin
    // vermedim ki" diye düşünür. Sebep açıkça söyleniyor.
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      red(new KonumHatasi(
        "Bu sayfa güvenli bağlantıda değil (http). Tarayıcılar konumu yalnız https "
        + "adreslerde veriyor. Panele telefondan girerken ikikat.net adresini kullanın."));
      return;
    }
    const basladi = Date.now();
    navigator.geolocation.getCurrentPosition(
      (p) => coz({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        // accuracy tarayıcıya göre gelmeyebilir; gelmiyorsa 0 değil, bilinmiyor
        // sayılır ve kayıtta boş kalır (0 "kusursuz ölçüm" diye okunurdu).
        dogruluk: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : -1,
        an: new Date(p.timestamp || Date.now()).toISOString(),
      }),
      (h) => {
        // SEBEP KULLANICIYA ANLAŞILIR DİLDE: "code 1" kimseye bir şey söylemiyor.
        if (h.code === h.PERMISSION_DENIED) {
          // SORULDU MU, SORULMADI MI? Pencereyi görüp reddetmek insan tepkisi
          // ister (saniyeler); ayar kapalıyken ret ANINDA döner.
          const sorulmadi = Date.now() - basladi < 500;
          red(new KonumHatasi(sorulmadi
            ? "Telefonunuz size SORMADI bile — konum ayarı kapalı olduğu için istek "
              + "doğrudan reddedildi. Aşağıdaki adımlarla ayarı açın."
            : "Konum izni verilmedi. Yakıt kaydı için konum zorunlu — izin penceresinde "
              + "'İzin Ver' deyin ya da aşağıdaki adımlarla ayarı açın.",
            sorulmadi));
        } else if (h.code === h.POSITION_UNAVAILABLE) {
          red(new KonumHatasi("Konum alınamadı (sinyal yok). Açık alana çıkıp tekrar deneyin."));
        } else if (h.code === h.TIMEOUT) {
          red(new KonumHatasi(`Konum ${saniye} saniyede alınamadı. Tekrar deneyin.`));
        } else {
          red(new KonumHatasi(h.message || "Konum alınamadı."));
        }
      },
      { enableHighAccuracy: true, timeout: saniye * 1000, maximumAge: 0 },
    );
  });
}

/**
 * İki konum arası KUŞBAKIŞI mesafe (metre) — haversine.
 *
 * Yol mesafesi değil, düz çizgi. Yakıt kontrolü için istenen de bu: "aynı yerde
 * miydiler" sorusu kuşbakışı sorulur.
 */
export function mesafeM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;                       // dünya yarıçapı (m)
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

/**
 * ARAÇ KONUMU NE KADAR ESKİYSE GÜVENİLMEZ.
 *
 * Arvento cihazı kontak kapalıyken seyrek haber veriyor; elimizdeki tabloda son
 * ölçümü 12 gün önce olan cihaz bile var. Eski bir ölçümle mesafe hesaplayıp
 * "araç 40 km uzaktaydı" demek, insanı yok yere suçlamak olur.
 */
export const ARAC_KONUM_TAZELIK_DK = 60;

/**
 * Mesafe hangi noktadan sonra "bakılmalı" sayılsın?
 *
 * 500 m: pompa ile aracın park yeri arasındaki makul mesafe (istasyon alanı,
 * şantiye içi dolum) bunun altında kalır. Telefonun sapma payı da hesaba
 * katılıyor — dogruluk 800 m ise 600 m'lik fark işaretlenmez.
 */
export const YAKIT_MESAFE_ESIK_M = 500;

/** Mesafe şüpheli mi? Sapma payı mesafeyi açıklıyorsa şüpheli SAYILMAZ. */
export function mesafeSupheliMi(mesafeM: number | null, dogrulukM: number | null): boolean {
  if (mesafeM == null) return false;
  const pay = dogrulukM != null && dogrulukM > 0 ? dogrulukM : 0;
  return mesafeM - pay > YAKIT_MESAFE_ESIK_M;
}

/**
 * TARAYICI İZNİ HANGİ DURUMDA? (destekleyen tarayıcılarda)
 *
 * NİYE GEREKLİ: konum alınamadığında iki apayrı sebep aynı hata koduyla
 * geliyor (code 1):
 *   · site izni REDDEDİLMİŞ        → tarayıcı ayarından açılır
 *   · telefonun KONUM SERVİSİ kapalı → işletim sistemi ayarından açılır
 * İkisine de "daha önce reddettiyseniz" demek, reddetmemiş kullanıcıyı yanlış
 * yere gönderiyordu. iOS Safari bu API'yi desteklemiyor → "bilinmiyor".
 */
export async function izinDurumu(): Promise<"verildi" | "reddedildi" | "sorulacak" | "bilinmiyor"> {
  try {
    const p = (navigator as unknown as { permissions?: { query: (o: { name: string }) => Promise<{ state: string }> } }).permissions;
    if (!p?.query) return "bilinmiyor";
    const s = await p.query({ name: "geolocation" });
    return s.state === "granted" ? "verildi" : s.state === "denied" ? "reddedildi" : "sorulacak";
  } catch { return "bilinmiyor"; }
}

/**
 * CİHAZA GÖRE AÇMA ADIMLARI — "ayarlardan açın" demek yetmiyor, nereden
 * açılacağı telefona göre değişiyor ve kullanıcı bulamıyor.
 */
export function konumAcmaAdimlari(): { baslik: string; adimlar: string[] } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    // iOS'TA WEB SİTESİ UYGULAMA DEĞİLDİR: Konum Servisleri listesinde panelin
    // adı ARANMAZ, siteler Safari'nin altında yönetilir. En sık sebep de ilk
    // madde: Safari'nin kendi konum ayarı "Reddet"te olunca HİÇBİR site
    // soramıyor — kullanıcı "bana hiç sormadı" diyor, haklı (10.11.2026).
    return {
      baslik: "iPhone'da konumu açma",
      adimlar: [
        "Ayarlar → Safari → (aşağı inin) Konum → \"Sor\" ya da \"İzin Ver\" olmalı. "
          + "\"Reddet\" ise hiçbir site konum soramaz — en sık sebep budur.",
        "Ayarlar → Gizlilik ve Güvenlik → Konum Servisleri: AÇIK olmalı",
        "Aynı listede Safari Web Siteleri → \"Uygulamayı Kullanırken\" + Tam Konum açık",
        "Listede \"İkikat/Kad-Tem\" ARAMAYIN: web siteleri uygulama olarak görünmez, "
          + "Safari altında yönetilir. (Paneli ana ekrana eklediyseniz, bir kez izin "
          + "istedikten SONRA kendi adıyla listeye düşer.)",
        "Sonra bu sayfayı yenileyip tekrar \"Konumu aç\" deyin",
      ],
    };
  }
  if (/Android/i.test(ua)) {
    return {
      baslik: "Android'de konumu açma",
      adimlar: [
        "Telefon ayarları → Konum: AÇIK olmalı",
        "Ayarlar → Uygulamalar → Chrome → İzinler → Konum: izin verin",
        "Chrome'da adres çubuğundaki kilit simgesi → İzinler → Konum → İzin ver",
        "Sonra bu sayfayı yenileyip tekrar \"Konumu aç\" deyin",
      ],
    };
  }
  return {
    baslik: "Tarayıcıda konumu açma",
    adimlar: [
      "Adres çubuğundaki kilit simgesine dokunun",
      "Site ayarları → Konum → İzin ver",
      "Sayfayı yenileyip tekrar \"Konumu aç\" deyin",
    ],
  };
}
