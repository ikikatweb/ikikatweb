// YAKIT KAPASİTESİ ANALİZİ — "bu mesafeyi tek depoyla gidemez" tespiti.
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

export type KapasiteAsimi = {
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

export type KapasiteSatiri = {
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
  asimlar: KapasiteAsimi[];       // büyükten küçüğe
  enBuyukAsim: number | null;
  isaretliAsim: number;           // "dışarıdan yakıt alındı" işaretli olduğu için uyarıya girmeyen aralık sayısı
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
export async function getYakitKapasiteAnalizi(santiyeId: string | null): Promise<KapasiteSatiri[]> {
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

  const sonuc: KapasiteSatiri[] = [];
  for (const a of araclar) {
    const sayacTipi: "km" | "saat" = a.sayac_tipi === "saat" ? "saat" : "km";
    const carpan = sayacTipi === "saat" ? 1 : 100;
    const tumDolumlar = yakitByArac.get(a.id) ?? [];
    // Sayaç girilmemiş kayıtlar dışlanır: bir sonraki farkı (sonraki − 0) uydurma yapardı.
    const sirali = tumDolumlar
      .filter((y) => (y.km_saat ?? 0) > 0)
      .sort((x, y) => `${x.tarih}T${x.saat}`.localeCompare(`${y.tarih}T${y.saat}`));

    // --- genel ortalama (Yakıt sayfasıyla aynı mantık) ---
    const menzil = a.depo_menzil ?? 0;
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
    const kapasiteKaynak: KapasiteSatiri["kapasiteKaynak"] =
      menzil > 0 ? "menzil" : hesapKapasite ? "hesap" : "yok";

    // --- aşımlar: ardışık iki dolum arası sayaç farkı kapasiteyi aşıyor mu? ---
    const asimlar: KapasiteAsimi[] = [];
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
    });
  }

  // --- 2. aşama: aşımı olan araçların aralıklarında kaç gün çalışmış? ---
  const asimliIds = sonuc.filter((r) => r.asimlar.length > 0).map((r) => r.aracId);
  if (asimliIds.length > 0) {
    // Şantiye seçiliyse o şantiyenin puantajı zaten elimizde; değilse sadece bu araçlar için çek.
    const kayitlar = santiyeId ? puantaj : await sayfali<PuantajRow>(
      "arac_puantaj", "arac_id, tarih, durum",
      ((q: { in: (a: string, b: string[]) => { order: (c: string) => unknown } }) =>
        q.in("arac_id", asimliIds).order("tarih")) as never,
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
    }
  }

  sonuc.sort((x, y) => (y.enBuyukAsim ?? -1) - (x.enBuyukAsim ?? -1) || x.plaka.localeCompare(y.plaka, "tr"));
  return sonuc;
}
