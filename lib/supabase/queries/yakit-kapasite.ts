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
//   AŞIM             = iki dolum arası sayaç farkı > kapasite
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

// Puantajda aracın fiilen çalıştığı sayılan durumlar (aralıktaki çalışma günü için)
const CALISMA: AracPuantajDurum[] = ["calisti", "yarim_gun"];

export type KapasiteAsimi = {
  basTarih: string;      // önceki dolum
  bitTarih: string;      // bu dolum
  gun: number;           // aradaki takvim günü
  basSayac: number;      // km veya saat
  bitSayac: number;
  mesafe: number;        // bitSayac − basSayac
  asim: number;          // mesafe − kapasite
  kat: number;           // mesafe ÷ kapasite (kaç depoluk yol)
  calismaGun: number;    // bu aralıkta puantajda çalıştı/yarım gün sayısı
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
 * Bir şantiyedeki araçların yakıt kapasitesi analizi.
 * Puantaj SADECE bu şantiyeden (aralıktaki çalışma günü için), yakıt ise HER
 * ŞANTİYEDEN alınır: sayaç farkı aracın gerçek yoluna göre değerlendirilmeli.
 */
export async function getYakitKapasiteAnalizi(santiyeId: string): Promise<KapasiteSatiri[]> {
  if (!santiyeId) return [];
  const supabase = getSupabase();

  const puantaj = await sayfali<PuantajRow>(
    "arac_puantaj", "arac_id, tarih, durum",
    ((q: { eq: (a: string, b: string) => { order: (c: string) => unknown } }) =>
      q.eq("santiye_id", santiyeId).order("tarih")) as never,
  );
  const aracIds = [...new Set(puantaj.map((p) => p.arac_id))];
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
  const puantajByArac = new Map<string, Map<string, AracPuantajDurum>>();
  for (const p of puantaj) {
    if (!puantajByArac.has(p.arac_id)) puantajByArac.set(p.arac_id, new Map());
    puantajByArac.get(p.arac_id)!.set(p.tarih, p.durum);
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
    const gunler = puantajByArac.get(a.id) ?? new Map<string, AracPuantajDurum>();

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
    if (kapasite && kapasite > 0) {
      for (let i = 1; i < sirali.length; i++) {
        const onceki = sirali[i - 1], bu = sirali[i];
        const mesafe = (bu.km_saat ?? 0) - (onceki.km_saat ?? 0);
        if (mesafe <= kapasite) continue;
        // Kullanıcı "dışarıdan yakıt alındı" demişse aralık açıklanmış sayılır.
        if (bu.dis_yakit_oncesi === true) { isaretliAsim++; continue; }
        let calismaGun = 0;
        for (let t = ertesiGun(onceki.tarih); t <= bu.tarih; t = ertesiGun(t)) {
          const d = gunler.get(t);
          if (d && CALISMA.includes(d)) calismaGun++;
        }
        asimlar.push({
          basTarih: onceki.tarih, bitTarih: bu.tarih, gun: gunFarki(onceki.tarih, bu.tarih),
          basSayac: onceki.km_saat ?? 0, bitSayac: bu.km_saat ?? 0,
          mesafe, asim: mesafe - kapasite, kat: mesafe / kapasite,
          calismaGun, litre: bu.miktar_lt ?? 0,
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
      kapasiteKaynak,
      dolumAdet: tumDolumlar.length,
      asimlar,
      enBuyukAsim: asimlar[0]?.asim ?? null,
      isaretliAsim,
    });
  }

  sonuc.sort((x, y) => (y.enBuyukAsim ?? -1) - (x.enBuyukAsim ?? -1) || x.plaka.localeCompare(y.plaka, "tr"));
  return sonuc;
}
