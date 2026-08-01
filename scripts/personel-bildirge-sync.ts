// Personel BİLDİRGE senkronu — IMAP'ın izinli olduğu makinede (şirket ağı / Türkiye IP) çalışır.
// Muhasebenin cevabındaki SGK işe giriş / işten ayrılış bildirgesi PDF'ini yakalar, TC ile eşleyip
// açık talebi kapatır (lib/personel/bildirge-fetch). Vercel mail sunucusuna bağlanamadığı için
// (bkz. arvento-mail-sync) bu kontrol de PC'de Görev Zamanlayıcı ile döner.
//
// Çalıştırma (proje klasöründe):
//   npx tsx scripts/personel-bildirge-sync.ts        → son 7 günü tara
//   npx tsx scripts/personel-bildirge-sync.ts 3      → son 3 günü tara
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
    const { tarayVeKapat } = await import("@/lib/personel/bildirge-fetch");
    const s = await tarayVeKapat(gun);
    const zaman = new Date().toLocaleString("tr-TR");
    const ozet = s.kapatilan.map((k) => `${k.ad} (${k.tip === "giris" ? "giriş" : "çıkış"}/${k.kutu})`).join(", ");
    console.log(`${zaman} → ${s.eslesme} kapatıldı / ${s.taranan} PDF tarandı${ozet ? " | " + ozet : ""}`);
    if (s.uyari.length) console.log("Uyarı:", s.uyari.slice(0, 5).join(" · "));
    process.exit(0);
  } catch (e) {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
main();
