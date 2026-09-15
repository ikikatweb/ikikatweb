// BİLDİRİM BUDAMA — bildirim_gecmisi tablosundaki eski kayıtları siler.
//
// NEDEN: bildirimler hiç silinmiyordu. Tablo ayda ~11.000 satır büyüyor (Nisan → Eylül 2026
// arası 56.632 satır). Zil rozeti bu tabloyu 30 saniyede bir sorguladığı için tablo büyüdükçe
// hem sorgu hem Supabase çıkış trafiği pahalılaşıyor. 60 günden eski bildirimin kimseye
// faydası yok — menü zaten günlük geçmiş gösteriyor.
//
// Bu iş sql/bildirim_egress.sql'in son adımıyla AYNI şeyi yapar; oradaki DELETE'i elle
// çalıştırmak yerine bu script'i zamanlanmış görevle ayda bir döndürmek yeterli.
// DDL gerektirmez — sıradan filtreli silme, mevcut servis anahtarıyla çalışır.
//
// Silme, kimlik listeleriyle PARÇA PARÇA yapılır: tek seferde 30 bin satır silen bir HTTP
// isteği zaman aşımına düşebilir; parçalı gidince yarıda kalsa bile silinenler kalıcıdır,
// bir sonraki tur kaldığı yerden devam eder.
//
// Çalıştırma:
//   npx tsx scripts/bildirim-buda.ts            → 60 günden eskileri sil
//   npx tsx scripts/bildirim-buda.ts --kuru     → hiçbir şey silme, ne silinecekti göster
//   npx tsx scripts/bildirim-buda.ts --gun=90   → eşiği değiştir
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(__dirname, "..");
for (const dosya of [".env.local", ".env"]) {
  const p = path.join(kok, dosya);
  if (!fs.existsSync(p)) continue;
  for (const satir of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const i = satir.indexOf("=");
    if (i < 0 || satir.trim().startsWith("#")) continue;
    const k = satir.slice(0, i).trim();
    const v = satir.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

const KURU = process.argv.includes("--kuru");
const gunArg = process.argv.find((a) => a.startsWith("--gun="));
const SAKLAMA_GUN = gunArg ? parseInt(gunArg.slice("--gun=".length), 10) : 60;
const PARCA = 500; // tek istekte silinecek kayıt sayısı

async function main() {
  if (!Number.isFinite(SAKLAMA_GUN) || SAKLAMA_GUN < 7) {
    throw new Error(`--gun değeri en az 7 olmalı (verilen: ${SAKLAMA_GUN}). Kazara tüm tabloyu silmeyi önlemek için.`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Eşik: bugünden SAKLAMA_GUN gün öncesi (TR günü). Bu tarihten ÖNCEKİ kayıtlar silinir.
  const esik = new Date(Date.now() + 3 * 3600000);
  esik.setUTCDate(esik.getUTCDate() - SAKLAMA_GUN);
  const esikTarih = esik.toISOString().slice(0, 10);

  const { count: toplam, error: sayimHata } = await sb
    .from("bildirim_gecmisi")
    .select("id", { count: "exact", head: true })
    .lt("tarih", esikTarih);
  if (sayimHata) throw new Error(`Sayım başarısız: ${sayimHata.message}`);

  const { count: tumSatir } = await sb
    .from("bildirim_gecmisi")
    .select("id", { count: "exact", head: true });

  console.log(`Tablo: ${tumSatir ?? "?"} satır`);
  console.log(`${esikTarih} öncesi (${SAKLAMA_GUN} günden eski): ${toplam ?? 0} satır${KURU ? "  [KURU ÇALIŞMA — silme yok]" : ""}`);
  if (!toplam) { console.log("Silinecek kayıt yok."); return; }
  if (KURU) { console.log(`Kuru çalışma: ${toplam} satır silinecekti.`); return; }

  let silinen = 0;
  // Her turda en eski PARCA kadar kimliği al ve onları sil. Silinen satır bir daha
  // seçilmeyeceği için döngü kendiliğinden ilerler; sonsuz döngüye düşerse (silme
  // sessizce başarısız olursa) ilerleme olmadığı anlaşılır ve çıkılır.
  for (;;) {
    const { data, error } = await sb
      .from("bildirim_gecmisi")
      .select("id")
      .lt("tarih", esikTarih)
      .order("tarih", { ascending: true })
      .limit(PARCA);
    if (error) throw new Error(`Kimlik okuma hatası: ${error.message}`);
    const idler = (data ?? []).map((r) => (r as { id: string }).id);
    if (idler.length === 0) break;

    const { error: silHata } = await sb.from("bildirim_gecmisi").delete().in("id", idler);
    if (silHata) throw new Error(`Silme hatası: ${silHata.message}`);
    silinen += idler.length;
    process.stdout.write(`\r  silinen: ${silinen} / ${toplam}`);
  }
  process.stdout.write("\n");
  console.log(`Bitti: ${silinen} satır silindi. Kalan tablo ~${(tumSatir ?? 0) - silinen} satır.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
