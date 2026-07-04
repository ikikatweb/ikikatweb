// Dashboard widget — Arvento özeti. İKİ SAYFA (sağa kaydır): "Günlük Özet" (son rapor) ↔ "Sezon Özeti"
// (01.01.2026 → bugün, günlerin TOPLAMI). Günlük metrik tek kaynaktan (hesaplaGunlukMetrik) hesaplanır;
// sezon = arvento_gunluk_metrik cache toplamı + bugünün taze değeri. Eksik günler "Doldur" ile geçmişe işlenir.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Satellite, ChevronRight } from "lucide-react";
import { getArventoSonTarih, getArventoRaporByTarih, getGuzergahByTarih, getPlakaSantiyeMap, getArventoRaporSonGuncelleme, plakaNorm, type PlakaSantiye } from "@/lib/supabase/queries/arvento";
import { getArventoAyarlar, getOcakForTarih, getDamperSiniflar, type ArventoAyarlar, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import { hesaplaGunlukMetrik, metrikImza, type GunlukMetrik } from "@/lib/arvento/gunluk-metrik";
import { ocakMakineSetiCek } from "@/lib/arvento/gunluk-metrik-client";
import { sezonUzunlukMetrik, gunlukSermeKm, type SezonUzunluk } from "@/lib/arvento/sezon-uzunluk";
import type { AracArventoRapor, AracArventoGuzergah } from "@/lib/supabase/types";

const SEZON_BAS = "2026-01-01";

// saniye → "S:DD" (toplam saat : dakika)
function saatDk(sn: number): string { const s = Math.max(0, Math.floor(sn)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`; }
function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
// YYYY-MM-DD ± gün
function gunKaydir(t: string, n: number): string { const d = new Date(t + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function gunListesi(bas: string, bitis: string): string[] { const out: string[] = []; if (bas > bitis) return out; let g = bas; let guard = 0; while (g <= bitis && guard++ < 800) { out.push(g); g = gunKaydir(g, 1); } return out; }

// 5 metrikli kart ızgarası — hem günlük hem sezon sayfasında kullanılır.
function MetrikIzgara({ m, yukleniyor }: { m: GunlukMetrik | null; yukleniyor?: boolean }) {
  // TÜM ızgara tek durum: kesin veriler (serme dahil, sezonUzunluk) hazır olana kadar iskelet → sonra hepsi BİRLİKTE.
  const bekliyor = yukleniyor || m == null;
  const isk = () => <span className="inline-block h-4 w-12 bg-gray-200 rounded animate-pulse align-middle" />;
  const num = (v: number) => Math.round(v).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="bg-emerald-50 rounded-lg p-2 text-center">
        <div className="text-lg font-bold text-emerald-700">{bekliyor ? isk() : num((m!.reglajKm) * 1000)}</div>
        <div className="text-[9px] text-gray-500">Reglaj Uzunluğu (m)</div>
      </div>
      <div className="bg-blue-50 rounded-lg p-2 text-center">
        <div className="text-lg font-bold text-blue-700">{bekliyor ? isk() : num(m!.kamyonSefer)}</div>
        <div className="text-[9px] text-gray-500">Kamyon Sefer Sayısı</div>
      </div>
      <div className="bg-teal-50 rounded-lg p-2 text-center">
        <div className="text-lg font-bold text-teal-700">{bekliyor ? isk() : num((m!.sermeKm) * 1000)}</div>
        <div className="text-[9px] text-gray-500">Serme Uzunluğu (m)</div>
      </div>
      <div className="bg-purple-50 rounded-lg p-2 text-center">
        <div className="text-lg font-bold text-purple-700">{bekliyor ? isk() : num((m!.sikistirmaKm) * 1000)}</div>
        <div className="text-[9px] text-gray-500">Sıkıştırma Uzunluğu (m)</div>
      </div>
      <div className="bg-orange-50 rounded-lg p-2 text-center">
        <div className="text-lg font-bold text-orange-700">{bekliyor ? isk() : saatDk(m!.makineSn)}</div>
        <div className="text-[9px] text-gray-500">Makineli Çalışma (sa:dk)</div>
      </div>
    </div>
  );
}

// Temalı yükleme animasyonu: BÜRO (bina) ↔ ŞANTİYE (araç) arasında telefon/sinyal görüşmesi.
// Gri çubuk iskelet yerine — veri "sahadan büroya geliyormuş" hissi. Saf SVG + SMIL (CSS gerekmez).
function AracTakipYukleniyor() {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2" aria-label="Yükleniyor">
      <svg viewBox="0 0 160 52" className="w-52 max-w-full h-auto" role="img">
        {/* ── BÜRO (sol) ── */}
        <line x1="23" y1="14" x2="23" y2="8" stroke="#1E3A5F" strokeWidth="1.5" />
        <circle cx="23" cy="7" r="1.6" fill="#3b82f6" />
        <circle cx="23" cy="7" r="2" fill="none" stroke="#3b82f6" strokeWidth="1.2">
          <animate attributeName="r" values="2;6.5" dur="1.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0" dur="1.4s" repeatCount="indefinite" />
        </circle>
        <rect x="10" y="14" width="26" height="30" rx="1.5" fill="#1E3A5F" />
        <g fill="#93c5fd">
          <rect x="14" y="18" width="5" height="5" rx="1" /><rect x="22" y="18" width="5" height="5" rx="1" />
          <rect x="14" y="26" width="5" height="5" rx="1" /><rect x="22" y="26" width="5" height="5" rx="1" />
          <rect x="14" y="34" width="5" height="5" rx="1" /><rect x="22" y="34" width="5" height="5" rx="1" />
        </g>

        {/* ── Bağlantı çizgisi ── */}
        <line x1="42" y1="30" x2="116" y2="30" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="3 3" />

        {/* ── Sinyal noktaları (gidiş mavi / dönüş yeşil) ── */}
        <circle r="3.6" cy="30" fill="#3b82f6">
          <animate attributeName="cx" values="44;114" dur="1.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.88;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
        <circle r="3.6" cy="30" fill="#10b981">
          <animate attributeName="cx" values="114;44" dur="1.4s" begin="0.7s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.88;1" dur="1.4s" begin="0.7s" repeatCount="indefinite" />
        </circle>

        {/* ── ŞANTİYE — KEPÇE (ekskavatör) ── */}
        {/* sinyal (kabinden yukarı) */}
        <line x1="126" y1="26" x2="126" y2="20" stroke="#f59e0b" strokeWidth="1.5" />
        <circle cx="126" cy="19" r="1.6" fill="#10b981" />
        <circle cx="126" cy="19" r="2" fill="none" stroke="#10b981" strokeWidth="1.2">
          <animate attributeName="r" values="2;6.5" dur="1.4s" begin="0.7s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0" dur="1.4s" begin="0.7s" repeatCount="indefinite" />
        </circle>
        {/* paletli taban */}
        <rect x="118" y="38" width="26" height="6" rx="3" fill="#1f2937" />
        <circle cx="121" cy="41" r="1.3" fill="#6b7280" /><circle cx="141" cy="41" r="1.3" fill="#6b7280" />
        {/* gövde + kabin camı */}
        <rect x="120" y="27" width="16" height="11" rx="2" fill="#f59e0b" />
        <rect x="122.5" y="29.5" width="5" height="4.5" rx="0.6" fill="#bae6fd" />
        {/* kol: bom + stick */}
        <path d="M134 30 L146 22" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
        <path d="M146 22 L149 31" stroke="#f59e0b" strokeWidth="2.4" strokeLinecap="round" />
        {/* kepçe (kova) */}
        <path d="M146.5 30 L151.5 31 L150 35.5 L145.8 34 Z" fill="#1f2937" />
      </svg>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className="animate-pulse">📞</span> Şantiye ↔ Büro veri alışverişi…
      </div>
    </div>
  );
}

export default function ArventoWidget() {
  const [tarih, setTarih] = useState<string | null>(null);
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  const [guzergahlar, setGuzergahlar] = useState<AracArventoGuzergah[]>([]);
  const [plakaSantiye, setPlakaSantiye] = useState<Map<string, PlakaSantiye>>(new Map());
  const [ayarlar, setAyarlar] = useState<ArventoAyarlar | null>(null);
  const [gunOcak, setGunOcak] = useState<{ lat: number; lng: number; yaricap: number } | null>(null);
  const [sinifMap, setSinifMap] = useState<Map<string, DamperSinif>>(new Map());
  const [ocakMakinePlakalar, setOcakMakinePlakalar] = useState<Set<string>>(new Set()); // ocak makineleri (makineSn'den tümden dışlı)
  const [guncelleme, setGuncelleme] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const [sayfa, setSayfa] = useState(0); // 0 = günlük, 1 = sezon
  const [sezonOncesi, setSezonOncesi] = useState<GunlukMetrik | null>(null); // cache: 01.01 → dün
  const [cachedGunler, setCachedGunler] = useState<Set<string>>(new Set());
  const [sezonUzunluk, setSezonUzunluk] = useState<SezonUzunluk | null>(null); // reglaj/serme/sıkıştırma: aralık-birleşik (sekmeyle birebir)
  const [sezonYuk, setSezonYuk] = useState(true);
  const [sezonUzYuk, setSezonUzYuk] = useState(true); // ağır sezonUzunluk fetch'i sürüyor mu → Sezon sayfası (page2) iskelet
  const [bugunSerme, setBugunSerme] = useState<number | null>(null); // bugünün serme'si — HAFİF hesap (sadece bugünün rotası); Günlük Özet page1 için hızlı
  const [bugunSermeYuk, setBugunSermeYuk] = useState(true);
  const [sezonGoruldu, setSezonGoruldu] = useState(false); // ağır sezon-uzunluk hesabı YALNIZ Sezon sayfası açılınca çalışsın (page1 açılışta havuzu/CPU'yu yormasın)
  const [dolduruluyor, setDolduruluyor] = useState<{ toplam: number; kalan: number } | null>(null);
  const kaydirRef = useRef<HTMLDivElement>(null);

  const yukle = useCallback(async () => {
    try {
      const t = await getArventoSonTarih();
      setTarih(t);
      if (t) {
        const [k, g, ps, ay, ocak, sinif, gunc] = await Promise.all([
          getArventoRaporByTarih(t), getGuzergahByTarih(t), getPlakaSantiyeMap(t), getArventoAyarlar(), getOcakForTarih(t), getDamperSiniflar(t, t), getArventoRaporSonGuncelleme(t, t),
        ]);
        setKayitlar(k); setGuzergahlar(g); setPlakaSantiye(ps); setAyarlar(ay); setGunOcak(ocak); setGuncelleme(gunc);
        const sm = new Map<string, DamperSinif>(); for (const r of sinif) sm.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif); setSinifMap(sm);
        // Ocak makineleri (aralık-birleşik, bitiş ocağı) — İş Makineleri sekmesiyle BİREBİR; makineSn'den TÜM
        // günlerde tümden dışlanır (ocak makinesinin çalışması "Makineli Çalışma"ya girmesin, Stabilize'de görünür).
        try { setOcakMakinePlakalar(await ocakMakineSetiCek(t)); } catch { /* boş bırak */ }
      }
    } catch { /* tablo yoksa sessiz */ } finally { setLoading(false); }
  }, []);

  // YALNIZ İLK YÜKLEME. Eskiden focus/visibilitychange'de de tazeliyordu → sekmeye her dönüşte AĞIR sezon-rota
  // fetch'leri (ocakMakineSetiCek + sezonUzunlukMetrik + bugünün rotası) yeniden çalışıp Supabase havuzunu
  // dolduruyordu. Kaldırıldı: veri sayfa yenilenince/yeni açılışta güncellenir (yeni gün verisi zaten günde bir gelir).
  useEffect(() => {
    void yukle();
  }, [yukle]);

  // Günlük 5 metrik — tek kaynak.
  const gunluk = useMemo<GunlukMetrik>(
    () => hesaplaGunlukMetrik({ tarih, kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinifMap, ocakMakinePlakalar }),
    [tarih, kayitlar, guzergahlar, plakaSantiye, ayarlar, gunOcak, sinifMap, ocakMakinePlakalar],
  );
  // Ayar imzası — metriği etkileyen ayar/atama/ocak-makine değişince değişir; eşleşmeyen cache günü "güncel değil".
  const imza = useMemo(() => metrikImza(ayarlar, plakaSantiye, ocakMakinePlakalar), [ayarlar, plakaSantiye, ocakMakinePlakalar]);

  // Sezon: cache toplamını (01.01 → dün, YALNIZ güncel imzalı günler) çek + bugünü cache'e yaz.
  const sezonCek = useMemo(() => async () => {
    if (!tarih) return;
    setSezonYuk(true);
    const dun = gunKaydir(tarih, -1);
    try {
      const r = await fetch(`/api/arvento/gunluk-metrik?bas=${SEZON_BAS}&bitis=${dun}&imza=${encodeURIComponent(imza)}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setSezonOncesi(d.toplam as GunlukMetrik); setCachedGunler(new Set((d.tarihler ?? []) as string[])); }
    } finally { setSezonYuk(false); }
  }, [tarih, imza]);

  useEffect(() => { if (!tarih || loading) return; void sezonCek(); }, [tarih, loading, sezonCek]);
  // Sezon uzunlukları (reglaj/serme/sıkıştırma) — TOPLANAMAZ büyüklük → aralık-birleşik omurgadan (sekmeyle
  // birebir), gün-gün toplamdan DEĞİL. Damper/çalışma toplanabilir olduğu için onlar cache toplamından gelir.
  // Günlük Özet serme (page1) — HAFİF: yalnız bugünün rotası+damper geçmişi. Ağır sezon rotasını beklemez → hızlı gelir.
  useEffect(() => {
    if (!tarih || loading) return;
    let iptal = false;
    setBugunSermeYuk(true);
    gunlukSermeKm(tarih)
      .then((s) => { if (!iptal) setBugunSerme(s); })
      .catch(() => {})
      .finally(() => { if (!iptal) setBugunSermeYuk(false); });
    return () => { iptal = true; };
  }, [tarih, loading]);
  // Sezon uzunlukları (page2) — AĞIR (tüm sezon yoğun rotası). Kalıcı hız çözümü: SUNUCU ÖNBELLEĞİ (SWR).
  //   1) Cache'ten oku → varsa ANINDA göster (skeleton yok), taze ise dur.
  //   2) Bayat/yoksa arka planda BİR KEZ hesapla → göster + cache'e yaz (sonraki tüm açılışlar anında okur).
  // YALNIZ Sezon sayfası görülünce çalışır (sezonGoruldu) → page1 açılışta havuzu/CPU'yu yormaz.
  useEffect(() => {
    if (!tarih || loading) return;
    let iptal = false;
    (async () => {
      // 1) Cache OKUMASI her açılışta (hafif tek-satır) → değer varsa ANINDA göster; sayfa kaydırmayı bekleme.
      //    Böylece 2. sayfaya geçince skeleton ÇAKMASI olmaz (değer zaten yüklü).
      let cached: SezonUzunluk | null = null, taze = false;
      try {
        const r = await fetch(`/api/arvento/sezon-uzunluk?bitis=${tarih}&imza=${encodeURIComponent(imza)}`);
        if (r.ok) { const j = await r.json() as { deger: SezonUzunluk | null; taze: boolean }; cached = j.deger; taze = j.taze; }
      } catch { /* cache erişilemedi → aşağıda hesap */ }
      if (iptal) return;
      if (cached) { setSezonUzunluk(cached); setSezonUzYuk(false); } // bayat da olsa hemen göster (skeleton yok)
      // 2) AĞIR yeniden-hesap: yalnız BAYAT + Sezon sayfası GÖRÜLDÜYSE (havuzu boşuna yorma). Taze ise ya da
      //    sayfa hiç görülmediyse hesaplama yok. Hiç cache yoksa ve sayfa görüldüyse → bu seferlik skeleton.
      if (taze || !sezonGoruldu) { if (!cached) setSezonUzYuk(true); return; }
      if (!cached) setSezonUzYuk(true);
      try {
        const u = await sezonUzunlukMetrik(SEZON_BAS, tarih, ocakMakinePlakalar); // ağır — arka planda, kullanıcı bayatı görüyor
        if (iptal) return;
        setSezonUzunluk(u); setSezonUzYuk(false);
        fetch(`/api/arvento/sezon-uzunluk`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bitis: tarih, imza, ...u }) }).catch(() => {}); // cache'i tazele
      } catch { if (!iptal) setSezonUzYuk(false); }
    })();
    return () => { iptal = true; };
  }, [tarih, loading, ocakMakinePlakalar, sezonGoruldu, imza]);
  // Bugünün taze değerini cache'e yaz (fire-and-forget; yönetici değilse 403 → sessiz).
  useEffect(() => {
    if (!tarih || loading) return;
    fetch("/api/arvento/gunluk-metrik", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tarih, ...gunluk, imza }) }).catch(() => {});
  }, [tarih, loading, gunluk, imza]);

  // Sezon toplam: TOPLANABİLİR metrikler (kamyon sefer, makine çalışma) = cache(01.01→dün) + bugün. Uzunluklar
  // (reglaj/serme/sıkıştırma) TOPLANAMAZ → aralık-birleşik omurgadan (sezonUzunluk; sekmeyle birebir). sezonUzunluk
  // henüz gelmediyse geçici olarak eski toplam gösterilir (yüklenince düzelir).
  const sezon = useMemo<GunlukMetrik | null>(() => {
    if (sezonOncesi == null) return null;
    return {
      reglajKm: sezonUzunluk ? sezonUzunluk.reglajKm : sezonOncesi.reglajKm + gunluk.reglajKm,
      kamyonSefer: sezonOncesi.kamyonSefer + gunluk.kamyonSefer,
      sermeKm: sezonUzunluk ? sezonUzunluk.sermeKm : sezonOncesi.sermeKm + gunluk.sermeKm,
      sikistirmaKm: sezonUzunluk ? sezonUzunluk.sikistirmaKm : sezonOncesi.sikistirmaKm + gunluk.sikistirmaKm,
      makineSn: sezonUzunluk ? sezonUzunluk.makineSn : sezonOncesi.makineSn + gunluk.makineSn,
    };
  }, [sezonOncesi, gunluk, sezonUzunluk]);

  // Günlük gösterim: serme, hesaplaGunlukMetrik'in basit yönteminde değil, Serme sekmesiyle birebir per-hücre
  // algoritmasından (bugunSermeKm) gelir. Reglaj/sıkıştırma/kamyon/makine gün-bazlı zaten doğru.
  const gunlukGosterim = useMemo<GunlukMetrik>(
    () => {
      // Serme: önce HAFİF günlük hesap (bugunSerme, hızlı); yoksa sezon hesabından (bugunSermeKm); o da yoksa basit.
      const serme = bugunSerme != null ? bugunSerme : (sezonUzunluk ? sezonUzunluk.bugunSermeKm : gunluk.sermeKm);
      return { ...gunluk, sermeKm: serme };
    },
    [gunluk, bugunSerme, sezonUzunluk],
  );

  // Eksik günler (01.01 → dün, cache'de olmayan). Doldur ile geçmişe işlenir.
  const eksikGunler = useMemo(() => {
    if (!tarih) return [];
    return gunListesi(SEZON_BAS, gunKaydir(tarih, -1)).filter((g) => !cachedGunler.has(g));
  }, [tarih, cachedGunler]);

  // Bir günü tarayıcıda hesapla + cache'e yaz.
  async function gunuHesaplaYaz(t: string) {
    const [k, g, ps, ocak, sinif] = await Promise.all([
      getArventoRaporByTarih(t), getGuzergahByTarih(t), getPlakaSantiyeMap(t), getOcakForTarih(t), getDamperSiniflar(t, t),
    ]);
    const sm = new Map<string, DamperSinif>(); for (const r of sinif) sm.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif);
    const m = hesaplaGunlukMetrik({ tarih: t, kayitlar: k, guzergahlar: g, plakaSantiye: ps, ayarlar, gunOcak: ocak, sinifMap: sm, ocakMakinePlakalar });
    await fetch("/api/arvento/gunluk-metrik", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tarih: t, ...m, imza }) });
  }

  async function eksikleriDoldur() {
    const gunler = eksikGunler;
    if (!gunler.length || dolduruluyor) return;
    setDolduruluyor({ toplam: gunler.length, kalan: gunler.length });
    for (let i = 0; i < gunler.length; i++) {
      try { await gunuHesaplaYaz(gunler[i]); } catch { /* o günü atla */ }
      setDolduruluyor({ toplam: gunler.length, kalan: gunler.length - i - 1 });
    }
    setDolduruluyor(null);
    await sezonCek(); // cache tazele
  }

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
        <AracTakipYukleniyor />
      ) : !tarih ? (
        <p className="text-xs text-gray-400 py-4 text-center">Henüz Arvento raporu yok.</p>
      ) : bugunSermeYuk ? (
        // Günlük Özet hafif serme hesabı bitene kadar animasyon (iskelet değil) → sonra TÜM rakamlar direk & birlikte.
        <AracTakipYukleniyor />
      ) : (
        <>
          <div
            ref={kaydirRef}
            onScroll={(e) => { const el = e.currentTarget; const s = el.scrollLeft > el.clientWidth / 2 ? 1 : 0; setSayfa(s); if (s === 1) setSezonGoruldu(true); }}
            className="flex overflow-x-auto snap-x snap-mandatory gap-3 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* Sayfa 1 — Günlük */}
            <section className="snap-center shrink-0 w-full">
              <div className="text-[10px] text-gray-400 mb-2">
                <span className="font-semibold text-gray-500">Günlük Özet</span> · {formatTarih(tarih)}{guncelleme ? ` ${String(guncelleme.getHours()).padStart(2, "0")}:${String(guncelleme.getMinutes()).padStart(2, "0")}` : ""} raporu
              </div>
              {/* Veri hazır render ediliyor (bugunSermeYuk yukarıda beklendi) → skeleton yok, rakamlar direk. */}
              <MetrikIzgara m={gunlukGosterim} />
            </section>
            {/* Sayfa 2 — Sezon */}
            <section className="snap-center shrink-0 w-full">
              <div className="text-[10px] text-gray-400 mb-2 flex items-center justify-between">
                <span><span className="font-semibold text-gray-500">Sezon Özeti</span> · {formatTarih(SEZON_BAS)} → {formatTarih(tarih)}</span>
                {eksikGunler.length > 0 && !dolduruluyor && (
                  <button type="button" onClick={eksikleriDoldur} className="text-blue-600 hover:underline" title="Eksik veya ayar değişikliğiyle güncelliğini yitirmiş günleri yeniden hesapla">{eksikGunler.length} gün güncel değil — Güncelle</button>
                )}
                {dolduruluyor && <span className="text-blue-600">Dolduruluyor… {dolduruluyor.toplam - dolduruluyor.kalan}/{dolduruluyor.toplam}</span>}
              </div>
              {/* Reglaj/serme/sıkıştırma sezonUzunluk'u, kamyon/makine cache'i bekler → ikisi de bitene kadar TÜM ızgara iskelet, sonra hepsi birlikte. */}
              <MetrikIzgara m={sezon} yukleniyor={sezonYuk || sezonUzYuk} />
            </section>
          </div>

          {/* Sayfa göstergesi (nokta) + kaydırma ipucu */}
          <div className="flex items-center justify-center gap-1.5 mt-2.5">
            <button type="button" aria-label="Günlük" onClick={() => kaydirRef.current?.scrollTo({ left: 0, behavior: "smooth" })}
              className={`h-1.5 rounded-full transition-all ${sayfa === 0 ? "w-4 bg-[#1E3A5F]" : "w-1.5 bg-gray-300"}`} />
            <button type="button" aria-label="Sezon" onClick={() => { setSezonGoruldu(true); kaydirRef.current?.scrollTo({ left: kaydirRef.current.clientWidth, behavior: "smooth" }); }}
              className={`h-1.5 rounded-full transition-all ${sayfa === 1 ? "w-4 bg-[#1E3A5F]" : "w-1.5 bg-gray-300"}`} />
          </div>
        </>
      )}
    </div>
  );
}
