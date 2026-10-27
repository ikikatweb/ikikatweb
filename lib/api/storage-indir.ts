// SUNUCUDA STORAGE DOSYASI İNDİRME — kayıtlı URL'den, service role ile.
//
// NEDEN: bucket'lar 26.10.2026'da ÖZELe çevrildi (ruhsatlar, evrak taramaları, kasa slipleri
// internette anahtarsız okunabiliyordu). Veritabanındaki URL'ler ise eski "public" biçiminde
// KALDI. Sunucu tarafında `fetch(url)` ile indiren her yer o günden sonra 400 almaya başladı
// ve çoğu hatayı yutup işine devam ediyordu: kasko teklif maili RUHSAT EKİ OLMADAN gitti,
// kimse fark etmedi. Bu yüzden sunucuda dosya indiren her yer buradan geçer.
//
// Dosya storage'da değilse (dış bir adres) düz fetch'e düşer — davranış eskisi gibi kalsın.
import { createClient } from "@supabase/supabase-js";

/** Kayıtlı URL → { bucket, yol }. Biçim: .../storage/v1/object/[public|sign|authenticated]/<bucket>/<yol> */
export function storageYolu(url: string): { bucket: string; yol: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], yol: decodeURIComponent(m[2].split("?")[0]) };
}

/**
 * Dosyayı indirir. Önce service role ile storage'dan (bucket özel olsa da iner),
 * olmazsa doğrudan adresten. İnemezse null döner — çağıran SESSİZCE GEÇMEMELİ,
 * kullanıcıya eksik ek/belge olduğunu söylemeli.
 */
export async function storageIndir(url: string): Promise<Buffer | null> {
  const proje = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const konum = storageYolu(url);
  if (konum && proje && anahtar && url.startsWith(proje)) {
    try {
      const sb = createClient(proje, anahtar, { auth: { persistSession: false } });
      const { data } = await sb.storage.from(konum.bucket).download(konum.yol);
      if (data) return Buffer.from(await data.arrayBuffer());
    } catch { /* aşağıda düz fetch denenir */ }
  }
  try {
    const r = await fetch(url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
  } catch { /* indirilemedi */ }
  return null;
}
