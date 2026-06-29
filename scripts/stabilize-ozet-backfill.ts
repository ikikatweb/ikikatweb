// Stabilize harita özeti — YEREL backfill. Belirtilen tarih aralığındaki HER gün için özeti
// hesaplayıp arvento_harita_ozet'e upsert eder (Vercel'de DEĞİL; bu makinede çalışır).
//
// Çalıştırma (proje klasöründe):
//   npx tsx scripts/stabilize-ozet-backfill.ts 2026-06-01 2026-06-29
//   npx tsx scripts/stabilize-ozet-backfill.ts 2026-06-15            → tek gün
//
// Günler SIRALI işlenir (bağlantı havuzu korunur). Her gün sonrası kısa log basar.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(__dirname, "..");

// .env.local'i process.env'e yükle (zaten tanımlıysa üzerine yazma) — service-role anahtarı için ŞART.
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

function tarihGecerli(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00"));
}

async function main() {
  const bas = process.argv[2];
  const bitis = process.argv[3] || bas;
  if (!bas || !tarihGecerli(bas) || !tarihGecerli(bitis)) {
    console.error("Kullanım: npx tsx scripts/stabilize-ozet-backfill.ts <baslangic YYYY-MM-DD> [bitis YYYY-MM-DD]");
    process.exit(1);
  }

  // Çekirdek/sunucu modülünü import et (env yüklendikten SONRA — service client env'i okur).
  const { serviceClient, getAyarServer, gunOzetiHesapla } = await import("@/lib/arvento/stabilize-ozet-server");

  const supabase = serviceClient();
  const ayarCache = await getAyarServer(supabase); // ayarları bir kez çek

  // Gün listesi (artan).
  const gunler: string[] = [];
  const d = new Date(bas + "T00:00:00");
  const son = new Date(bitis + "T00:00:00");
  for (; d <= son; d.setDate(d.getDate() + 1)) {
    gunler.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  if (gunler.length === 0) gunler.push(bas);

  console.log(`Backfill: ${gunler.length} gün (${bas} → ${bitis})`);
  let toplamDamper = 0;
  // SIRALI — paralel DEĞİL (havuz).
  for (const gun of gunler) {
    try {
      const { imza, payload } = await gunOzetiHesapla(gun, supabase, ayarCache);
      const { error } = await supabase
        .from("arvento_harita_ozet")
        .upsert(
          { rapor_tarihi: gun, sekme: "stabilize", imza, payload },
          { onConflict: "rapor_tarihi,sekme" },
        );
      if (error) throw error;
      toplamDamper += payload.dampers.length;
      console.log(`${gun} → ${payload.dampers.length} damper kaydedildi`);
    } catch (e) {
      console.error(`${gun} → HATA: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`Bitti. Toplam ${toplamDamper} damper.`);
  process.exit(0);
}

main();
