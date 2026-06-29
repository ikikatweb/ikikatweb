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
import { siniflaGunDamper, ozetImza, type OzetAyar, type OzetDamper } from "./stabilize-ozet";
import { ocakTespit, rotaTemizle, type LatLng } from "./ocak";

const SEKME = "stabilize";
const MAX_GUN = 45; // Vercel 60s limiti — bir istekte en fazla bu kadar gün hesaplanır.

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
): Promise<{ imza: string; payload: { dampers: OzetDamper[] } }> {
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
      rotaMap.set(g.plaka, temiz);
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
    const rota = rotaMap.get(r.plaka) ?? [];
    const sinifli = siniflaGunDamper(r.plaka, gun, r.surucu ?? null, olaylar, rota, ocak, ayar);
    dampers.push(...sinifli);
  }

  // 6) imza + payload.
  const imza = ozetImza(ocak, ayar);
  return { imza, payload: { dampers } };
}

// Tarih aralığındaki TÜM günlerin damperlerini döndürür. Her gün: önbellekten kontrol et, imza
// güncelse kullan, değilse/yoksa hesapla + upsert. Günler SIRALI (havuz). Bugün her zaman taze.
// En fazla MAX_GUN gün işlenir (Vercel 60s) — geniş aralıkta SON MAX_GUN gün alınır.
export async function ozetGetir(bas: string, bitis: string): Promise<{ dampers: OzetDamper[] }> {
  if (!bas || !bitis) return { dampers: [] };
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

  // Ayarları BİR KEZ çek (cache).
  const ayarCache = await getAyarServer(supabase);

  // Bugün (TR'de gün değişimi sunucuyla aynı varsayılıyor — cron da bu güne yazıyor).
  const bugun = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;

  const tum: OzetDamper[] = [];
  // Günleri SIRALI işle — paralel DEĞİL (bağlantı havuzu).
  for (const gun of gunler) {
    // Önbellekteki satırı çek.
    const { data: cache } = await supabase
      .from("arvento_harita_ozet")
      .select("imza, payload")
      .eq("rapor_tarihi", gun)
      .eq("sekme", SEKME)
      .maybeSingle();

    const bugunMu = gun === bugun; // canlı gün — veri değişebilir → her zaman taze hesapla

    if (cache && !bugunMu) {
      // İmza güncel mi? Önce ayar/ocak'tan beklenen imzayı üret, cache.imza ile karşılaştır.
      // (Hesaplamadan imza üretmek için ocak çözümü gerekir; ama ocak otomatik tespit GÜN verisine
      //  bağlı olabildiğinden, imza eşleşmesini hesaplanan özetle teyit etmek en güvenlisi. Performans
      //  için: gün-bazlı ocak/ayar imzası ham veriden bağımsız değil → tam hesap yapıp imza karşılaştırırız
      //  ancak cache imzası eşleşirse cache payload'ını kullanırız.)
      const beklenenImza = await imzaHesapla(gun, supabase, ayarCache);
      if (beklenenImza === cache.imza) {
        const payload = cache.payload as { dampers?: OzetDamper[] } | null;
        tum.push(...(payload?.dampers ?? []));
        continue;
      }
    }

    // Önbellek yok / bayat / bugün → hesapla + upsert + kullan.
    const { imza, payload } = await gunOzetiHesapla(gun, supabase, ayarCache);
    await supabase
      .from("arvento_harita_ozet")
      .upsert(
        { rapor_tarihi: gun, sekme: SEKME, imza, payload },
        { onConflict: "rapor_tarihi,sekme" },
      );
    tum.push(...payload.dampers);
  }

  return { dampers: tum };
}

// Yalnız o günün imzasını hesaplar (ocak çözümü + ayar). gunOzetiHesapla ile AYNI ocak mantığını
// kullanır → imza tutarlı. Önbellek geçerlilik kontrolü için (tam damper hesabı yapmadan).
async function imzaHesapla(gun: string, supabase: SupabaseClient, ayarCache: AyarCache): Promise<string> {
  // Ocak çözümü için: gün-bazlı kayıt > ayar > otomatik tespit (otomatik tespit rota gerektirir).
  const ocakRow = await getOcakServer(supabase, gun);
  let ocak: LatLng | null = null;
  let ocakYaricap = ayarCache.ocakYaricap ?? 150;
  if (ocakRow) {
    ocak = { lat: ocakRow.lat, lng: ocakRow.lng };
    ocakYaricap = ocakRow.yaricap ?? ocakYaricap;
  } else if (ayarCache.ocakLat != null && ayarCache.ocakLng != null) {
    ocak = { lat: ayarCache.ocakLat, lng: ayarCache.ocakLng };
  } else {
    // Otomatik tespit ham rotaya bağlı → damperli kamyonların rotasından tespit et (gunOzetiHesapla ile aynı).
    const { data: raporData } = await supabase
      .from("arac_arvento_rapor")
      .select("plaka, damper_sayisi, damper_olaylar")
      .eq("rapor_tarihi", gun);
    const raporlar = (raporData ?? []) as RaporRow[];
    const plakalar = [
      ...new Set(
        raporlar
          .filter((r) => (Array.isArray(r.damper_olaylar) ? r.damper_olaylar.length : 0) > 0 || (r.damper_sayisi ?? 0) > 0)
          .map((r) => r.plaka),
      ),
    ];
    if (plakalar.length > 0) {
      const { data: guzData } = await supabase
        .from("arac_arvento_guzergah")
        .select("plaka, noktalar")
        .eq("rapor_tarihi", gun)
        .in("plaka", plakalar);
      const rotalar = ((guzData ?? []) as GuzergahRow[]).map((g) =>
        rotaTemizle(Array.isArray(g.noktalar) ? g.noktalar : []),
      );
      ocak = ocakTespit(rotalar);
    }
  }
  const ayar: OzetAyar = {
    mukerrerDk: ayarCache.mukerrerDk,
    mukerrerYaricap: ayarCache.mukerrerYaricap,
    ocakYaricap,
  };
  return ozetImza(ocak, ayar);
}
