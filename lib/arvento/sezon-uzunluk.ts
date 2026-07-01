// SEZON UZUNLUK METRİKLERİ (reglaj / serme / sıkıştırma km) — ARALIK-BİRLEŞİK omurgadan, sekmelerdeki
// (Reglaj/Serme/Sıkıştırma/Tümü) yöntemle BİREBİR. Neden ayrı: uzunluk TOPLANABİLİR bir büyüklük değildir —
// sekme aynı plakanın tüm gün rotalarını BİRLEŞTİRİP tek omurga çıkarır (tekrar taranan yol tek çizgi),
// dashboard'ın "gün-gün topla" yöntemi ise şişirir. Bu fonksiyon sekmeyle aynı hesabı (hesaplaGunlukMetrik'in
// reglaj/sıkıştırma kısmı, birleşik girdiyle) yapar → dashboard sezon değeri sekmedeki toplamla tutar.
//
// NOT (serme): serme sekmesi "damper dökülmüş hücreden SONRAKİ greyder geçişi" gibi damper-sınıflama zincirine
// bağlı bir algoritma kullanır; hesaplaGunlukMetrik'in serme'si daha basit (damper'e ≤80 m yakın omurga). Damper
// verisi geçmediğimiz için burada serme = 0 gelir (mevcut dashboard davranışıyla aynı). Serme sekmesi sıfırdan
// büyükse tam eşleme için ayrı port gerekir.
import { getAraclarAtama, getGuzergahByRange, getPlakaSantiyeMap, birlestirGuzergahPlaka } from "@/lib/supabase/queries/arvento";
import { getArventoAyarlar, getOcakForTarih } from "@/lib/supabase/queries/arvento-ayarlar";
import { hesaplaGunlukMetrik } from "./gunluk-metrik";

export type SezonUzunluk = { reglajKm: number; sermeKm: number; sikistirmaKm: number };

export async function sezonUzunlukMetrik(bas: string, bitis: string): Promise<SezonUzunluk> {
  const bos: SezonUzunluk = { reglajKm: 0, sermeKm: 0, sikistirmaKm: 0 };
  if (!bas || !bitis) return bos;
  // Aday plakalar: cinsi greyder/silindir OLAN ya da reglaj/serme/sıkıştırmaya ATANMIŞ olanlar (üst küme;
  // hesaplaGunlukMetrik içeride cins/atama ile hassas süzer). Böylece sezon rota çekişi HAFİF kalır (kamyon yok).
  const atama = await getAraclarAtama();
  const opRe = /greyder|grayder|silindir|roller|compact/i;
  const adaylar = atama
    .filter((a) =>
      a.sekmeler != null
        ? (a.sekmeler.includes("reglaj") || a.sekmeler.includes("serme") || a.sekmeler.includes("sikistirma"))
        : opRe.test(`${a.cinsi ?? ""}`),
    )
    .map((a) => a.plaka);
  if (adaylar.length === 0) return bos;
  const [guz, plakaSantiye, ayarlar, gunOcak] = await Promise.all([
    getGuzergahByRange(bas, bitis, adaylar, { tekSorgu: true }), // hafif tek-sorgu (greyder/silindir ~MB altı)
    getPlakaSantiyeMap(bitis),
    getArventoAyarlar(),
    getOcakForTarih(bitis),
  ]);
  const birlesik = birlestirGuzergahPlaka(guz); // aralık → plaka başına TEK birleşik rota
  const m = hesaplaGunlukMetrik({
    tarih: null,
    kayitlar: [], // damper yok → serme 0; reglaj/sıkıştırma damper gerektirmez
    guzergahlar: birlesik,
    plakaSantiye,
    ayarlar,
    gunOcak,
    sinifMap: new Map(),
    ocakMakinePlakalar: null,
  });
  return { reglajKm: m.reglajKm, sermeKm: m.sermeKm, sikistirmaKm: m.sikistirmaKm };
}
