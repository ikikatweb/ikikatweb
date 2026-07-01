// Günlük Arvento metrikleri — TEK KAYNAK. Hem dashboard widget'ı (günlük, tarayıcıda) hem sunucu cache'i
// (arvento_gunluk_metrik → sezon toplamı) AYNI hesabı kullansın diye saf (pure) fonksiyon.
// 5 metrik: reglaj uzunluğu (km), kamyon sefer (gerçek damper), serme uzunluğu (km), sıkıştırma uzunluğu (km),
// iş makinesi çalışma (sn). Girdi verilerinin FETCH'i çağırana aittir (widget tarayıcıda, cache sunucuda çeker).
import { sadelesGuzergah, parcalarUzunlukKm, kapsananYolKm } from "@/lib/arvento/guzergah-sadelestir";
import { gercekDamperSayisi } from "@/lib/arvento/damper-say";
import { rotaTemizle, ocakTespit, ocakMakineDurumu, mesafeMetre, type LatLng } from "@/lib/arvento/ocak";
import { plakaNorm, type PlakaSantiye } from "@/lib/supabase/queries/arvento";
import type { ArventoAyarlar, DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import type { AracArventoRapor, AracArventoGuzergah } from "@/lib/supabase/types";

export type GunlukMetrik = { reglajKm: number; kamyonSefer: number; sermeKm: number; sikistirmaKm: number; makineSn: number };

// Metriği ETKİLEYEN ayarların parmak izi. Değişince cache'lenmiş günler "eski imzalı" olur → dashboard onları
// yeniden hesaplatır (renk/kalınlık gibi metriği etkilemeyen ayarlar imzaya girmez, gereksiz tazeleme olmasın).
export function metrikImza(ayarlar: ArventoAyarlar | null): string {
  const a = ayarlar;
  return [
    a?.guzergahTekrar ?? 0, a?.tekrarPencereSaat ?? 0, a?.gridMesafe ?? 12, a?.silindirTekrar ?? 0,
    a?.transitHiz ?? 20, a?.mukerrerDk ?? 0, a?.mukerrerYaricap ?? 0, a?.ocakYaricap ?? 150,
    a?.ocakLat ?? "", a?.ocakLng ?? "",
  ].join("|");
}

export type GunlukMetrikGirdi = {
  tarih: string | null;
  kayitlar: AracArventoRapor[];
  guzergahlar: AracArventoGuzergah[];
  plakaSantiye: Map<string, PlakaSantiye>;
  ayarlar: ArventoAyarlar | null;
  gunOcak: { lat: number; lng: number; yaricap: number } | null;
  sinifMap: Map<string, DamperSinif>;
};

// "HH:MM:SS" → saniye
function sureSn(t: string | null): number { if (!t) return 0; const p = t.split(":").map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); }

// Widget'takiyle BİREBİR aynı 5 hesap — tek yerde. (Widget bu fonksiyonu çağırır; sunucu cache de.)
export function hesaplaGunlukMetrik({ tarih, kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinifMap }: GunlukMetrikGirdi): GunlukMetrik {
  const grid = ayarlar?.gridMesafe ?? 12;
  const transitHiz = ayarlar?.transitHiz ?? 20;                 // reglaj/serme omurgasında transit hız eşiği
  const pencereSn = (ayarlar?.tekrarPencereSaat ?? 0) * 3600;   // "tekrar süresi" penceresi (reglaj/serme)

  // Omurga uzunluğu (km) — Reglaj ile aynı: eşik ≥ 1 omurga, omurga boşsa 0, ham modda kapsanan yol.
  // hizEsik + pSn sekmelerdeki hesapla AYNI olsun diye dışarıdan verilir (silindir transit filtresi kullanmaz → 0).
  const omurgaKm = (noktalar: { lat: number | null; lng: number | null }[], esik: number, g: number, hizEsik: number, pSn: number): number => {
    const ns = noktalar.filter((p): p is { lat: number; lng: number } => p.lat != null && p.lng != null);
    if (ns.length < 2) return 0;
    const parca = esik >= 1 ? sadelesGuzergah(ns, esik, g, hizEsik, pSn).parcalar : [];
    return parca.length ? parcalarUzunlukKm(parca) : (esik >= 1 ? 0 : kapsananYolKm(ns, g));
  };
  // op'a (serme/sikistirma) GÖRÜNÜR mü — atama varsa onu, yoksa op'a atanmış başka araç varsa gizle, değilse cinse göre.
  const opGorunur = (plaka: string, sinif: string | null, op: "serme" | "sikistirma", cinsRe: RegExp): boolean => {
    const atama = plakaSantiye.get(plakaNorm(plaka))?.sekmeler ?? null;
    if (atama != null) return atama.includes(op);
    if (Array.from(plakaSantiye.values()).some((ps) => ps.sekmeler?.includes(op))) return false;
    return cinsRe.test(`${sinif ?? ""} ${plakaSantiye.get(plakaNorm(plaka))?.cinsi ?? ""}`);
  };

  // 1) REGLAJ UZUNLUĞU (km) — greyderlerin sadeleştirilmiş omurga uzunluklarının toplamı.
  const esikReglaj = ayarlar?.guzergahTekrar ?? 0;
  const greyderMi = (p: string, sinif: string | null) => /greyder|grayder/i.test(`${sinif ?? ""} ${plakaSantiye.get(plakaNorm(p))?.cinsi ?? ""}`);
  const reglajKm = guzergahlar.reduce((s, g) => {
    if (!greyderMi(g.plaka, g.arac_sinifi)) return s;
    const noktalar = (g.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
    if (noktalar.length < 2) return s;
    if (esikReglaj < 1) return s + kapsananYolKm(noktalar, grid);
    // Reglaj sekmesinin per-araç "km yol"u ile BİREBİR: transit (tekrar süresi/pencere YOK), yalnız >0.5 m parçalar.
    const parts = sadelesGuzergah(noktalar, esikReglaj, grid, transitHiz).parcalar.map((p) => parcalarUzunlukKm([p])).filter((u) => u > 0.0005);
    return s + parts.reduce((a, b) => a + b, 0);
  }, 0);

  // 1b) SERME UZUNLUĞU (km) — serme greyder omurgası, yalnız hattın ≤80 m'sinde (GERÇEK) damper varsa.
  // Manuel arıza/mükerrer işaretlenen damper GERÇEK dökme sayılmaz → serme'ye de KATILMAZ (kamyon seferle tutarlı;
  // geçmiş günde override yapılınca serme metriği de güncellenir).
  const damperler: { lat: number; lng: number }[] = [];
  for (const r of kayitlar) for (const o of (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : [])) {
    if (o.lat == null || o.lng == null) continue;
    const sinif = sinifMap.get(`${plakaNorm(r.plaka)}|${(o as { _t?: string | null })._t ?? tarih}|${o.saat ?? ""}`);
    if (sinif === "ariza" || sinif === "mukerrer") continue;
    damperler.push({ lat: o.lat, lng: o.lng });
  }
  const yakin = (ns: { lat: number | null; lng: number | null }[]) => damperler.length > 0 && ns.some((p) => p.lat != null && p.lng != null && damperler.some((d) => mesafeMetre(p.lat as number, p.lng as number, d.lat, d.lng) <= 80));
  const sermeKm = guzergahlar.reduce((s, g) => (opGorunur(g.plaka, g.arac_sinifi, "serme", /greyder|grayder/i) && yakin(g.noktalar ?? [])) ? s + omurgaKm(g.noktalar ?? [], esikReglaj, grid, transitHiz, pencereSn) : s, 0);

  // 1c) SIKIŞTIRMA UZUNLUĞU (km) — silindir omurgası, SİLİNDİR tekrar eşiğiyle. Sıkıştırma sekmesinin per-araç
  // "km yol"u ile aynı: transit, pencere YOK.
  const esikSil = ayarlar?.silindirTekrar ?? 0;
  const sikistirmaKm = guzergahlar.reduce((s, g) => opGorunur(g.plaka, g.arac_sinifi, "sikistirma", /silindir|roller|compact/i) ? s + omurgaKm(g.noktalar ?? [], esikSil, grid, transitHiz, 0) : s, 0);

  // 2) KAMYON SEFER = Stabilize GERÇEK damper toplamı (mükerrer + ocağa göre arıza ayıklanır, manuel override).
  const mukerrerDk = ayarlar?.mukerrerDk ?? 0, mukerrerYaricap = ayarlar?.mukerrerYaricap ?? 0;
  const birlesik = new Map<string, AracArventoRapor>();
  for (const r of kayitlar) {
    const key = plakaNorm(r.plaka), ol = Array.isArray(r.damper_olaylar) ? r.damper_olaylar : [];
    const ex = birlesik.get(key);
    if (!ex) birlesik.set(key, { ...r, damper_olaylar: [...ol] });
    else { ex.damper_sayisi = (ex.damper_sayisi ?? 0) + (r.damper_sayisi ?? 0); ex.damper_olaylar = [...(Array.isArray(ex.damper_olaylar) ? ex.damper_olaylar : []), ...ol]; }
  }
  const stabilizeAtanmisVar = Array.from(plakaSantiye.values()).some((ps) => ps.sekmeler?.includes("stabilize"));
  const kamyonlar = Array.from(birlesik.values()).filter((r) => {
    const atama = plakaSantiye.get(plakaNorm(r.plaka))?.sekmeler ?? null;
    if (atama != null) return atama.includes("stabilize");
    const damperli = (Array.isArray(r.damper_olaylar) && r.damper_olaylar.length > 0) || (r.damper_sayisi ?? 0) > 0;
    return damperli && !stabilizeAtanmisVar;
  });
  const rotaBy = new Map(guzergahlar.map((g) => [plakaNorm(g.plaka), rotaTemizle((g.noktalar ?? []).filter((p) => p.lat != null && p.lng != null))]));
  let ocak: LatLng | null = gunOcak ? { lat: gunOcak.lat, lng: gunOcak.lng } : (ayarlar?.ocakLat != null && ayarlar?.ocakLng != null ? { lat: ayarlar.ocakLat, lng: ayarlar.ocakLng } : null);
  const ocakYaricap = gunOcak?.yaricap ?? ayarlar?.ocakYaricap ?? 150;
  if (!ocak) ocak = ocakTespit(kamyonlar.map((r) => rotaBy.get(plakaNorm(r.plaka)) ?? []).filter((x) => x.length));
  const kamyonSefer = kamyonlar.reduce((s, r) => {
    const ol = Array.isArray(r.damper_olaylar) ? r.damper_olaylar : [];
    const g = ol.length > 0
      ? gercekDamperSayisi(ol, rotaBy.get(plakaNorm(r.plaka)) ?? [], ocak, ocakYaricap, mukerrerDk, mukerrerYaricap, (o) => sinifMap.get(`${plakaNorm(r.plaka)}|${(o as { _t?: string | null })._t ?? tarih}|${o.saat ?? ""}`))
      : (r.damper_sayisi ?? 0);
    return s + g;
  }, 0);

  // 3) İŞ MAKİNELERİ ÇALIŞMA (sn) — ocakta çalışanlar hariç; max(kontak, rölanti), ilk→son penceresiyle sınırlı.
  const ismakineAtanmisVar = Array.from(plakaSantiye.values()).some((ps) => ps.sekmeler?.includes("ismakine"));
  const ocakM: LatLng | null = gunOcak ? { lat: gunOcak.lat, lng: gunOcak.lng } : (ayarlar?.ocakLat != null && ayarlar?.ocakLng != null ? { lat: ayarlar.ocakLat, lng: ayarlar.ocakLng } : null);
  const ocakR = gunOcak?.yaricap ?? ayarlar?.ocakYaricap ?? 150;
  const rotaMakine = new Map(guzergahlar.map((g) => [plakaNorm(g.plaka), (g.noktalar ?? []).filter((p) => p.lat != null && p.lng != null)]));
  const mkMap = new Map<string, number>();
  for (const k of kayitlar) {
    const ps = plakaSantiye.get(plakaNorm(k.plaka));
    const atama = ps?.sekmeler ?? null;
    const ismakineMi = atama != null ? atama.includes("ismakine") : (ismakineAtanmisVar ? false : ps?.sayacTipi === "saat");
    if (!ismakineMi) continue;
    if (ocakMakineDurumu(rotaMakine.get(plakaNorm(k.plaka)) ?? [], ocakM, ocakR).icinde) continue;
    let c = Math.max(k.kontak_sn ?? 0, k.rolanti_sn ?? 0);
    if (k.ilk_kontak && k.son_kontak) { const span = sureSn(k.son_kontak) - sureSn(k.ilk_kontak); if (span > 0) c = Math.min(c, span); }
    mkMap.set(plakaNorm(k.plaka), c);
  }
  const makineSn = Array.from(mkMap.values()).reduce((a, b) => a + b, 0);

  return { reglajKm, kamyonSefer, sermeKm, sikistirmaKm, makineSn };
}
