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

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase bağlantı bilgileri eksik. .env.local dosyasını kontrol edin."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: zamanAsimliFetch },
  });
}
