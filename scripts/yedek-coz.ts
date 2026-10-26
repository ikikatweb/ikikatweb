// ŞİFRELİ YEDEĞİ ÇÖZ — geri yükleme aracı.
//
// Yedek alınıyor ama açılamıyorsa yedek sayılmaz; şifrelemenin karşılığı bu script'tir.
// Anahtar .env.local'deki YEDEK_SIFRE_ANAHTARI'dan okunur (ortam değişkeni olarak da verilebilir).
//
// Kullanım (proje klasöründe):
//   npx tsx scripts/yedek-coz.ts "C:\ikikatweb-yedek\db\ikikatweb-yedek-2026-10-31_12-00.json.enc"
//        → aynı klasöre .json olarak çözer
//   npx tsx scripts/yedek-coz.ts <dosya.enc> C:\gecici\yedek.json
//        → verilen yola çözer
//   npx tsx scripts/yedek-coz.ts --klasor "C:\ikikatweb-yedek\dosyalar"
//        → klasördeki TÜM .enc dosyalarını yanlarına çözer (Storage aynası geri yüklemesi)
//   npx tsx scripts/yedek-coz.ts --dogrula "C:\ikikatweb-yedek\db"
//        → çözmeden yalnız DOĞRULAR (etiket tutuyor mu, anahtar doğru mu)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sifreCoz, SIFRELI_UZANTI } from "@/lib/yedek/sifre";

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

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

function encDosyalari(klasor: string): string[] {
  const out: string[] = [];
  for (const ad of fs.readdirSync(klasor)) {
    const tam = path.join(klasor, ad);
    if (fs.statSync(tam).isDirectory()) out.push(...encDosyalari(tam));
    else if (ad.endsWith(SIFRELI_UZANTI)) out.push(tam);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!(process.env.YEDEK_SIFRE_ANAHTARI ?? "").trim()) {
    console.error("HATA: YEDEK_SIFRE_ANAHTARI tanımlı değil (.env.local). Anahtar olmadan yedek açılamaz.");
    process.exit(1);
  }

  const kipKlasor = argv[0] === "--klasor";
  const kipDogrula = argv[0] === "--dogrula";

  if (kipKlasor || kipDogrula) {
    const klasor = argv[1];
    if (!klasor || !fs.existsSync(klasor)) { console.error("Klasör bulunamadı:", klasor); process.exit(1); }
    const liste = encDosyalari(klasor);
    if (liste.length === 0) { console.log("Şifreli dosya yok."); return; }
    console.log(`${liste.length} şifreli dosya — ${kipDogrula ? "DOĞRULAMA" : "çözme"} başlıyor…`);
    let ok = 0, hata = 0;
    for (const d of liste) {
      const hedef = kipDogrula
        ? `${d}.dogrulama-${process.pid}`
        : d.slice(0, -SIFRELI_UZANTI.length);
      try {
        await sifreCoz(d, hedef);
        ok++;
        if (kipDogrula) fs.unlinkSync(hedef);
        else console.log(`  ✓ ${path.basename(hedef)} (${mb(fs.statSync(hedef).size)})`);
      } catch (e) {
        hata++;
        console.error(`  ✗ ${path.basename(d)}: ${e instanceof Error ? e.message : String(e)}`);
        try { if (fs.existsSync(hedef)) fs.unlinkSync(hedef); } catch { /* yoksay */ }
      }
    }
    console.log(`Bitti: ${ok} başarılı, ${hata} hatalı.`);
    process.exit(hata ? 1 : 0);
  }

  const kaynak = argv[0];
  if (!kaynak || !fs.existsSync(kaynak)) {
    console.error("Kullanım: npx tsx scripts/yedek-coz.ts <dosya.enc> [cikti] | --klasor <klasor> | --dogrula <klasor>");
    process.exit(1);
  }
  const hedef = argv[1] ?? (kaynak.endsWith(SIFRELI_UZANTI) ? kaynak.slice(0, -SIFRELI_UZANTI.length) : `${kaynak}.cozuk`);
  await sifreCoz(kaynak, hedef);
  console.log(`Çözüldü → ${hedef} (${mb(fs.statSync(hedef).size)})`);
}

main().catch((e) => { console.error("HATA:", e instanceof Error ? e.message : String(e)); process.exit(1); });
