// MUHASEBENİN İCRA CEVABI SENKRONU — IMAP'ın izinli olduğu makinede (şirket ağı /
// Türkiye IP) çalışır. Muhasebeye gönderilen icra yazısına gelen cevabı posta
// kutusunda yakalar ve dosyanın yanında "cevap geldi" işareti yanar
// (lib/icra/muhasebe-cevap-fetch). Vercel mail sunucusuna bağlanamadığı için
// bildirge ve arvento senkronları gibi bu da PC'de Görev Zamanlayıcı ile döner.
//
// CEVABIN İÇERİĞİNİ OKUMAZ: borç durumu ve cevap şekli maildeki serbest metinden
// çıkarılmıyor — işaret haber verir, kararı insan panele girer.
//
// Çalıştırma (proje klasöründe):
//   npx tsx scripts/icra-muhasebe-cevap-sync.ts        → son 14 günü tara
//   npx tsx scripts/icra-muhasebe-cevap-sync.ts 30     → son 30 günü tara
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

const gun = parseInt(process.argv[2] || "14", 10);

// process.exit() ANINDA ÇAĞIRILMIYOR: Node 25 + libuv'de kapanmakta olan bir IMAP
// soketi varken hemen çıkmak süreci 0xC0000409 ile düşürüyor ve iş bitmiş olsa
// bile görev "çöktü" görünüyor (bildirge senkronunda yaşandı).
function bitir(kod: number) {
  process.exitCode = kod;
  setTimeout(() => process.exit(kod), 10000).unref();
}

async function main() {
  try {
    const { muhasebeCevaplariniTara } = await import("@/lib/icra/muhasebe-cevap-fetch");
    const s = await muhasebeCevaplariniTara(gun);
    const zaman = new Date().toLocaleString("tr-TR");
    const ozet = s.isaretlenen.map((k) => `${k.dosya} (${k.gonderen}/${k.kutu})`).join(", ");
    console.log(`${zaman} → ${s.eslesme} dosyaya cevap işareti / ${s.taranan} mail tarandı${ozet ? " | " + ozet : ""}`);
    if (s.uyari.length) console.log("Uyarı:", s.uyari.slice(0, 5).join(" · "));
    bitir(0);
  } catch (e) {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    bitir(1);
  }
}
void main();
