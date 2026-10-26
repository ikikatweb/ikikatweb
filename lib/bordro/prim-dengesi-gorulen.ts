// PRİM DENGESİ UYARISI — "görüldü" kaydı ve listeye giriş sırası.
//
// Ana ekranda uyarı bir kez gösterilir: kullanıcı gördükten sonra o iş ana ekranda
// tekrar çıkmaz. Listeye YENİ bir iş girerse ana ekranda yalnız o görünür, tüm liste
// değil. Bordro Takibi sayfasında ise her zaman tamamı görünür (orası zaten o iş için
// açılan sayfa).
//
// Kayıt tarayıcıda (localStorage), kullanıcı bazında tutulur: ayrı bir tablo açıp her
// görüntülemede yazmaya değmez. Başka cihazdan girildiğinde uyarı bir kez daha çıkar —
// kasıtlı: yeni cihazda kullanıcı o işi henüz görmemiştir.
//
// sonTespit SIRALAMA için kullanılır: listenin en üstünde EN SON TESPİT EDİLEN iş durur.
// "Tespit" yalnız listeye ilk giriş değil, DURUMUN DEĞİŞMESİ de sayılır: "7 kişi çıkarın"
// iken "6 kişi çıkarın" olduysa ya da eksikken fazlaya döndüyse iş yeniden en üste çıkar
// ve ana ekranda bir kez daha gösterilir — kullanıcı için yeni bir bilgidir.
//
// İMZA KASITLI OLARAK KABA: durum + kişi farkı + iş bitti mi. Tutar her gün kuruşu
// kuruşuna değişiyor; imzaya girseydi altı iş de her gün "değişti" sayılıp ana ekran
// uyarısı hiç susmazdı.

export type GorulenKayit = {
  /** Son tespit/değişim damgası (ISO). Eski kayıtlarda ilkGorulme adıyla duruyor olabilir. */
  sonTespit?: string;
  ilkGorulme?: string;
  anaEkrandaGosterildi: boolean;
  /** Son görülen durum imzası; değişirse iş yeniden "tespit edildi" sayılır. */
  imza?: string;
};

/** Kaydın damgası — eski (ilkGorulme) kayıtlarla uyumlu okuma. */
export function tespitZamani(k: GorulenKayit | undefined): string {
  return k?.sonTespit ?? k?.ilkGorulme ?? "";
}
type Depo = Record<string, GorulenKayit>;

const anahtar = (kullaniciId: string) => `prim-dengesi-gorulen:${kullaniciId}`;

function oku(kullaniciId: string): Depo {
  if (typeof window === "undefined") return {};
  try {
    const ham = window.localStorage.getItem(anahtar(kullaniciId));
    return ham ? (JSON.parse(ham) as Depo) : {};
  } catch {
    return {};   // özel sekme / depolama kapalı → uyarı her açılışta görünür, zarar yok
  }
}

function yaz(kullaniciId: string, depo: Depo): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(anahtar(kullaniciId), JSON.stringify(depo));
  } catch {
    /* sessiz */
  }
}

/**
 * Listedeki işleri depoyla eşler:
 *  - yeni görülenlere tespit damgası basar,
 *  - DURUMU DEĞİŞENLERİN damgasını tazeler ve "ana ekranda gösterildi"yi sıfırlar,
 *  - artık riskte olmayan işleri depodan siler (tekrar riske girerse YENİ sayılsın).
 * Dönüş: her santiyeId için kayıt.
 */
export function damgala(kullaniciId: string, kayitlar: { santiyeId: string; imza: string }[]): Depo {
  const depo = oku(kullaniciId);
  const simdi = new Date().toISOString();
  const kume = new Set(kayitlar.map((k) => k.santiyeId));
  for (const { santiyeId: id, imza } of kayitlar) {
    const mevcut = depo[id];
    if (!mevcut) {
      depo[id] = { sonTespit: simdi, anaEkrandaGosterildi: false, imza };
    } else if (mevcut.imza !== imza) {
      // DURUM DEĞİŞTİ → yeniden tespit: en üste çıkar, ana ekranda bir kez daha görünür.
      // (İmzası olmayan eski kayıtlar bir kereye mahsus buraya düşer; damgası korunur.)
      depo[id] = {
        sonTespit: mevcut.imza === undefined ? tespitZamani(mevcut) || simdi : simdi,
        anaEkrandaGosterildi: mevcut.imza === undefined ? mevcut.anaEkrandaGosterildi : false,
        imza,
      };
    }
  }
  for (const id of Object.keys(depo)) {
    if (!kume.has(id)) delete depo[id];
  }
  yaz(kullaniciId, depo);
  return depo;
}

/** Ana ekranda gösterilenleri "gösterildi" olarak işaretler. */
export function anaEkrandaGosterildiIsaretle(kullaniciId: string, santiyeIdler: string[]): void {
  if (santiyeIdler.length === 0) return;
  const depo = oku(kullaniciId);
  for (const id of santiyeIdler) {
    if (depo[id]) depo[id].anaEkrandaGosterildi = true;
  }
  yaz(kullaniciId, depo);
}
