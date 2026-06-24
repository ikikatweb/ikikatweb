// Dashboard widget — son Arvento raporu özeti: reglaj uzunluğu, kamyon sefer (gerçek damper), ekskavatör çalışma.
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Satellite, ChevronRight } from "lucide-react";
import { getArventoSonTarih, getArventoRaporByTarih, getGuzergahByTarih, getPlakaSantiyeMap, getArventoRaporSonGuncelleme, plakaNorm, type PlakaSantiye } from "@/lib/supabase/queries/arvento";
import { getArventoAyarlar, getOcakForTarih, getDamperSiniflar, type ArventoAyarlar, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import { sadelesGuzergah, parcalarUzunlukKm, kapsananYolKm } from "@/lib/arvento/guzergah-sadelestir";
import { gercekDamperSayisi } from "@/lib/arvento/damper-say";
import { rotaTemizle, ocakTespit, ocakMakineDurumu, mesafeMetre, type LatLng } from "@/lib/arvento/ocak";
import type { AracArventoRapor, AracArventoGuzergah } from "@/lib/supabase/types";

// "HH:MM:SS" → saniye
function sureSn(t: string | null): number { if (!t) return 0; const p = t.split(":").map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); }
// saniye → "S:DD" (toplam saat : dakika). Örn. 69620 → "19:20"
function saatDk(sn: number): string { const s = Math.max(0, Math.floor(sn)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`; }

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export default function ArventoWidget() {
  const [tarih, setTarih] = useState<string | null>(null);
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  const [guzergahlar, setGuzergahlar] = useState<AracArventoGuzergah[]>([]);
  const [plakaSantiye, setPlakaSantiye] = useState<Map<string, PlakaSantiye>>(new Map());
  const [ayarlar, setAyarlar] = useState<ArventoAyarlar | null>(null);
  const [gunOcak, setGunOcak] = useState<{ lat: number; lng: number; yaricap: number } | null>(null);
  const [sinifMap, setSinifMap] = useState<Map<string, DamperSinif>>(new Map());
  const [guncelleme, setGuncelleme] = useState<Date | null>(null); // raporun çekilme zamanı (created_at)
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const t = await getArventoSonTarih();
        setTarih(t);
        if (t) {
          const [k, g, ps, ay, ocak, sinif, gunc] = await Promise.all([
            getArventoRaporByTarih(t), getGuzergahByTarih(t), getPlakaSantiyeMap(t), getArventoAyarlar(), getOcakForTarih(t), getDamperSiniflar(t, t), getArventoRaporSonGuncelleme(t, t),
          ]);
          setKayitlar(k); setGuzergahlar(g); setPlakaSantiye(ps); setAyarlar(ay); setGunOcak(ocak); setGuncelleme(gunc);
          const sm = new Map<string, DamperSinif>(); for (const r of sinif) sm.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif); setSinifMap(sm);
        }
      } catch { /* tablo yoksa sessiz */ } finally { setLoading(false); }
    })();
  }, []);

  // 1) Günlük TOPLAM REGLAJ UZUNLUĞU — Reglaj sekmesiyle AYNI: greyderlerin sadeleştirilmiş TEK ÇİZGİ
  //    (omurga) uzunluklarının toplamı (km). Eşik<1 ise kapsanan yol.
  const reglajUzunluk = useMemo(() => {
    const grid = ayarlar?.gridMesafe ?? 12, esik = ayarlar?.guzergahTekrar ?? 0;
    const greyderMi = (p: string, sinif: string | null) => /greyder|grayder/i.test(`${sinif ?? ""} ${plakaSantiye.get(plakaNorm(p))?.cinsi ?? ""}`);
    return guzergahlar.reduce((s, g) => {
      if (!greyderMi(g.plaka, g.arac_sinifi)) return s;
      const noktalar = (g.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
      if (noktalar.length < 2) return s;
      const parca = esik >= 1 ? sadelesGuzergah(noktalar, esik, grid).parcalar : [];
      // Eşik ≥ 1 ama omurga boşsa (yol eşik kadar tekrar taranmamış) → reglaj sayılmaz (0). Kapsanan yol yalnız ham modda.
      return s + (parca.length ? parcalarUzunlukKm(parca) : (esik >= 1 ? 0 : kapsananYolKm(noktalar, grid)));
    }, 0);
  }, [guzergahlar, plakaSantiye, ayarlar]);

  // Omurga uzunluğu (km) — Reglaj ile aynı: eşik ≥ 1 omurga, omurga boşsa 0, ham modda kapsanan yol.
  const omurgaKm = (noktalar: { lat: number | null; lng: number | null }[], esik: number, grid: number): number => {
    const ns = noktalar.filter((p): p is { lat: number; lng: number } => p.lat != null && p.lng != null);
    if (ns.length < 2) return 0;
    const parca = esik >= 1 ? sadelesGuzergah(ns, esik, grid).parcalar : [];
    return parca.length ? parcalarUzunlukKm(parca) : (esik >= 1 ? 0 : kapsananYolKm(ns, grid));
  };
  // op'a (serme/sikistirma) GÖRÜNÜR mü — Reglaj/Serme sekmeleriyle AYNI: atama varsa onu, yoksa
  // op'a atanmış başka araç varsa gizle, değilse cinse göre otomatik (greyder/silindir).
  const opGorunur = (plaka: string, sinif: string | null, op: "serme" | "sikistirma", cinsRe: RegExp): boolean => {
    const atama = plakaSantiye.get(plakaNorm(plaka))?.sekmeler ?? null;
    if (atama != null) return atama.includes(op);
    if (Array.from(plakaSantiye.values()).some((ps) => ps.sekmeler?.includes(op))) return false;
    return cinsRe.test(`${sinif ?? ""} ${plakaSantiye.get(plakaNorm(plaka))?.cinsi ?? ""}`);
  };

  // 1b) SERME UZUNLUĞU — Serme sekmesiyle AYNI: serme greyder hatlarının omurgası, AMA yalnız hattın
  //     ≤80 m'sinde damper varsa (damper olmayan yolda serme olmaz). Damper yoksa o greyder 0.
  const sermeUzunluk = useMemo(() => {
    const grid = ayarlar?.gridMesafe ?? 12, esik = ayarlar?.guzergahTekrar ?? 0;
    const damperler: { lat: number; lng: number }[] = [];
    for (const r of kayitlar) for (const o of (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : [])) if (o.lat != null && o.lng != null) damperler.push({ lat: o.lat, lng: o.lng });
    const yakin = (ns: { lat: number | null; lng: number | null }[]) => damperler.length > 0 && ns.some((p) => p.lat != null && p.lng != null && damperler.some((d) => mesafeMetre(p.lat as number, p.lng as number, d.lat, d.lng) <= 80));
    return guzergahlar.reduce((s, g) => (opGorunur(g.plaka, g.arac_sinifi, "serme", /greyder|grayder/i) && yakin(g.noktalar ?? [])) ? s + omurgaKm(g.noktalar ?? [], esik, grid) : s, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guzergahlar, kayitlar, plakaSantiye, ayarlar]);

  // 1c) SIKIŞTIRMA UZUNLUĞU — Sıkıştırma sekmesiyle AYNI: silindir hatlarının omurgası, SİLİNDİR tekrar eşiğiyle.
  const sikistirmaUzunluk = useMemo(() => {
    const grid = ayarlar?.gridMesafe ?? 12, esik = ayarlar?.silindirTekrar ?? 0;
    return guzergahlar.reduce((s, g) => opGorunur(g.plaka, g.arac_sinifi, "sikistirma", /silindir|roller|compact/i) ? s + omurgaKm(g.noktalar ?? [], esik, grid) : s, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guzergahlar, plakaSantiye, ayarlar]);

  // 2) TOPLAM KAMYON SEFER = STABILIZE GERÇEK damper toplamı (mükerrer + ocağa göre arıza ayıklanır,
  //    manuel override uygulanır). Ham damper_sayisi DEĞİL.
  const kamyonSefer = useMemo(() => {
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
    return kamyonlar.reduce((s, r) => {
      const ol = Array.isArray(r.damper_olaylar) ? r.damper_olaylar : [];
      const g = ol.length > 0
        ? gercekDamperSayisi(ol, rotaBy.get(plakaNorm(r.plaka)) ?? [], ocak, ocakYaricap, mukerrerDk, mukerrerYaricap, (o) => sinifMap.get(`${plakaNorm(r.plaka)}|${(o as { _t?: string | null })._t ?? tarih}|${o.saat ?? ""}`))
        : (r.damper_sayisi ?? 0);
      return s + g;
    }, 0);
  }, [kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinifMap, tarih]);

  // 3) İŞ MAKİNELERİ TOPLAM ÇALIŞMA — İş Makineleri sekmesindeki TÜM makinelerin motor-açık süreleri
  //    toplamı (max(kontak, rölanti), ilk→son penceresiyle sınırlı). "S:DD" saat:dakika.
  const ekskavatorSn = useMemo(() => {
    const ismakineAtanmisVar = Array.from(plakaSantiye.values()).some((ps) => ps.sekmeler?.includes("ismakine"));
    // Ocak (çember) + rota — ocakta çalışan makineler bu TOPLAMA KATILMAZ (Stabilize'de sayılır).
    const ocak: LatLng | null = gunOcak ? { lat: gunOcak.lat, lng: gunOcak.lng } : (ayarlar?.ocakLat != null && ayarlar?.ocakLng != null ? { lat: ayarlar.ocakLat, lng: ayarlar.ocakLng } : null);
    const ocakR = gunOcak?.yaricap ?? ayarlar?.ocakYaricap ?? 150;
    const rotaBy = new Map(guzergahlar.map((g) => [plakaNorm(g.plaka), (g.noktalar ?? []).filter((p) => p.lat != null && p.lng != null)]));
    const m = new Map<string, number>();
    for (const k of kayitlar) {
      const ps = plakaSantiye.get(plakaNorm(k.plaka));
      const atama = ps?.sekmeler ?? null;
      const ismakineMi = atama != null ? atama.includes("ismakine") : (ismakineAtanmisVar ? false : ps?.sayacTipi === "saat");
      if (!ismakineMi) continue;
      if (ocakMakineDurumu(rotaBy.get(plakaNorm(k.plaka)) ?? [], ocak, ocakR).icinde) continue; // ocak makinesi → toplama katma
      let c = Math.max(k.kontak_sn ?? 0, k.rolanti_sn ?? 0);
      if (k.ilk_kontak && k.son_kontak) { const span = sureSn(k.son_kontak) - sureSn(k.ilk_kontak); if (span > 0) c = Math.min(c, span); }
      m.set(plakaNorm(k.plaka), c);
    }
    return Array.from(m.values()).reduce((a, b) => a + b, 0);
  }, [kayitlar, plakaSantiye, guzergahlar, gunOcak, ayarlar]);

  return (
    <div className="bg-white rounded-xl border p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Satellite size={16} className="text-[#1E3A5F]" />
          <h3 className="font-bold text-sm text-[#1E3A5F]">Araç Takip</h3>
        </div>
        <Link href="/dashboard/araclar/arvento-raporu" className="text-[11px] text-blue-600 hover:underline flex items-center">
          Tümü <ChevronRight size={12} />
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div>
      ) : !tarih ? (
        <p className="text-xs text-gray-400 py-4 text-center">Henüz Arvento raporu yok.</p>
      ) : (
        <>
          <div className="text-[10px] text-gray-400 mb-2">{formatTarih(tarih)}{guncelleme ? ` ${String(guncelleme.getHours()).padStart(2, "0")}:${String(guncelleme.getMinutes()).padStart(2, "0")}` : ""} raporu</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-emerald-700">{(reglajUzunluk * 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</div>
              <div className="text-[9px] text-gray-500">Reglaj Uzunluğu (m)</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-blue-700">{kamyonSefer.toLocaleString("tr-TR")}</div>
              <div className="text-[9px] text-gray-500">Kamyon Sefer Sayısı</div>
            </div>
            <div className="bg-teal-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-teal-700">{(sermeUzunluk * 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</div>
              <div className="text-[9px] text-gray-500">Serme Uzunluğu (m)</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-purple-700">{(sikistirmaUzunluk * 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</div>
              <div className="text-[9px] text-gray-500">Sıkıştırma Uzunluğu (m)</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-orange-700">{saatDk(ekskavatorSn)}</div>
              <div className="text-[9px] text-gray-500">Makineli Çalışma (sa:dk)</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
