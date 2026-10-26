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
// ilkGorulme ayrıca SIRALAMA için kullanılır: listeye en son giren iş en üstte durur.

export type GorulenKayit = { ilkGorulme: string; anaEkrandaGosterildi: boolean };
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
 *  - yeni görülenlere ilkGorulme damgası basar,
 *  - artık riskte olmayan işleri depodan siler (tekrar riske girerse YENİ sayılsın).
 * Dönüş: her santiyeId için kayıt.
 */
export function damgala(kullaniciId: string, santiyeIdler: string[]): Depo {
  const depo = oku(kullaniciId);
  const simdi = new Date().toISOString();
  const kume = new Set(santiyeIdler);
  for (const id of santiyeIdler) {
    if (!depo[id]) depo[id] = { ilkGorulme: simdi, anaEkrandaGosterildi: false };
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
