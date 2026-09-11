import { createClient } from "@/lib/supabase/client";

// Netsim iş listesi aynası — şantiye formundaki "Netsim'deki karşılığını seç" önerisi.
//
// Tarayıcı Netsim'in Firebird sunucusuna (şirket ağı) erişemez; bu tabloyu şirket
// ağındaki bilgisayarda 15 dakikada bir dönen scripts/netsim-sync.ts tazeler.
// Bkz. sql/netsim_isler.sql

export type NetsimIs = {
  nokta_no: number;
  ad: string;
  kesif: number | null;
  fark: number | null;
  bagli: boolean;
  guncellendi: string;
};

// Henüz bir şantiyeye bağlanmamış Netsim işleri — öneri havuzu.
// Tablo yoksa/okunamazsa boş döner: form önerisi sessizce devre dışı kalır.
export async function getBagsizNetsimIsleri(): Promise<NetsimIs[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("netsim_isler")
    .select("nokta_no, ad, kesif, fark, bagli, guncellendi")
    .eq("bagli", false)
    .order("ad");
  if (error) return [];
  const isler = (data ?? []) as NetsimIs[];

  // "bagli" bayragi 15 dakikada bir tazeleniyor; aradaki surede baglanmis bir isi
  // onermeyelim. Ayni Netsim isi iki santiyeye baglanamaz (benzersiz indeks), o
  // yuzden onerilseydi kayit anlasilmaz bir hatayla reddedilirdi.
  const { data: kullanilan } = await supabase
    .from("santiyeler")
    .select("netsim_nokta_no")
    .not("netsim_nokta_no", "is", null);
  const dolu = new Set((kullanilan ?? []).map((r: { netsim_nokta_no: number | null }) => r.netsim_nokta_no));
  return isler.filter((i) => !dolu.has(i.nokta_no));
}

// Türkçe-duyarlı normalize. Sunucudaki otomatik eşleştiriciden farklı olarak
// rakamları ve kısa parçaları ATMAZ — "2/B", "3. Grup" gibi ekler öneriyi
// doğru yöne çekiyor, kararı zaten kullanıcı veriyor.
function normalize(s: string): string {
  return (s || "")
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function kelimeler(s: string): Set<string> {
  // Tek haneli rakamlar KORUNUR: "1. Kısım" ile "2. Kısım" arasındaki tek fark bu.
  // Tek harfli parçalar (bağlaç kırıntıları) elenir.
  return new Set(normalize(s).split(" ").filter((x) => x.length > 1 || /^[0-9]$/.test(x)));
}

// 0–1 arası benzerlik. Netsim adları 40 karakterde kırpıldığı için ön-ek eşleşmesi
// en güçlü sinyal; değilse ortak kelime oranı.
export function netsimBenzerlik(netsimAd: string, isAdi: string): number {
  const n = normalize(netsimAd);
  const s = normalize(isAdi);
  if (!n || !s) return 0;
  if (n.length >= 12 && (s.startsWith(n) || n.startsWith(s))) return 1;

  const kn = kelimeler(n);
  const ks = kelimeler(s);
  if (kn.size === 0 || ks.size === 0) return 0;
  let ortak = 0;
  for (const k of kn) if (ks.has(k)) ortak++;
  return ortak / Math.min(kn.size, ks.size);
}

// İş adına en çok benzeyen Netsim işleri, en iyisi başta.
export function netsimOnerileri(isAdi: string, isler: NetsimIs[], adet = 4): (NetsimIs & { skor: number })[] {
  if (!isAdi || isAdi.trim().length < 4) return [];
  return isler
    .map((i) => ({ ...i, skor: netsimBenzerlik(i.ad, isAdi) }))
    .filter((i) => i.skor >= 0.34)
    .sort((a, b) => b.skor - a.skor)
    .slice(0, adet);
}
