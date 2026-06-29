// Stabilize harita özeti — SUNUCU tarafı (service-role) hesap modülü.
//
// Ham 7-8 MB kamyon GPS'ini tarayıcıya çekip sınıflama yapmak yerine, SINIFLANMIŞ + OTURTULMUŞ
// damperleri gün-bazlı arvento_harita_ozet tablosuna ÖNBELLEKLER. Tarayıcı küçük özeti çeker.
//
// ÇEKİRDEK MANTIK DEĞİŞTİRİLMEZ: yalnız stabilize-ozet.ts'deki siniflaGunDamper + ozetImza çağrılır.
// Damper sınıflama (mükerrer/arıza/durak oturtma) o dosyada; burada SADECE veri çekme + önbellek var.
//
// Supabase'e AĞIR PARALEL sorgu atılmaz (havuz tükeniyor) → günler SIRALI işlenir.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { siniflaGunDamper, ozetImza, type OzetAyar, type OzetDamper, type OzetGiris } from "./stabilize-ozet";
import { ocakTespit, rotaTemizle, type LatLng } from "./ocak";

// Geometri (arvento-stabilize.tsx ile BİREBİR): kamyon segmenti giriş kapı çizgisini kesiyor mu + hangi yön.
type Pt = { lat: number; lng: number };
function yon3(p: Pt, q: Pt, r: Pt): number { return (q.lng - p.lng) * (r.lat - q.lat) - (q.lat - p.lat) * (r.lng - q.lng); }
function parcaKesisir(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = yon3(c, d, a), d2 = yon3(c, d, b), d3 = yon3(a, b, c), d4 = yon3(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

const SEKME = "stabilize";
const MAX_GUN = 45; // Vercel 60s limiti — bir istekte en fazla bu kadar gün hesaplanır.
// Plaka normalize (boşluk/harf farkını yok say). rapor.plaka ile guzergah.plaka FARKLI biçimde gelebilir
// ("60 BP 842" vs "60BP842") → rota eşleşmesi için ŞART. (plakaNorm ile aynı; queries/arvento'yu sunucuda
// import etmemek için yerel.)
const plakaKey = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

// Service-role client (RLS baypas). arvento_harita_ozet'e politikasız erişim için ŞART.
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) throw new Error("Supabase yapılandırması eksik (URL / SERVICE_ROLE_KEY)");
  return createClient(url, svc, { auth: { persistSession: false } });
}

// getArventoAyarlar'ın SUNUCU karşılığı (o fonksiyon tarayıcı client'ı kullanıyor). Aynı kolonları okur.
type AyarCache = {
  mukerrerDk: number;
  mukerrerYaricap: number;
  ocakYaricap: number;
  ocakLat: number | null;
  ocakLng: number | null;
};

export async function getAyarServer(supabase: SupabaseClient): Promise<AyarCache> {
  const { data } = await supabase.from("arvento_ayarlar").select("*").eq("id", "global").maybeSingle();
  return {
    mukerrerDk: data?.mukerrer_dk ?? 0,
    mukerrerYaricap: data?.mukerrer_yaricap ?? 0,
    ocakYaricap: data?.ocak_yaricap ?? 150,
    ocakLat: data?.ocak_lat ?? null,
    ocakLng: data?.ocak_lng ?? null,
  };
}

// getOcakForTarih'in SUNUCU karşılığı: ≤tarih en son arvento_ocak kaydı.
async function getOcakServer(
  supabase: SupabaseClient,
  tarih: string,
): Promise<{ lat: number; lng: number; yaricap: number } | null> {
  if (!tarih) return null;
  const { data, error } = await supabase
    .from("arvento_ocak")
    .select("lat, lng, yaricap")
    .lte("gecerli_tarih", tarih)
    .order("gecerli_tarih", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || data.lat == null || data.lng == null) return null;
  return { lat: data.lat as number, lng: data.lng as number, yaricap: (data.yaricap as number) ?? 150 };
}

// getGirisForTarih'in SUNUCU karşılığı: ≤tarih en son arvento_giris kaydı (kapı çizgisi A–B).
async function getGirisServer(
  supabase: SupabaseClient,
  tarih: string,
): Promise<{ lat: number; lng: number; lat2: number; lng2: number } | null> {
  if (!tarih) return null;
  const { data, error } = await supabase
    .from("arvento_giris")
    .select("lat, lng, lat2, lng2")
    .lte("gecerli_tarih", tarih)
    .order("gecerli_tarih", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || data.lat == null || data.lng == null) return null;
  return { lat: data.lat as number, lng: data.lng as number, lat2: (data.lat2 as number) ?? (data.lat as number), lng2: (data.lng2 as number) ?? (data.lng as number) };
}

type RaporRow = {
  plaka: string;
  surucu: string | null;
  damper_sayisi: number | null;
  damper_olaylar: { saat: string | null; adres: string | null; lat?: number | null; lng?: number | null }[] | null;
};
type GuzergahRow = {
  plaka: string;
  noktalar: { saat: string | null; lat: number; lng: number; hiz: number | null }[] | null;
};

// Bir GÜNÜN özetini hesaplar (referans: arvento-stabilize.tsx 1-6 adımları).
//   1. O günün raporları → damperli kamyonlar.
//   2. O kamyonların güzergahı (.in scoped) → rotaTemizle.
//   3. Ocak çözümü: getOcakForTarih > ayar.ocakLat/Lng > ocakTespit.
//   4. ayar = {mukerrerDk, mukerrerYaricap, ocakYaricap}.
//   5. Her damperli kamyon için siniflaGunDamper → OzetDamper[] birleştir.
//   6. imza = ozetImza(ocak, ayar). payload = {dampers}.
export async function gunOzetiHesapla(
  gun: string,
  supabase: SupabaseClient,
  ayarCache: AyarCache,
): Promise<{ imza: string; payload: { dampers: OzetDamper[]; girisler: OzetGiris[] } }> {
  // 1) O günün raporları → damperli kamyonlar.
  const { data: raporData, error: raporErr } = await supabase
    .from("arac_arvento_rapor")
    .select("plaka, surucu, damper_sayisi, damper_olaylar")
    .eq("rapor_tarihi", gun);
  if (raporErr) throw raporErr;
  const raporlar = (raporData ?? []) as RaporRow[];
  const damperli = raporlar.filter(
    (r) => (Array.isArray(r.damper_olaylar) ? r.damper_olaylar.length : 0) > 0 || (r.damper_sayisi ?? 0) > 0,
  );

  // 2) O kamyonların güzergahı (sadece bu plakalara scoped). Plaka → temizlenmiş rota.
  const plakalar = [...new Set(damperli.map((r) => r.plaka))];
  const rotaMap = new Map<string, { lat: number; lng: number; saat: string | null; hiz: number | null }[]>();
  if (plakalar.length > 0) {
    const { data: guzData, error: guzErr } = await supabase
      .from("arac_arvento_guzergah")
      .select("plaka, noktalar")
      .eq("rapor_tarihi", gun)
      .in("plaka", plakalar);
    if (guzErr) throw guzErr;
    for (const g of (guzData ?? []) as GuzergahRow[]) {
      const ham = Array.isArray(g.noktalar) ? g.noktalar : [];
      const temiz = rotaTemizle(ham).map((p) => ({ lat: p.lat, lng: p.lng, saat: p.saat ?? null, hiz: p.hiz ?? null }));
      rotaMap.set(plakaKey(g.plaka), temiz);
    }
  }

  // 3) Ocak çözümü: gün-bazlı kayıt > ayar > otomatik tespit.
  const ocakRow = await getOcakServer(supabase, gun);
  let ocak: LatLng | null = null;
  if (ocakRow) {
    ocak = { lat: ocakRow.lat, lng: ocakRow.lng };
  } else if (ayarCache.ocakLat != null && ayarCache.ocakLng != null) {
    ocak = { lat: ayarCache.ocakLat, lng: ayarCache.ocakLng };
  } else {
    ocak = ocakTespit([...rotaMap.values()]);
  }
  const ocakYaricap = ocakRow?.yaricap ?? ayarCache.ocakYaricap ?? 150;

  // 4) ayar paketi.
  const ayar: OzetAyar = {
    mukerrerDk: ayarCache.mukerrerDk,
    mukerrerYaricap: ayarCache.mukerrerYaricap,
    ocakYaricap,
  };

  // 5) Her damperli kamyon için sınıfla + birleştir.
  const dampers: OzetDamper[] = [];
  for (const r of damperli) {
    const olaylar = (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []).map((o) => ({
      saat: o.saat ?? null,
      adres: o.adres ?? null,
      lat: o.lat ?? null,
      lng: o.lng ?? null,
    }));
    if (olaylar.length === 0) continue; // yalnız damper_sayisi var, detay yok → oturtulacak olay yok
    const rota = rotaMap.get(plakaKey(r.plaka)) ?? [];
    const sinifli = siniflaGunDamper(r.plaka, gun, r.surucu ?? null, olaylar, rota, ocak, ayar);
    dampers.push(...sinifli);
  }

  // 6) Sefer Analizi giriş/döküm: giriş KAPI çizgisi (gün bazlı) + kamyon rotası → kesme sayısı (per plaka).
  //    Kamyon rotası gerektiği için SUNUCUDA hesaplanıp özete eklenir (tarayıcıya kamyon GPS inmiyor).
  const giris = await getGirisServer(supabase, gun);
  const girisler: OzetGiris[] = [];
  if (giris && ocak) {
    const A: Pt = { lat: giris.lat, lng: giris.lng };
    const B: Pt = { lat: giris.lat2, lng: giris.lng2 };
    const ocakTaraf = Math.sign(yon3(A, B, ocak)); // ocak hangi tarafta → "ocağa" yönü
    for (const r of damperli) {
      const rota = rotaMap.get(plakaKey(r.plaka)) ?? [];
      let go = 0, gd = 0;
      for (let i = 1; i < rota.length; i++) {
        const p1 = rota[i - 1], p2 = rota[i];
        if (p1.lat == null || p1.lng == null || p2.lat == null || p2.lng == null) continue;
        if (parcaKesisir(p1, p2, A, B)) { if (Math.sign(yon3(A, B, p2)) === ocakTaraf) go++; else gd++; }
      }
      if (go || gd) girisler.push({ plaka: r.plaka, girisOcak: go, girisDokum: gd });
    }
  }

  // 7) imza (ocak+ayar+giriş) + payload.
  const imza = ozetImza(ocak, ayar, giris);
  return { imza, payload: { dampers, girisler } };
}

// Tarih aralığındaki TÜM günlerin damperlerini döndürür. Her gün: önbellekten kontrol et, imza
// güncelse kullan, değilse/yoksa hesapla + upsert. Günler SIRALI (havuz). Bugün her zaman taze.
// En fazla MAX_GUN gün işlenir (Vercel 60s) — geniş aralıkta SON MAX_GUN gün alınır.
// force=true: BUGÜN'ü TTL'e bakmadan yeniden hesaplar (15 dk warming bunu kullanır → bugünü tazeler).
// Kullanıcı yüklemeleri force'suz → TTL içinde önbellekten (hızlı).
export async function ozetGetir(bas: string, bitis: string, force = false): Promise<{ dampers: OzetDamper[]; girisler: OzetGiris[] }> {
  if (!bas || !bitis) return { dampers: [], girisler: [] };
  const supabase = serviceClient();

  // Gün listesi (artan). Aralık MAX_GUN'ü aşarsa SON MAX_GUN gün işlenir.
  let gunler: string[] = [];
  const d = new Date(bas + "T00:00:00");
  const son = new Date(bitis + "T00:00:00");
  for (; d <= son; d.setDate(d.getDate() + 1)) {
    gunler.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  if (gunler.length === 0) gunler = [bas];
  if (gunler.length > MAX_GUN) {
    console.warn(`[stabilize-ozet] aralık ${gunler.length} gün > ${MAX_GUN}; son ${MAX_GUN} gün işlenecek.`);
    gunler = gunler.slice(gunler.length - MAX_GUN);
  }

  // Bugün (canlı gün) — veri değişebilir → her zaman taze hesaplanır.
  const now = new Date();
  const bugun = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // TEK sorgu: aralıktaki TÜM önbellek satırlarını çek (gün-gün imza kontrolü YOK → hızlı). Geçmiş günlerde
  // önbelleğe GÜVENİLİR; yalnız EKSİK günler + BUGÜN hesaplanır. (Eski yöntem her gün imza için ocak/GPS
  // çekiyordu → API 5+ sn sürüyordu.) Ocak/ayar geçmiş bir gün için değişirse o gün backfill ile tazelenir.
  const { data: cacheRows } = await supabase
    .from("arvento_harita_ozet")
    .select("rapor_tarihi, payload, olusturma")
    .eq("sekme", SEKME)
    .gte("rapor_tarihi", gunler[0])
    .lte("rapor_tarihi", gunler[gunler.length - 1]);
  type CacheVal = { payload: { dampers?: OzetDamper[]; girisler?: OzetGiris[] }; olusturma: string | null };
  const cacheMap = new Map<string, CacheVal>();
  for (const r of (cacheRows ?? []) as { rapor_tarihi: string; payload: CacheVal["payload"]; olusturma: string | null }[]) {
    cacheMap.set(String(r.rapor_tarihi), { payload: r.payload, olusturma: r.olusturma });
  }
  // BUGÜN: her açılışta yeniden hesaplamak yerine, önbellek <BUGUN_TTL ise onu kullan. 15 dk'lık speed-sync
  // bugünün özetini önceden ısıtır (warming) → TTL=20 dk ile cache HEP taze kalır → ilk açılış da anında.
  // Warming durursa TTL bitince ilk kullanıcı bir kez yeniden hesaplar (kendi kendine düzelir).
  const BUGUN_TTL = 20 * 60 * 1000;

  // Giriş sayıları gün-gün gelir → plaka bazında TOPLA (aralık geneli).
  const girisM = new Map<string, { girisOcak: number; girisDokum: number }>();
  const girisTopla = (gl: OzetGiris[] | undefined) => {
    for (const g of gl ?? []) {
      const e = girisM.get(g.plaka) ?? { girisOcak: 0, girisDokum: 0 };
      e.girisOcak += g.girisOcak; e.girisDokum += g.girisDokum;
      girisM.set(g.plaka, e);
    }
  };

  let ayarCache: AyarCache | null = null; // yalnız hesap gerekirse çek (önbellek isabetinde gerekmez)
  const tum: OzetDamper[] = [];
  for (const gun of gunler) {
    const cached = cacheMap.get(gun);
    const bugunMu = gun === bugun;
    // Geçmiş gün → önbellek (kesin). Bugün → önbellek TTL içindeyse kullan; değilse yeniden hesapla.
    const tazeBugun = !force && !!(cached && bugunMu && cached.olusturma && (Date.now() - new Date(cached.olusturma).getTime() < BUGUN_TTL));
    if (cached && (!bugunMu || tazeBugun)) { tum.push(...(cached.payload.dampers ?? [])); girisTopla(cached.payload.girisler); continue; }
    // Eksik gün veya BAYAT bugün → hesapla + upsert (SIRALI — havuz).
    if (!ayarCache) ayarCache = await getAyarServer(supabase);
    const { imza, payload } = await gunOzetiHesapla(gun, supabase, ayarCache);
    await supabase
      .from("arvento_harita_ozet")
      .upsert({ rapor_tarihi: gun, sekme: SEKME, imza, payload }, { onConflict: "rapor_tarihi,sekme" });
    tum.push(...payload.dampers);
    girisTopla(payload.girisler);
  }

  const girisler: OzetGiris[] = [...girisM.entries()].map(([plaka, v]) => ({ plaka, girisOcak: v.girisOcak, girisDokum: v.girisDokum }));
  return { dampers: tum, girisler };
}
