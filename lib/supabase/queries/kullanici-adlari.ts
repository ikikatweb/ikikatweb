// KULLANICI ADLARI (id → ad soyad) — TEK KAYNAK + KISA ÖNBELLEK.
//
// Kayıtların "kim girdi" sütunu her yerde lazım: giden/gelen evrak, araç bakım, puantaj,
// kasa defteri, şantiye defteri, ana sayfa… Her biri kendi içinde /api/kullanicilar/adlar'ı
// ayrı ayrı çağırıyordu; ana sayfanın tek açılışında aynı istek 3 kez gidiyordu.
//
// Adlar neredeyse hiç değişmez (kullanıcı eklenir ya da adı düzeltilir) ve yalnız GÖSTERİM
// için kullanılır — hesapta, yetkide, süzgeçte yeri yok. Bu yüzden kısa süreli önbellek
// güvenli: en kötü ihtimalle yeni eklenen bir kullanıcının adı birkaç dakika "—" görünür,
// sayfa yenilenince gelir. Yetki sorgusu DEĞİL: API zaten oturuma bakıyor.
//
// Hata önbelleğe GİRMEZ: istek başarısız olursa bir sonraki çağrı yeniden dener.
// (Tek seferlik, önbelleksiz paylaşım için bkz. lib/supabase/istek-paylas.)

export type KullaniciAd = { id: string; ad_soyad: string; aktif?: boolean };

const TAZE_MS = 2 * 60 * 1000;

let onbellek: { ts: number; liste: KullaniciAd[] } | null = null;
let ucustaki: Promise<KullaniciAd[]> | null = null;

/** Ham liste (aktif bayrağı dahil) — kullanıcı seçtiren ekranlar için. */
export async function getKullaniciListesi(): Promise<KullaniciAd[]> {
  if (onbellek && Date.now() - onbellek.ts < TAZE_MS) return onbellek.liste;
  if (ucustaki) return ucustaki;
  ucustaki = (async () => {
    try {
      const res = await fetch("/api/kullanicilar/adlar");
      if (!res.ok) return [];
      const liste = (await res.json()) as KullaniciAd[];
      onbellek = { ts: Date.now(), liste };
      return liste;
    } catch {
      return [];   // ağ hatası → önbelleğe yazma, sonraki çağrı dener
    } finally {
      ucustaki = null;
    }
  })();
  return ucustaki;
}

/**
 * id → ad soyad eşlemesi. Her çağrıda YENİ Map döner: çağıranlar (ör. kasa defteri) kendi
 * kullanıcısını ekleyebilsin, bu ekleme paylaşılan önbelleğe sızmasın.
 */
export async function getKullaniciAdMap(): Promise<Map<string, string>> {
  return new Map((await getKullaniciListesi()).map((k) => [k.id, k.ad_soyad] as const));
}

/** Kullanıcı adı/listesi değiştiren ekranlar çağırır → bir sonraki okuma tazesini alır. */
export function kullaniciAdlariniUnut() {
  onbellek = null;
}
