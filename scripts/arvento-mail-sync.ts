// Arvento MAIL senkronu — IMAP'ın izinli olduğu makinede (şirket ağı / Türkiye IP) çalışır.
// Vercel mail sunucusuna (paylaşımlı hosting) bağlanamadığı için gece cron'u orada başarısız
// oluyor; bu script aynı işi sizin makinenizde yapıp raporları doğrudan Supabase'e yazar
// (cekVeIsleArventoMail zaten ingestArventoBuffer ile DB'ye upsert eder).
//
// Çalıştırma (proje klasöründe):
//   npx tsx scripts/arvento-mail-sync.ts          → son 7 günü tara
//   npx tsx scripts/arvento-mail-sync.ts 3        → son 3 günü tara
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(__dirname, "..");

// .env.local'i process.env'e yükle (zaten tanımlıysa üzerine yazma)
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

const gun = parseInt(process.argv[2] || "7", 10);
async function main() {
  try {
    const { cekVeIsleArventoMail } = await import("@/lib/arvento/mail-fetch");
    const sonuc = await cekVeIsleArventoMail(gun);
    const zaman = new Date().toLocaleString("tr-TR");
    console.log(`${zaman} → ${sonuc.ok ? "OK" : "VERİ YOK"} | ${sonuc.mesaj}`);
    if (sonuc.uyari?.length) console.log("Uyarı:", sonuc.uyari[0]);
    process.exit(0);
  } catch (e) {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
main();
