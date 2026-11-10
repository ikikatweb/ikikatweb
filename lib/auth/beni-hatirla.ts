// BENİ HATIRLA — tek yerden yönetilen kural.
//
// ══ ESKİ HÂLİ TERSİNE ÇALIŞIYORDU ══
// "Beni hatırla" işaretlenince localStorage'a 7 günlük bir SON KULLANMA damgası
// yazılıyor, süre dolunca kullanıcı zorla çıkarılıyordu. İşaretlemeyen kullanıcıda
// ise hiçbir damga olmadığı için oturum süresiz yaşıyordu. Yani kutuyu işaretlemek
// oturumu UZATMIYOR, KISALTIYORDU — kutunun vaadinin tam tersi.
//
// ══ ŞİMDİKİ KURAL ══
//   işaretli    → oturum kalıcı. Hiçbir süre dolumu yok; kullanıcı kendi çıkana ya
//                 da jeton sunucu tarafında geçersiz olana kadar sormaz.
//   işaretsiz   → oturum YALNIZ bu açılış boyunca. Uygulama/sekme kapanıp yeniden
//                 açıldığında çıkış yapılır (sessionStorage işareti gider).
//
// ══ NİYE sessionStorage ══
// "Kapatınca çıksın" sorusunun doğru ölçüsü süre değil, UYGULAMANIN KAPANMASI.
// sessionStorage tam olarak bunu söyler: sekme/uygulama kapanınca silinir. iOS'ta
// ana ekrana eklenmiş uygulamada da aynı şekilde çalışır (uygulamayı kapatmak =
// yeni oturum).
//
// ══ ESKİ KULLANICILAR ══
// Eski anahtarlar (rememberMe/rememberExpiry) okunur ve HATIRLANMIŞ sayılır; kimse
// bu değişiklik yüzünden bir sabah kapı dışında kalmasın. Anahtar hiç yoksa da
// hatırlanmış sayılır — eski davranışın fiilî sonucu buydu.

const HATIRLA = "beni-hatirla";          // localStorage: "1" kalıcı · "0" kapanınca çık
const ACIK = "oturum-acik";              // sessionStorage: bu açılışta giriş yapıldı
const ESKI_HATIRLA = "rememberMe";       // eski anahtarlar — temizlenir
const ESKI_SURE = "rememberExpiry";

/** Giriş başarılı olduğunda çağrılır. */
export function hatirlamayiKaydet(hatirla: boolean): void {
  try {
    localStorage.setItem(HATIRLA, hatirla ? "1" : "0");
    // İşaretsizde de bu açılış boyunca oturum açık kalmalı.
    sessionStorage.setItem(ACIK, "1");
    localStorage.removeItem(ESKI_HATIRLA);
    localStorage.removeItem(ESKI_SURE);
  } catch { /* depolama kapalıysa oturum yine de açılır */ }
}

/**
 * Uygulama açılışında: bu oturum kapatılmalı mı?
 *
 * true yalnız şu hâlde döner: kullanıcı "beni hatırla" dememiş VE uygulama
 * kapanıp yeniden açılmış. Şüphede kalırsan FALSE — kimseyi sebepsiz atma.
 */
export function oturumKapatilmaliMi(): boolean {
  try {
    const secim = localStorage.getItem(HATIRLA);
    if (secim !== "0") {
      // "1", eski anahtar ya da hiçbir şey → hatırlanmış say.
      if (localStorage.getItem(ESKI_HATIRLA) || localStorage.getItem(ESKI_SURE)) {
        localStorage.setItem(HATIRLA, "1");
        localStorage.removeItem(ESKI_HATIRLA);
        localStorage.removeItem(ESKI_SURE);
      }
      return false;
    }
    return sessionStorage.getItem(ACIK) !== "1";
  } catch {
    return false;   // depolama okunamıyorsa çıkış sebebi sayma
  }
}

/** Çıkışta izleri temizle — sonraki giriş kendi seçimiyle başlasın. */
export function hatirlamayiUnut(): void {
  try {
    localStorage.removeItem(HATIRLA);
    sessionStorage.removeItem(ACIK);
    localStorage.removeItem(ESKI_HATIRLA);
    localStorage.removeItem(ESKI_SURE);
  } catch { /* sessiz */ }
}
