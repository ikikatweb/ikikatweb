// YAKIT DENETLEME ANALİZİ — "bu mesafeyi tek depoyla gidemez" tespiti.
//
// KURAL: araç 120.000 km'de yakıt almış, 25 gün sonra 130.000 km'de tekrar almış.
// Aradaki 10.000 km'yi tek depoyla gitmesi mümkün değilse (kapasite 1.000 km) arada ya
// kayda geçmemiş bir dolum vardır ya da sayaç/puantaj yanlış girilmiştir. İkisi de
// düzeltilmesi gereken şey; sekme bu aralıkları listeler.
//
//   genel ortalama   = (dış-yakıt aralıkları hariç toplam lt) / (toplam km|saat)   [km'de ×100]
//   depo kapasitesi  = aracın TÜM ZAMANDAKİ en yüksek tek dolumu (lt)
//   kapasite         = depo kapasitesi ÷ genel ortalama                            → km veya saat
//   AŞIM             = iki dolum arası sayaç farkı > kapasite × 1,10
//
// %10 PAY: kapasite kesin bir sayı değil — depo kapasitesi "en yüksek tek dolum"dan,
// ortalama da geçmiş tüketimden tahmin ediliyor. Yükte/boşta, yazın/kışın, şehir içi
// ve şantiye içi tüketim farkı bu kadar oynayabilir. Sınırı birebir kapasiteye
// koymak sınırda kalan normal aralıkları uyarıya sokardı; %10 pay bırakılıyor.
//
// Genel ortalama, Yakıt sayfasındaki hesapla BİREBİR aynıdır (dış-yakıt aralıkları
// dışlanır, sayaç girilmemiş kayıtlar atlanır) — iki ekran farklı rakam göstermesin diye.
//
// ELLE ÜSTÜNE YAZMA: aracın depo_menzil alanı ("1 depo ile gidilebilecek km/saat")
// doluysa kapasite olarak O kullanılır; hesaplanan değer yalnız menzil boşken devreye
// girer. Yeni alan açılmadı — bu alan zaten Araç formunda var ve aynı şeyi ifade ediyor.
//
// ZATEN İŞARETLENMİŞ OLANLAR: kullanıcı bir dolumu "dışarıdan yakıt alındı" (D) diye
// işaretlediyse o aralık açıklanmıştır, uyarıya girmez — sadece bilgi olarak sayılır.
import { createClient } from "@/lib/supabase/client";
import type { AracPuantajDurum } from "@/lib/supabase/types";

function getSupabase() {
  return createClient();
}

// Kapasitenin üstüne bırakılan pay. Uyarı ancak bu payın da dışına çıkınca verilir.
export const TOLERANS_ORAN = 0.10;

// Puantaj durumunun kaç günlük çalışma saydığı. Yarım gün 0,5 — tam gün gibi saymak
// aralıktaki çalışmayı olduğundan fazla gösteriyordu.
const CALISMA_AGIRLIK: Partial<Record<AracPuantajDurum, number>> = {
  calisti: 1,
  yarim_gun: 0.5,
};

// ── ÇALIŞMA DENETİMİ EŞİKLERİ ──
// Puantaja "tam gün" yazılabilmesi için işin gerektirdiği asgari çalışma:
// iş makinesi öğleye kadar 3, öğleden sonra 5 = günde 8 saat. Yarım gün için en az 3 saat.
// Araçta ölçü kilometre: tam gün için en az 10 km, yarım gün için yarısı.
// Bunlar ASGARİ değerler — altına düşen aralık, puantajın sayaçla tutmadığını gösterir.
export const CALISMA_ESIK: Record<"km" | "saat", { tam: number; yarim: number }> = {
  saat: { tam: 8, yarim: 3 },
  km: { tam: 10, yarim: 5 },
};

// Aralıkta puantaja yazılan çalışmanın KARŞILIĞI var mı?
//
// İki bağımsız kanıt vardır ve BÜYÜĞÜ esas alınır:
//   • sayaç farkı  — doğrudan ölçüm, ama sahada çoğu zaman yanlış/eksik giriliyor.
//   • alınan yakıt — 55 litre alan bir kamyonet 60 km yapmamıştır; litre, çalışmanın
//     bağımsız kanıtıdır. Litre ÷ tüketim oranı = o yakıtın götürdüğü km/saat.
//
// Uyarı ancak İKİ kanıt da puantajın altında kalırsa verilir. Aksi halde sayacı
// yazılmayan (ör. her dolumda 1 km artırılan) araçlar haksız yere işaretleniyordu.
//
// Tüketim oranı: araçta "1 depo menzili" doluysa depo kapasitesi ÷ menzil; değilse
// geçmişten hesaplanan genel ortalama. İkisi de yoksa yakıt kanıtı üretilemez.
export type CalismaAcigi = {
  basTarih: string;      // önceki sayaç okuması (yakıt kaydı)
  bitTarih: string;      // bu sayaç okuması
  gun: number;           // aradaki takvim günü
  basSayac: number;
  bitSayac: number;
  gercek: number;        // bitSayac − basSayac (saat veya km) — sayaç kanıtı
  litre: number;         // aralığı kapatan dolum
  yakitKarsiligi: number;// litre ÷ tüketim oranı → yakıt kanıtı (oran yoksa 0)
  kanit: number;         // max(gercek, yakitKarsiligi) — iki kanıttan büyüğü
  veriYok: boolean;      // ne sayaç ne yakıt kanıtı üretilebildi → "denetlenemiyor"
  tamGun: number;        // aralıkta "çalıştı" işaretli gün
  yarimGun: number;      // aralıkta "yarım gün" işaretli gün
  beklenen: number;      // tamGun×tam + yarimGun×yarim
  acik: number;          // beklenen − kanit
  karsilikGun: number;   // kanit ÷ tam → "eldeki kanıt ancak bu kadar tam günü karşılıyor"
  // DEPO SINIRI: aralık tek dolumla geçildiğine göre, puantaja yazılan çalışma bir deponun
  // yetebileceğinden fazlaysa o çalışma fiilen mümkün değildir — sayaç hiç okunmasa bile.
  // (Aracın 1 depo menzili: depo kapasitesi ÷ ortalama tüketim.)
  // Bilgi amaçlı: puantaja yazılan iş bir deponun yetebileceğinden fazla mı?
  // Artık tek başına uyarı sebebi DEĞİL (yakıt kanıtı zaten litreyle sınırlı), yalnız etiket.
  kapasite: number | null;   // bir deponun yettiği saat/km
  depoAsiyor: boolean;
  depoGun: number | null;    // kapasite ÷ tam → "bir depo en fazla bu kadar tam gün eder"
};

export type DenetimAsimi = {
  basTarih: string;      // önceki dolum
  bitTarih: string;      // bu dolum
  gun: number;           // aradaki takvim günü
  basSayac: number;      // km veya saat
  bitSayac: number;
  mesafe: number;        // bitSayac − basSayac
  asim: number;          // mesafe − kapasite (pay dahil edilmeden, gerçek fazlalık)
  kat: number;           // mesafe ÷ kapasite (kaç depoluk yol)
  calismaGun: number;    // bu aralıkta çalışma günü — yarım günler 0,5 sayılır
  santiyeGun: number;    // bu aralıkta seçili şantiyede puantaj kaydı olan gün sayısı
  litre: number;         // bu dolumda alınan litre
};

export type DenetimSatiri = {
  aracId: string;
  plaka: string;
  ad: string;
  cinsi: string;
  sayacTipi: "km" | "saat";
  firmaAdi: string;
  genelOrt: number | null;        // L/100km veya L/saat
  depoKapasite: number | null;    // en yüksek tek dolum (lt)
  kapasite: number | null;        // km veya saat
  esik: number | null;            // kapasite × (1 + pay) — uyarı bu sınırın üstünde verilir
  kapasiteKaynak: "menzil" | "hesap" | "yok";
  dolumAdet: number;
  asimlar: DenetimAsimi[];       // büyükten küçüğe
  enBuyukAsim: number | null;
  isaretliAsim: number;           // "dışarıdan yakıt alındı" işaretli olduğu için uyarıya girmeyen aralık sayısı
  aciklar: CalismaAcigi[];       // çalışma açığı olan aralıklar — açığı büyükten küçüğe
  enBuyukAcik: number | null;
};

type YakitRow = { arac_id: string; tarih: string; saat: string; km_saat: number | null; miktar_lt: number | null; dis_yakit_oncesi: boolean | null; duzeltme: boolean | null };
type PuantajRow = { arac_id: string; tarih: string; durum: AracPuantajDurum };
type AracRow = {
  id: string; plaka: string; marka: string | null; model: string | null; cinsi: string | null;
  sayac_tipi: "km" | "saat" | null; tip: string | null; depo_menzil: number | null;
  kiralama_firmasi: string | null; firmalar?: { firma_adi: string } | null;
};

const ertesiGun = (t: string) => {
  const d = new Date(t + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const gunFarki = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

// Supabase 1000 satır sınırını aşan tablolar için sayfalı çekim
async function sayfali<T>(tablo: string, sec: string, filtre: (q: never) => never): Promise<T[]> {
  const supabase = getSupabase();
  const PARCA = 1000;
  const tum: T[] = [];
  let offset = 0;
  for (;;) {
    const q = filtre(supabase.from(tablo).select(sec) as never) as unknown as {
      range: (a: number, b: number) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await q.range(offset, offset + PARCA - 1);
    if (error) throw new Error(error.message);
    const parca = (data ?? []) as T[];
    tum.push(...parca);
    if (parca.length < PARCA) break;
    offset += PARCA;
    if (offset > 200000) break;
  }
  return tum;
}

/**
 * Yakıt kapasitesi analizi.
 *
 * santiyeId verilirse: araç listesi O ŞANTİYEDE puantajı olanlardan çıkar.
 * Boş verilirse (tüm şantiyeler): pasif olmayan TÜM araçlar incelenir.
 *
 * Yakıt kayıtları her iki durumda da HER ŞANTİYEDEN alınır — sayaç farkı aracın
 * gerçek yoluna göre değerlendirilmeli, başka işte doldurduysa aralık orada kırılmalı.
 *
 * ŞANTİYE SEÇİLİYSE aralıklar da süzülür: yalnız aracın O ŞANTİYEDE bulunduğu döneme
 * denk gelen dolum aralıkları denetlenir. Araç başka işteyken oluşan bir aşımı bu
 * şantiyenin hanesine yazmak yanlış olurdu.
 *
 * Puantaj (aralıkta kaç gün çalıştığı) ikinci aşamada ve SADECE aşımı olan araçlar için
 * çekilir: "tüm şantiyeler" seçildiğinde bütün puantajı indirmek yüz binlerce satır eder.
 */
export async function getYakitDenetimi(santiyeId: string | null): Promise<DenetimSatiri[]> {
  const supabase = getSupabase();

  let aracIds: string[];
  let puantaj: PuantajRow[] = [];
  if (santiyeId) {
    puantaj = await sayfali<PuantajRow>(
      "arac_puantaj", "arac_id, tarih, durum",
      ((q: { eq: (a: string, b: string) => { order: (c: string) => unknown } }) =>
        q.eq("santiye_id", santiyeId).order("tarih")) as never,
    );
    aracIds = [...new Set(puantaj.map((p) => p.arac_id))];
  } else {
    const { data, error } = await supabase.from("araclar").select("id").neq("durum", "pasif");
    if (error) throw new Error(error.message);
    aracIds = ((data ?? []) as { id: string }[]).map((x) => x.id);
  }
  if (aracIds.length === 0) return [];

  const [yakitHam, aracRes] = await Promise.all([
    sayfali<YakitRow>(
      "arac_yakit", "arac_id, tarih, saat, km_saat, miktar_lt, dis_yakit_oncesi, duzeltme",
      ((q: { in: (a: string, b: string[]) => { order: (c: string) => unknown } }) =>
        q.in("arac_id", aracIds).order("tarih")) as never,
    ),
    supabase
      .from("araclar")
      .select("id, plaka, marka, model, cinsi, sayac_tipi, tip, depo_menzil, kiralama_firmasi, firmalar(firma_adi)")
      .in("id", aracIds),
  ]);
  if (aracRes.error) throw new Error(aracRes.error.message);
  const araclar = (aracRes.data ?? []) as unknown as AracRow[];

  // Düzeltme kayıtları gerçek dolum değil — ne ortalamaya ne kapasiteye girer.
  const yakit = yakitHam.filter((y) => y.duzeltme !== true);

  const yakitByArac = new Map<string, YakitRow[]>();
  for (const y of yakit) {
    if (!yakitByArac.has(y.arac_id)) yakitByArac.set(y.arac_id, []);
    yakitByArac.get(y.arac_id)!.push(y);
  }

  const sonuc: DenetimSatiri[] = [];
  const siraliByArac = new Map<string, YakitRow[]>(); // 2. aşama (çalışma denetimi) aynı okumaları kullanır
  const menzilByArac = new Map<string, number>();     // "1 depo menzili" — yakıt kanıtının oranı buradan
  for (const a of araclar) {
    const sayacTipi: "km" | "saat" = a.sayac_tipi === "saat" ? "saat" : "km";
    const carpan = sayacTipi === "saat" ? 1 : 100;
    const tumDolumlar = yakitByArac.get(a.id) ?? [];
    // Sayaç girilmemiş kayıtlar dışlanır: bir sonraki farkı (sonraki − 0) uydurma yapardı.
    const sirali = tumDolumlar
      .filter((y) => (y.km_saat ?? 0) > 0)
      .sort((x, y) => `${x.tarih}T${x.saat}`.localeCompare(`${y.tarih}T${y.saat}`));
    siraliByArac.set(a.id, sirali);

    // --- genel ortalama (Yakıt sayfasıyla aynı mantık) ---
    const menzil = a.depo_menzil ?? 0;
    menzilByArac.set(a.id, menzil);
    let toplamLt = 0, toplamMesafe = 0;
    for (let i = 1; i < sirali.length; i++) {
      const mesafe = (sirali[i].km_saat ?? 0) - (sirali[i - 1].km_saat ?? 0);
      if (mesafe <= 0) continue;
      const bu = sirali[i];
      const disYakit = bu.dis_yakit_oncesi === true ? true
        : bu.dis_yakit_oncesi === false ? false
        : (menzil > 0 && mesafe > menzil);
      if (disYakit) continue;
      toplamLt += bu.miktar_lt ?? 0;
      toplamMesafe += mesafe;
    }
    const genelOrt = toplamMesafe > 0 ? (toplamLt / toplamMesafe) * carpan : null;

    const depoKapasite = tumDolumlar.length ? Math.max(...tumDolumlar.map((y) => y.miktar_lt ?? 0)) : null;
    const hesapKapasite = depoKapasite && genelOrt && genelOrt > 0 ? (depoKapasite / genelOrt) * carpan : null;
    // Araç formundaki "1 depo menzili" doluysa o esas alınır.
    const kapasite = menzil > 0 ? menzil : hesapKapasite;
    const kapasiteKaynak: DenetimSatiri["kapasiteKaynak"] =
      menzil > 0 ? "menzil" : hesapKapasite ? "hesap" : "yok";

    // --- aşımlar: ardışık iki dolum arası sayaç farkı kapasiteyi aşıyor mu? ---
    const asimlar: DenetimAsimi[] = [];
    let isaretliAsim = 0;
    const esik = kapasite && kapasite > 0 ? kapasite * (1 + TOLERANS_ORAN) : null;
    if (kapasite && kapasite > 0 && esik) {
      for (let i = 1; i < sirali.length; i++) {
        const onceki = sirali[i - 1], bu = sirali[i];
        const mesafe = (bu.km_saat ?? 0) - (onceki.km_saat ?? 0);
        if (mesafe <= esik) continue;
        // Kullanıcı "dışarıdan yakıt alındı" demişse aralık açıklanmış sayılır.
        if (bu.dis_yakit_oncesi === true) { isaretliAsim++; continue; }
        asimlar.push({
          basTarih: onceki.tarih, bitTarih: bu.tarih, gun: gunFarki(onceki.tarih, bu.tarih),
          basSayac: onceki.km_saat ?? 0, bitSayac: bu.km_saat ?? 0,
          mesafe, asim: mesafe - kapasite, kat: mesafe / kapasite,
          calismaGun: 0, santiyeGun: 0, litre: bu.miktar_lt ?? 0,   // 2. aşamada doldurulur
        });
      }
    }
    asimlar.sort((x, y) => y.asim - x.asim);

    sonuc.push({
      aracId: a.id,
      plaka: a.plaka,
      ad: [a.marka, a.model].filter(Boolean).join(" "),
      cinsi: (a.cinsi ?? "").trim() || "Cinsi girilmemiş",
      sayacTipi,
      firmaAdi: (a.tip === "kiralik" ? (a.kiralama_firmasi ?? "") : (a.firmalar?.firma_adi ?? "")).trim() || "Firma girilmemiş",
      genelOrt,
      depoKapasite,
      kapasite,
      esik,
      kapasiteKaynak,
      dolumAdet: tumDolumlar.length,
      asimlar,
      enBuyukAsim: asimlar[0]?.asim ?? null,
      isaretliAsim,
      aciklar: [],            // 2. aşamada doldurulur
      enBuyukAcik: null,
    });
  }

  // --- 2. aşama: puantajla karşılaştırma ---
  // İki şey birden hesaplanır, ikisi de aynı puantaj verisini kullanır:
  //   (a) aşımı olan aralıklarda kaç gün çalışılmış (yakıt denetimi için bilgi),
  //   (b) ÇALIŞMA AÇIĞI: puantaja yazılan çalışmanın sayaçta karşılığı var mı.
  // (b) için en az iki sayaç okuması olan HER araç incelenir — aşımı olmasa da.
  const puantajGerekenIds = sonuc
    .filter((r) => r.asimlar.length > 0 || (siraliByArac.get(r.aracId)?.length ?? 0) >= 2)
    .map((r) => r.aracId);
  if (puantajGerekenIds.length > 0) {
    // Şantiye seçiliyse o şantiyenin puantajı zaten elimizde; değilse sadece bu araçlar için çek.
    const kayitlar = santiyeId ? puantaj : await sayfali<PuantajRow>(
      "arac_puantaj", "arac_id, tarih, durum",
      ((q: { in: (a: string, b: string[]) => { order: (c: string) => unknown } }) =>
        q.in("arac_id", puantajGerekenIds).order("tarih")) as never,
    );
    const gunlerByArac = new Map<string, Map<string, AracPuantajDurum>>();
    for (const p of kayitlar) {
      if (!gunlerByArac.has(p.arac_id)) gunlerByArac.set(p.arac_id, new Map());
      gunlerByArac.get(p.arac_id)!.set(p.tarih, p.durum);
    }
    for (const r of sonuc) {
      const gunler = gunlerByArac.get(r.aracId);
      for (const x of r.asimlar) {
        let calisma = 0, santiyede = 0;
        if (gunler) {
          for (let t = ertesiGun(x.basTarih); t <= x.bitTarih; t = ertesiGun(t)) {
            const d = gunler.get(t);
            if (!d) continue;
            santiyede++;
            calisma += CALISMA_AGIRLIK[d] ?? 0;
          }
        }
        x.calismaGun = calisma;
        x.santiyeGun = santiyede;
      }
      // Şantiye seçiliyse: aracın o şantiyede FİİLEN ÇALIŞMADIĞI aralıklar bu şantiyenin
      // denetimine girmez. Sadece "kaydı var" yetmiyor — çalışma günü 0 olan aralık ya
      // aracın başka işte olduğu ya da o döneme puantaj girilmediği anlamına geliyor;
      // ikisinde de aşımı bu şantiyenin hanesine yazmak yanlış olur.
      if (santiyeId) {
        r.asimlar = r.asimlar.filter((x) => x.calismaGun > 0);
        r.enBuyukAsim = r.asimlar[0]?.asim ?? null;
      }

      // --- ÇALIŞMA AÇIĞI ---
      // Ardışık iki sayaç okuması arasında puantaja yazılan çalışmanın karşılığı sayaçta var mı?
      // Örnek: makine 1'inde 1390 saatte, 15'inde 1400 saatte; arada 15 gün "çalıştı" yazılmış.
      // Beklenen 15×8 = 120 saat, gerçek 10 saat → 110 saat açık; sayaç ancak 1,25 günü karşılıyor.
      // Pay bırakılmaz (kullanıcı kararı): beklenenin altına düşen her aralık uyarıya girer.
      const esikler = CALISMA_ESIK[r.sayacTipi];
      const okumalar = siraliByArac.get(r.aracId) ?? [];
      // Tüketim oranı (birim başına litre): menzil girilmişse ondan, değilse geçmiş ortalamadan.
      // Menzil önce gelir; sayacı yanlış girilen araçlarda hesaplanan ortalama da bozuk çıkıyor.
      const carpanR = r.sayacTipi === "saat" ? 1 : 100;
      const tuketimOran = (menzilByArac.get(r.aracId) ?? 0) > 0 && r.depoKapasite
        ? r.depoKapasite / (menzilByArac.get(r.aracId) as number)
        : (r.genelOrt && r.genelOrt > 0 ? r.genelOrt / carpanR : null);
      const aciklar: CalismaAcigi[] = [];
      if (gunler) {
        for (let i = 1; i < okumalar.length; i++) {
          const onceki = okumalar[i - 1], bu = okumalar[i];
          const gercek = (bu.km_saat ?? 0) - (onceki.km_saat ?? 0);
          if (gercek < 0) continue;   // sayaç değişmiş/sıfırlanmış → kıyaslanamaz
          let tamGun = 0, yarimGun = 0;
          for (let t = ertesiGun(onceki.tarih); t <= bu.tarih; t = ertesiGun(t)) {
            const d = gunler.get(t);
            if (d === "calisti") tamGun++;
            else if (d === "yarim_gun") yarimGun++;
          }
          const beklenen = tamGun * esikler.tam + yarimGun * esikler.yarim;
          if (beklenen <= 0) continue;      // aralıkta çalışma işaretlenmemiş → denetlenecek şey yok
          // İKİ KANIT, BÜYÜĞÜ GEÇERLİ. Sayaç yazılmamışsa yakıt konuşur, yakıt bilinmiyorsa sayaç.
          const litre = bu.miktar_lt ?? 0;
          const yakitKarsiligi = tuketimOran && tuketimOran > 0 ? litre / tuketimOran : 0;
          const kanit = Math.max(gercek, yakitKarsiligi);
          if (kanit >= beklenen) continue;  // kanıtlardan biri puantajı karşılıyor → sorun yok
          aciklar.push({
            basTarih: onceki.tarih, bitTarih: bu.tarih, gun: gunFarki(onceki.tarih, bu.tarih),
            basSayac: onceki.km_saat ?? 0, bitSayac: bu.km_saat ?? 0,
            gercek, litre, yakitKarsiligi, kanit,
            // Hiçbir kanıt üretilemedi: sayaç hiç artmamış VE tüketim oranı bilinmiyor.
            // Bu "çalışmamış" demek değil, "denetlenemiyor" demek.
            veriYok: tuketimOran == null && gercek <= 0,
            tamGun, yarimGun, beklenen, acik: beklenen - kanit,
            karsilikGun: kanit / esikler.tam,
            kapasite: r.kapasite,
            depoAsiyor: !!(r.esik && beklenen > r.esik),
            depoGun: r.kapasite != null ? r.kapasite / esikler.tam : null,
          });
        }
      }
      // Açığı büyük olan üstte; denetlenemeyenler (kanıtsız) en sona.
      aciklar.sort((x, y) => Number(x.veriYok) - Number(y.veriYok) || y.acik - x.acik);
      r.aciklar = aciklar;
      r.enBuyukAcik = aciklar[0]?.acik ?? null;
    }
  }

  // Sıralama: önce bulgusu olanlar (aşım ya da çalışma açığı), aşımı büyük olan üstte.
  const bulguVar = (r: DenetimSatiri) => (r.asimlar.length > 0 || r.aciklar.length > 0 ? 1 : 0);
  sonuc.sort((x, y) =>
    bulguVar(y) - bulguVar(x) ||
    (y.enBuyukAsim ?? -1) - (x.enBuyukAsim ?? -1) ||
    (y.enBuyukAcik ?? -1) - (x.enBuyukAcik ?? -1) ||
    x.plaka.localeCompare(y.plaka, "tr"));
  return sonuc;
}
