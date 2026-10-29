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
// "Tespit" yalnız listeye ilk giriş değil, GİDİŞATIN DEĞİŞMESİ de sayılır (aşağıdaki
// rutinDisiMi'nin "evet" dediği durumlar): iş yeniden en üste çıkar ve ana ekranda bir
// kez daha gösterilir — kullanıcı için yeni bir bilgidir.
//
// ——— ANA EKRANA ÇIKMA ŞARTI ———
//
// Ana ekrandaki uyarı "bak, kontrol etmen gereken rutin dışı bir şey oldu" demek.
// Bu yüzden imzada YALNIZ olay sayılabilecek alanlar var; gün geçtikçe kendiliğinden
// değişen sayılar (gereken kişi, kalan tutar, kalan çalışma günü, dolma tarihi) İMZAYA
// GİRMEZ — girdikleri sürece uyarı hiçbir şey olmadan günaşırı ana ekrana düşüyordu
// ("1157 kişi ekleyin" yarın kendiliğinden 1180 oluyor).
//
// Ana ekrana çıkaran olaylar:
//   • iş listeye YENİ girdi (kaydı hiç yok — damgala zaten gösterir),
//   • yön değişti: eksikten fazlaya ya da fazladan eksiğe döndü (fazla ödeme = para kaybı),
//   • iş bitti (bitim tarihi geçti, prim artık çalışmayla dolmaz),
//   • bitim tarihi kaydı: süre uzatımı / tasfiye / kabul,
//   • TOPLU sigortalı girişi veya çıkışı (aşağıdaki eşik).
//
// Tek kişilik giriş/çıkış RUTİNDİR: sayı imzada tutulur ama eşiği geçmedikçe uyarıyı
// ana ekrana düşürmez — imza yine de sessizce tazelenir, yoksa tek tek giren kişiler
// birikip bir gün topluca eşiği aşmış görünürdü.
const TOPLU_KISI = 5;          // bu kadar ve üzeri giriş/çıkış "toplu" sayılır
const TOPLU_ORAN = 0.5;        // küçük kadrolarda: mevcudun yarısı da topludur

export function imzala(s: {
  durum: string; isBitti: boolean; aktifKisi: number; bitimTarihi: string;
}): string {
  return `${s.durum}|${s.isBitti ? 1 : 0}|${s.aktifKisi}|${s.bitimTarihi}`;
}

export function rutinDisiMi(eskiImza: string, yeniImza: string): boolean {
  const e = eskiImza.split("|"), y = yeniImza.split("|");
  // Biçim değişmişse (eski sürümden kalma imza) olay sayma: sessizce tazelensin.
  if (e.length !== 4 || y.length !== 4) return false;
  if (e[0] !== y[0] || e[1] !== y[1] || e[3] !== y[3]) return true;   // yön / iş bitti / bitim tarihi
  const eskiKisi = Number(e[2]), yeniKisi = Number(y[2]);
  if (!Number.isFinite(eskiKisi) || !Number.isFinite(yeniKisi)) return true;
  const fark = Math.abs(yeniKisi - eskiKisi);
  return fark >= TOPLU_KISI || fark >= Math.max(1, eskiKisi * TOPLU_ORAN);
}

export type GorulenKayit = {
  /** Son tespit/değişim damgası (ISO). Eski kayıtlarda ilkGorulme adıyla duruyor olabilir. */
  sonTespit?: string;
  ilkGorulme?: string;
  anaEkrandaGosterildi: boolean;
  /** Son görülen durum imzası; değişirse iş yeniden "tespit edildi" sayılır. */
  imza?: string;
};

/**
 * Depoyu SALT OKUNUR getirir — sıralama için. Bordro Takibi sayfası bunu kullanır:
 * damga yazmaz. Yazsaydı, kullanıcı o sayfada sigortalı girip çıkarırken imza her
 * odaklanmada sessizce tazelenir, toplu giriş "tek tek" gibi parçalanır ve ana ekran
 * uyarısı hiç tetiklenmezdi.
 */
export function depoOku(kullaniciId: string): Depo {
  return oku(kullaniciId);
}

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
export function damgala(
  kullaniciId: string,
  kayitlar: { santiyeId: string; imza: string }[],
  /** İki imza arasındaki fark ANA EKRANA ÇIKMAYA DEĞER Mİ? Verilmezse her fark değer.
   *  Çağıran burada "rutin değişiklik" ile "rutin dışı olay"ı ayırır. */
  onemliMi?: (eskiImza: string, yeniImza: string) => boolean,
): Depo {
  const depo = oku(kullaniciId);
  const simdi = new Date().toISOString();
  const kume = new Set(kayitlar.map((k) => k.santiyeId));
  for (const { santiyeId: id, imza } of kayitlar) {
    const mevcut = depo[id];
    if (!mevcut) {
      depo[id] = { sonTespit: simdi, anaEkrandaGosterildi: false, imza };
    } else if (mevcut.imza !== imza) {
      // İmza değişti. Ana ekrana çıkıp çıkmayacağına onemliMi karar verir:
      //  - ÖNEMLİ   → yeniden tespit: en üste çıkar, ana ekranda bir kez daha görünür.
      //  - ÖNEMSİZ  → imza sessizce tazelenir; damga ve "gösterildi" korunur, uyarı çıkmaz.
      // İmzası olmayan (sürüm öncesi) kayıtlar da sessiz tazelenir.
      const onemli = mevcut.imza !== undefined && (onemliMi?.(mevcut.imza, imza) ?? true);
      depo[id] = {
        sonTespit: onemli ? simdi : tespitZamani(mevcut) || simdi,
        anaEkrandaGosterildi: onemli ? false : mevcut.anaEkrandaGosterildi,
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
