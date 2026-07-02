// SEZON UZUNLUK METRİKLERİ (reglaj / serme / sıkıştırma km) — sekmelerdeki (Reglaj/Serme/Sıkıştırma/Tümü)
// yöntemle BİREBİR. Neden ayrı: uzunluk TOPLANABİLİR bir büyüklük değildir — sekme aynı plakanın tüm gün
// rotalarını BİRLEŞTİRİP tek omurga çıkarır (tekrar taranan yol tek çizgi), dashboard'ın "gün-gün topla"
// yöntemi ise şişirir. Reglaj/sıkıştırma: hesaplaGunlukMetrik'in (sekmeyle birebir) hesabı, birleşik girdiyle.
// Serme: sermeAralikKm (damper-öncesi/sonrası per-hücre zamansal yöntem) → Serme sekmesiyle birebir.
import { getAraclarAtama, getGuzergahByRange, getArventoRaporByRange, getPlakaSantiyeMap, birlestirGuzergahPlaka, plakaNorm } from "@/lib/supabase/queries/arvento";
import { getArventoAyarlar, getOcakForTarih } from "@/lib/supabase/queries/arvento-ayarlar";
import { atananSekmeleriHesapla, type SekmeAtamaMap, type ArventoSekme } from "@/lib/arvento/operasyonlar";
import { createClient } from "@/lib/supabase/client";
import { hesaplaGunlukMetrik } from "./gunluk-metrik";
import { sermeAralikKm, reglajRotalariniAyikla, type OncekiDamper } from "./serme-hesap";
import type { AracArventoRapor } from "@/lib/supabase/types";

export type SezonUzunluk = { reglajKm: number; sermeKm: number; sikistirmaKm: number; bugunSermeKm: number; makineSn: number };

// "HH:MM:SS" → saniye
function sureSn(t: string | null): number { if (!t) return 0; const p = t.split(":").map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); }

// İş makinesi çalışma (sn) — İş Makineleri sekmesiyle BİREBİR: ismakine (ocak dışı) araçların gün-gün
// max(kontak,rölanti) değeri, ilk→son penceresine kırpılı, TOPLANIR. Cache yerine CANLI hesaplanır (cache
// gün-bazlı ocak yedek-dışlaması yüzünden düşük kalıyordu). ocakMakinePlakalar = aralık-birleşik ocak kümesi.
function makineCalismaSn(raporlar: AracArventoRapor[], plakaSantiye: Map<string, { sekmeler: string[] | null; sayacTipi: "km" | "saat" | null }>, ocakMakinePlakalar: Set<string> | null | undefined): number {
  const ismakineAtanmisVar = Array.from(plakaSantiye.values()).some((ps) => ps.sekmeler?.includes("ismakine"));
  let top = 0;
  for (const k of raporlar) {
    const ps = plakaSantiye.get(plakaNorm(k.plaka));
    const atama = ps?.sekmeler ?? null;
    const ismakineMi = atama != null ? atama.includes("ismakine") : (ismakineAtanmisVar ? false : ps?.sayacTipi === "saat");
    if (!ismakineMi) continue;
    if (ocakMakinePlakalar?.has(plakaNorm(k.plaka))) continue; // ocak makinesi → dışla
    let c = Math.max(k.kontak_sn ?? 0, k.rolanti_sn ?? 0);
    if (k.ilk_kontak && k.son_kontak) { const s = sureSn(k.son_kontak) - sureSn(k.ilk_kontak); if (s > 0) c = Math.min(c, s); }
    top += c;
  }
  return top;
}

// Bir rapor satırının damper olaylarını serme "önceki damper" formatına çevirir.
function damperNoktalari(r: AracArventoRapor): OncekiDamper[] {
  const out: OncekiDamper[] = [];
  for (const o of (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as { lat?: number | null; lng?: number | null; saat?: string | null }[]) {
    if (o?.lat == null || o?.lng == null) continue;
    out.push({ lat: o.lat, lng: o.lng, dt: `${r.rapor_tarihi} ${o.saat ?? "00:00:00"}` });
  }
  return out;
}

// Aralık ÖNCESİ damperler (serme "önceden döküldü mü" geçmişi) — Serme sekmesindeki oncekiDamper ile aynı.
async function oncekiDamperCek(bas: string): Promise<OncekiDamper[]> {
  const sb = createClient();
  const out: OncekiDamper[] = [];
  const PARCA = 1000; let offset = 0;
  while (true) {
    const { data, error } = await sb.from("arac_arvento_rapor").select("rapor_tarihi, damper_olaylar").lt("rapor_tarihi", bas).range(offset, offset + PARCA - 1);
    if (error || !data) break;
    for (const r of data as { rapor_tarihi: string; damper_olaylar?: { lat?: number | null; lng?: number | null; saat?: string | null }[] | null }[]) {
      for (const d of (r.damper_olaylar ?? [])) {
        if (d?.lat == null || d?.lng == null) continue;
        out.push({ lat: d.lat, lng: d.lng, dt: `${r.rapor_tarihi} ${d.saat ?? "00:00:00"}` });
      }
    }
    if (data.length < PARCA) break;
    offset += PARCA; if (offset > 300000) break;
  }
  return out;
}

export async function sezonUzunlukMetrik(bas: string, bitis: string, ocakMakinePlakalar?: Set<string> | null): Promise<SezonUzunluk> {
  const bos: SezonUzunluk = { reglajKm: 0, sermeKm: 0, sikistirmaKm: 0, bugunSermeKm: 0, makineSn: 0 };
  if (!bas || !bitis) return bos;
  // Aday plakalar: cinsi greyder/silindir OLAN ya da reglaj/serme/sıkıştırmaya ATANMIŞ olanlar (üst küme;
  // içeride cins/atama ile hassas süzülür). Böylece sezon rota çekişi HAFİF kalır (kamyon yok).
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
  const sekmeMap: SekmeAtamaMap = new Map();
  for (const a of atama) if (Array.isArray(a.sekmeler)) sekmeMap.set(plakaNorm(a.plaka), a.sekmeler as ArventoSekme[]);
  const atananSekmeler = atananSekmeleriHesapla(sekmeMap);

  const [guz, plakaSantiye, ayarlar, gunOcak, raporlar, oncekiDamper] = await Promise.all([
    getGuzergahByRange(bas, bitis, adaylar, { tekSorgu: true }), // hafif tek-sorgu (greyder/silindir ~MB altı)
    getPlakaSantiyeMap(bitis),
    getArventoAyarlar(),
    getOcakForTarih(bitis),
    getArventoRaporByRange(bas, bitis), // serme: aralık içi damperler
    oncekiDamperCek(bas),               // serme: aralık öncesi damperler
  ]);

  // Reglaj + sıkıştırma: BİRLEŞİK omurga (hesaplaGunlukMetrik, sekmeyle birebir).
  // REGLAJ = greyder rotası EKSİ serme: serme yapılan (damper-öncesi dökülmüş) greyder noktaları çıkarılır →
  // bir yol hem serme hem reglaj sayılmaz. Silindir satırlarına dokunulmaz → sıkıştırma değişmez.
  const guzReglaj = reglajRotalariniAyikla({ guzergahRows: guz, raporlar, oncekiDamper, sekmeMap, atananSekmeler });
  const birlesik = birlestirGuzergahPlaka(guzReglaj);
  const m = hesaplaGunlukMetrik({
    tarih: null, kayitlar: [], guzergahlar: birlesik, plakaSantiye, ayarlar, gunOcak, sinifMap: new Map(), ocakMakinePlakalar: null,
  });
  // Serme: HAM (birleştirilmemiş) rotalar + damper geçmişi → per-hücre zamansal (Serme sekmesiyle birebir).
  const sermeParams = {
    sekmeMap, atananSekmeler,
    guzergahTekrar: ayarlar?.guzergahTekrar ?? 0, gridMesafe: ayarlar?.gridMesafe ?? 12,
    transitHiz: ayarlar?.transitHiz ?? 20, tekrarPencereSaat: ayarlar?.tekrarPencereSaat ?? 0,
  };
  const sermeKm = sermeAralikKm({ guzergahRows: guz, raporlar, oncekiDamper, ...sermeParams });
  // BUGÜN (bitiş günü) serme'si — dashboard "Günlük Özet" için AYNI algoritma (Serme sekmesi tek-gün ile birebir).
  // Aynı çekilen veriden türetilir (ek sorgu yok): bugünün greyder rotası + bugünün damperi, "önceki damper" =
  // aralık öncesi + bugünden ÖNCEKİ tüm damperler (bir yola daha önce dökülmüşse bugünkü geçiş serme sayılır).
  const bugunGuz = guz.filter((r) => r.rapor_tarihi === bitis);
  const bugunRapor = raporlar.filter((r) => r.rapor_tarihi === bitis);
  const bugunOncekiDamper = [...oncekiDamper, ...raporlar.filter((r) => r.rapor_tarihi < bitis).flatMap(damperNoktalari)];
  const bugunSermeKm = sermeAralikKm({ guzergahRows: bugunGuz, raporlar: bugunRapor, oncekiDamper: bugunOncekiDamper, ...sermeParams });
  // Makineli çalışma: CANLI (cache değil) → İş Makineleri sekmesiyle birebir.
  const makineSn = makineCalismaSn(raporlar, plakaSantiye, ocakMakinePlakalar);
  return { reglajKm: m.reglajKm, sermeKm, sikistirmaKm: m.sikistirmaKm, bugunSermeKm, makineSn };
}
