// PRİM DENGESİ UYARISI — "görüldü" kaydı ve listeye giriş sırası.
//
// Ana ekranda uyarı bir kez gösterilir: kullanıcı gördükten sonra o iş ana ekranda
// tekrar çıkmaz. Listeye YENİ bir iş girerse ana ekranda yalnız o görünür, tüm liste
// değil. Bordro Takibi sayfasında ise her zaman tamamı görünür (orası zaten o iş için
// açılan sayfa).
//
// ══ KAYIT ARTIK SUNUCUDA, TARAYICIDA DEĞİL ══
// Eskiden localStorage'daydı ve "başka cihazda bir kez daha çıkar" kasıtlı sayılmıştı.
// Pratikte bu, uyarının arada bir topluca geri gelmesi demekti: bilgisayarda hepsine
// "Anladım" denip telefondan girilince altısı birden yeniden çıkıyordu. iOS'ta ana
// ekrana eklenmiş uygulamanın deposu Safari'den ayrı olduğu için aynı telefonda bile
// iki hafıza vardı (10.11.2026). Panelin geri kalanında kural zaten "kullanıcı kaydına
// yaz"dı (lib/supabase/queries/uyari-gizle); burası istisnaydı, kapatıldı.
// Kayıt: public.prim_dengesi_gorulen · kapı: /api/prim-dengesi-gorulen
// localStorage YEDEK olarak duruyor: sunucuya ulaşılamazsa ekran yine de makul
// davransın (uyarıyı sonsuza kadar tekrar göstermesin).
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

/**
 * Sunucudaki depo. Okunamazsa yerel YEDEK kullanılır — ekran çalışmaya devam etsin.
 * (Boş depo dönmek, her açılışta bütün uyarıları yeniden göstermek demekti.)
 */
export async function depoGetirSunucu(kullaniciId: string): Promise<Depo> {
  try {
    const r = await fetch("/api/prim-dengesi-gorulen", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { depo?: Depo };
    const depo = j.depo ?? {};
    yaz(kullaniciId, depo);   // yerel yedeği tazele
    return depo;
  } catch (e) {
    console.warn("[prim dengesi] görüldü kaydı sunucudan okunamadı, yerel yedek kullanılıyor:", e);
    return oku(kullaniciId);
  }
}

/** Depoyu sunucuya yaz (yerel yedek de tazelenir). */
async function yazSunucu(kullaniciId: string, depo: Depo): Promise<void> {
  yaz(kullaniciId, depo);
  try {
    const r = await fetch("/api/prim-dengesi-gorulen", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depo }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.warn("[prim dengesi] görüldü kaydı sunucuya yazılamadı:", e);
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
export async function damgala(
  kullaniciId: string,
  /** Sunucudan okunmuş mevcut depo (depoGetirSunucu). */
  mevcutDepo: Depo,
  kayitlar: { santiyeId: string; imza: string }[],
  /** İki imza arasındaki fark ANA EKRANA ÇIKMAYA DEĞER Mİ? Verilmezse her fark değer.
   *  Çağıran burada "rutin değişiklik" ile "rutin dışı olay"ı ayırır. */
  onemliMi?: (eskiImza: string, yeniImza: string) => boolean,
): Promise<Depo> {
  const depo: Depo = { ...mevcutDepo };
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
  // DEĞİŞMEDİYSE YAZMA: her odaklanmada sunucuya istek gitmesin.
  if (JSON.stringify(depo) !== JSON.stringify(mevcutDepo)) await yazSunucu(kullaniciId, depo);
  return depo;
}

/**
 * Ana ekranda gösterilenleri "gösterildi" olarak işaretler.
 *
 * SAYFA KAPANIRKEN DE ÇALIŞMALI: sekme kapanışında normal fetch iptal ediliyor,
 * o yüzden sendBeacon kullanılıyor (tarayıcı isteği arka planda tamamlıyor).
 * Yerel yedek her hâlde güncellenir.
 */
export function anaEkrandaGosterildiIsaretle(kullaniciId: string, santiyeIdler: string[]): void {
  if (santiyeIdler.length === 0) return;
  const depo = oku(kullaniciId);
  for (const id of santiyeIdler) {
    if (depo[id]) depo[id].anaEkrandaGosterildi = true;
  }
  yaz(kullaniciId, depo);

  const govde = JSON.stringify({ gosterildi: santiyeIdler });
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/prim-dengesi-gorulen", new Blob([govde], { type: "application/json" }));
      return;
    }
  } catch { /* aşağıdaki fetch'e düş */ }
  void fetch("/api/prim-dengesi-gorulen", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: govde, keepalive: true,
  }).catch((e) => console.warn("[prim dengesi] gösterildi kaydı yazılamadı:", e));
}
