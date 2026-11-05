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

// process.exit() ANINDA ÇAĞIRILMIYOR. Node 25 + libuv'de kapanmakta olan bir IMAP soketi
// varken hemen çıkmak süreci "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" ile
// 0xC0000409 koduyla düşürüyordu: iş BİTMİŞ olmasına rağmen görev "çöktü" görünüyor ve
// (05.11.2026'dan beri) her 2 dakikada bir boş yere hata bildirimi üretiyordu.
// Doğal çıkışı bekliyoruz; bir soket takılı kalırsa 10 saniye sonra zorla kapatıyoruz.
function bitir(kod: number) {
  process.exitCode = kod;
  setTimeout(() => process.exit(kod), 10000).unref();
}
async function main() {
  try {
    const { tarayVeKapat } = await import("@/lib/personel/bildirge-fetch");
    const s = await tarayVeKapat(gun);
    const zaman = new Date().toLocaleString("tr-TR");
    const ozet = s.kapatilan.map((k) => `${k.ad} (${k.tip === "giris" ? "giriş" : "çıkış"}/${k.kutu})`).join(", ");
    console.log(`${zaman} → ${s.eslesme} kapatıldı / ${s.taranan} PDF tarandı${ozet ? " | " + ozet : ""}`);
    if (s.uyari.length) console.log("Uyarı:", s.uyari.slice(0, 5).join(" · "));
    bitir(0);
  } catch (e) {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    bitir(1);
  }
}
main();
