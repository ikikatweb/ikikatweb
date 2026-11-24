// Tarayıcı tarafı Supabase client - Client component'larda kullanılır
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// İSTEK ZAMAN AŞIMI — telefonda "her yer gri kalıyor" sorununun çaresi.
//
// Mobil tarayıcılar arka plandaki sekmeyi DONDURUYOR. Uyandığında, donmadan önce
// başlatılmış fetch'ler bazen ne çözülüyor ne de hata veriyor: sonsuza kadar asılı
// kalıyorlar. Ana ekran verilerini Promise.all ile topluca çektiği için TEK asılı istek
// bütün grubu kilitliyor; `finally { setLoading(false) }` hiç çalışmıyor ve iskelet
// (gri kutular) kalıcı oluyor. Sayfayı komple kapatıp açmak düzeltiyordu çünkü yeni
// sayfa yeni istekler açıyor.
//
// Çözüm isteğin kendisinde: belli süre sonra iptal edilir, sorgu HATA döner, çağıran
// taraftaki mevcut `.catch(...)` + `finally` zincirleri çalışır ve ekran kilitlenmez.
// 30 sn bilerek geniş: normal sorgular 1-2 sn; bu sınır yalnız gerçekten asılı kalana
// dokunur, ağır Arvento sorgularını kesmez.
const ISTEK_ZAMAN_ASIMI_MS = 30_000;

function zamanAsimliFetch(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Çağıranın kendi sinyali varsa ona dokunma (iptal mantığı bozulmasın).
  if (init?.signal) return fetch(girdi, init);
  // AbortSignal.timeout eski iOS Safari'de yok → AbortController ile aynı işi yap.
  const kontrolcu = new AbortController();
  const sayac = setTimeout(() => kontrolcu.abort(), ISTEK_ZAMAN_ASIMI_MS);
  return fetch(girdi, { ...init, signal: kontrolcu.signal }).finally(() => clearTimeout(sayac));
}

// AYNI ANDA UÇAN AYNI İSTEĞİ BİRLEŞTİR.
//
// Ana ekranda onlarca bağımsız widget var ve çoğu aynı yardımcı tabloları kendi başına
// çekiyor: açılışta şantiyeler 15, tanımlamalar 6 kez isteniyordu. Telefonda bunların
// her biri ayrı bir tur demek; sayfa gri kutularda bekliyordu.
//
// Burada ÖNBELLEK YOK: yalnız HÂLÂ CEVABI GELMEMİŞ, birebir aynı GET isteği paylaşılır.
// Cevap gelir gelmez kayıt silinir, sonraki istek yeniden sunucuya gider — yani veri
// bayatlamaz, "güncelle" düğmeleri eskisi gibi taze veri çeker.
const ucusanIstekler = new Map<string, Promise<Response>>();

function istekAnahtari(girdi: RequestInfo | URL, init?: RequestInit): string | null {
  const yontem = (init?.method ?? "GET").toUpperCase();
  if (yontem !== "GET") return null;                       // yazma isteği asla birleştirilmez
  const adres = typeof girdi === "string" ? girdi : girdi instanceof URL ? girdi.toString() : girdi.url;
  if (!adres) return null;
  // Başlıklar cevabı değiştirir: sayfalama (Range), sayım/tekil satır (Prefer, Accept).
  const b = new Headers(init?.headers ?? {});
  const ayirt = ["range", "prefer", "accept", "accept-profile", "authorization"]
    .map((h) => `${h}=${b.get(h) ?? ""}`)
    .join("|");
  return `${adres}\n${ayirt}`;
}

function birlestirenFetch(girdi: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const anahtar = istekAnahtari(girdi, init);
  if (!anahtar) return zamanAsimliFetch(girdi, init);

  const ucusan = ucusanIstekler.get(anahtar);
  // Gövde bir kez okunabilir: her çağırana kendi kopyası verilir.
  if (ucusan) return ucusan.then((c) => c.clone());

  const soz = zamanAsimliFetch(girdi, init);
  ucusanIstekler.set(anahtar, soz);
  void soz.finally(() => { ucusanIstekler.delete(anahtar); });
  return soz.then((c) => c.clone());
}

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase bağlantı bilgileri eksik. .env.local dosyasını kontrol edin."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: birlestirenFetch },
  });
}
