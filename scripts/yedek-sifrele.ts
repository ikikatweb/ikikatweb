// MEVCUT DÜZ YEDEKLERİ ŞİFRELE — bir kerelik geçiş aracı.
//
// Şifreleme devreye girdiğinde klasörde zaten ~1,1 GB DÜZ yedek duruyordu (TC kimlik dahil).
// Yeni yedekler şifreli yazılıyor ama eskiler açıkta kaldığı sürece risk sürer.
//
// Bu script her düz dosyayı şifreler, sonra ÇÖZÜP ORİJİNALLE KARŞILAŞTIRIR (SHA-256) ve ancak
// birebir aynıysa düz kopyayı siler. Doğrulama geçmezse .enc atılır, düz dosya YERİNDE KALIR —
// hiçbir koşulda elde yedeksiz kalınmaz.
//
// Kullanım:
//   npx tsx scripts/yedek-sifrele.ts "C:\ikikatweb-yedek\db"             → dener, SİLMEZ (prova)
//   npx tsx scripts/yedek-sifrele.ts "C:\ikikatweb-yedek\db" --sil       → doğrulanınca düzü siler
//   npx tsx scripts/yedek-sifrele.ts "C:\ikikatweb-yedek" --sil          → alt klasörler dahil
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { sifreliYaz, sifreCoz, SIFRELI_UZANTI } from "@/lib/yedek/sifre";

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

/** Büyük dosyada belleği şişirmeden SHA-256. */
function ozet(yol: string): Promise<string> {
  return new Promise((coz, hata) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(yol).on("data", (p) => h.update(p)).on("end", () => coz(h.digest("hex"))).on("error", hata);
  });
}

function duzDosyalar(klasor: string): string[] {
  const out: string[] = [];
  for (const ad of fs.readdirSync(klasor)) {
    const tam = path.join(klasor, ad);
    if (fs.statSync(tam).isDirectory()) out.push(...duzDosyalar(tam));
    else if (!ad.endsWith(SIFRELI_UZANTI) && !ad.endsWith(".iniyor") && !ad.endsWith(".yaziliyor") && !ad.endsWith(".log")) out.push(tam);
  }
  return out;
}

async function main() {
  const klasor = process.argv[2];
  const sil = process.argv.includes("--sil");
  if (!klasor || !fs.existsSync(klasor)) {
    console.error('Kullanım: npx tsx scripts/yedek-sifrele.ts "<klasor>" [--sil]');
    process.exit(1);
  }
  if (!(process.env.YEDEK_SIFRE_ANAHTARI ?? "").trim()) {
    console.error("HATA: YEDEK_SIFRE_ANAHTARI tanımlı değil (.env.local).");
    process.exit(1);
  }

  const liste = duzDosyalar(klasor);
  console.log(`${liste.length} düz dosya bulundu${sil ? "" : " (PROVA — hiçbir şey silinmeyecek)"}\n`);
  let ok = 0, atlanan = 0, hata = 0, silinen = 0, toplam = 0;

  for (const d of liste) {
    const enc = d + SIFRELI_UZANTI;
    if (fs.existsSync(enc)) { atlanan++; continue; }   // zaten şifrelenmiş
    const boyut = fs.statSync(d).size;
    try {
      // 1) şifrele
      await sifreliYaz(enc, fs.readFileSync(d));
      // 2) ÇÖZ ve orijinalle karşılaştır — doğrulanmadan hiçbir şey silinmez
      const gecici = `${enc}.dogrulama`;
      await sifreCoz(enc, gecici);
      const [a, b] = await Promise.all([ozet(d), ozet(gecici)]);
      fs.unlinkSync(gecici);
      if (a !== b) throw new Error("çözülen içerik orijinalle AYNI DEĞİL");
      ok++; toplam += boyut;
      if (sil) { fs.unlinkSync(d); silinen++; }
      console.log(`  ✓ ${path.relative(klasor, d)} (${mb(boyut)})${sil ? " — düz kopya silindi" : ""}`);
    } catch (e) {
      hata++;
      try { if (fs.existsSync(enc)) fs.unlinkSync(enc); } catch { /* yoksay */ }
      console.error(`  ✗ ${path.relative(klasor, d)}: ${e instanceof Error ? e.message : String(e)} — DÜZ DOSYA YERİNDE BIRAKILDI`);
    }
  }

  console.log(`\nBitti: ${ok} şifrelendi (${mb(toplam)}), ${atlanan} zaten şifreliydi, ${hata} hata, ${silinen} düz kopya silindi.`);
  if (!sil && ok) console.log("Düz kopyaları silmek için aynı komutu --sil ile çalıştırın.");
  process.exit(hata ? 1 : 0);
}

main().catch((e) => { console.error("HATA:", e instanceof Error ? e.message : String(e)); process.exit(1); });
