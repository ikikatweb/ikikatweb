// Araç göstergesi KALİBRASYONU — gerçek okumalardan Arvento farkını hesaplar.
//
// Arvento cihazın kendi saydığı değeri verir; aracın gösterge sayacını bilmez.
// Bu yüzden araç başına sabit bir fark tutulur:  gerçek = Arvento + fark
//
// Kullanım: araçlar STOP hâldeyken gösterge değerlerini okuyun (o sırada Arvento da
// ilerlemediği için fark birebir tutar), bir metin dosyasına yazın ve bu script'i
// çalıştırın. Her satır "plaka = değer" biçiminde; boş satır ve # ile başlayan satır
// yok sayılır. Ondalık/binlik ayraçları serbest (452.146 · 452146 · 452.146,0 hepsi olur).
//
//   60 ACE 788 = 452146
//   60-00-10-0011 = 20818        # ekskavatör: motor saati
//   34 GF 3763 = 486795
//
// Çalıştırma:
//   npx tsx scripts/arvento-gosterge-kalibre.ts okumalar.txt          → ne yapılacağını göster
//   npx tsx scripts/arvento-gosterge-kalibre.ts okumalar.txt --uygula → farkları kaydet
//
// --uygula verilmeden HİÇBİR ŞEY yazılmaz.
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

const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("tr-TR"));

// "452.146,5" / "452146" / "452 146" → 452146.5
function sayiCoz(s: string): number | null {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  // Son ayraç ondalıksa onu koru, binlik ayraçlarını at
  const sonVirgul = t.lastIndexOf(",");
  const sonNokta = t.lastIndexOf(".");
  let temiz = t;
  if (sonVirgul > sonNokta) temiz = t.replace(/\./g, "").replace(",", ".");
  else if (sonNokta > -1 && t.length - sonNokta - 1 !== 3) temiz = t.replace(/,/g, "");
  else temiz = t.replace(/[.,]/g, "");
  const v = parseFloat(temiz);
  return Number.isFinite(v) ? v : null;
}

// Plakaları karşılaştırırken boşluk/tire farkları sorun olmasın
const plakaAnahtar = (s: string) => s.toLocaleUpperCase("tr-TR").replace(/[^A-Z0-9]/g, "");

async function main() {
  const dosya = process.argv[2];
  const uygula = process.argv.includes("--uygula");
  if (!dosya || !fs.existsSync(dosya)) {
    console.error("Kullanım: npx tsx scripts/arvento-gosterge-kalibre.ts <okumalar.txt> [--uygula]");
    process.exit(1);
  }

  // 1) Okumaları oku
  const okumalar = new Map<string, { plaka: string; deger: number }>();
  const hatali: string[] = [];
  for (const satir of fs.readFileSync(dosya, "utf8").split(/\r?\n/)) {
    const s = satir.split("#")[0].trim();
    if (!s) continue;
    const i = s.lastIndexOf("=");
    if (i < 0) { hatali.push(satir); continue; }
    const plaka = s.slice(0, i).trim();
    const deger = sayiCoz(s.slice(i + 1));
    if (!plaka || deger == null) { hatali.push(satir); continue; }
    okumalar.set(plakaAnahtar(plaka), { plaka, deger });
  }
  if (hatali.length) {
    console.log(`Okunamayan ${hatali.length} satır (yok sayıldı):`);
    for (const h of hatali) console.log("   " + h);
    console.log("");
  }
  if (okumalar.size === 0) { console.error("Geçerli okuma yok."); process.exit(1); }

  // 2) Arvento anlık + node→plaka
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da Supabase anahtarları yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { cekAnlikDurum } = await import("@/lib/arvento/anlik");
  const { araclar: anlik } = await cekAnlikDurum();
  const { data: cihazlar } = await sb.from("arvento_cihaz").select("node, plaka");
  const nodePlaka = new Map(((cihazlar ?? []) as { node: string; plaka: string | null }[])
    .map((c) => [c.node, c.plaka]));

  const arvento = new Map<string, { deger: number; son: string | null }>();
  for (const a of anlik) {
    const p = nodePlaka.get(String(a.node));
    if (p && a.odometre != null) arvento.set(plakaAnahtar(p), { deger: a.odometre, son: a.tarih });
  }

  // 3) Araç kartları
  const { data: kartlar } = await sb.from("araclar").select("id, plaka, cinsi, sayac_tipi, guncel_gosterge");
  type K = { id: string; plaka: string; cinsi: string | null; sayac_tipi: string | null; guncel_gosterge: number | null };
  const kartByPlaka = new Map(((kartlar ?? []) as K[]).map((k) => [plakaAnahtar(k.plaka), k]));

  // 4) Hesapla
  const yazilacak: { id: string; plaka: string; birim: string; okuma: number; arv: number; fark: number; eski: number | null }[] = [];
  const atlanan: string[] = [];

  for (const [anahtar, o] of okumalar) {
    const kart = kartByPlaka.get(anahtar);
    if (!kart) { atlanan.push(`${o.plaka}: araç kartı bulunamadı`); continue; }
    const arv = arvento.get(anahtar);
    if (!arv) { atlanan.push(`${o.plaka}: Arvento'da bu araç yok / odometre boş`); continue; }
    yazilacak.push({
      id: kart.id, plaka: kart.plaka,
      birim: kart.sayac_tipi === "saat" ? "saat" : "km",
      okuma: o.deger, arv: arv.deger, fark: o.deger - arv.deger, eski: kart.guncel_gosterge,
    });
  }
  yazilacak.sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));

  console.log(`PLAKA           BİRİM   OKUMANIZ      ARVENTO       FARK          KARTTAKİ ESKİ`);
  console.log("-".repeat(86));
  for (const y of yazilacak) {
    console.log(
      `${y.plaka.padEnd(15)} ${y.birim.padEnd(6)} ${n(y.okuma).padStart(11)}  ${n(y.arv).padStart(11)}  ` +
      `${((y.fark > 0 ? "+" : "") + Math.round(y.fark).toLocaleString("tr-TR")).padStart(11)}   ${n(y.eski).padStart(11)}`,
    );
  }
  console.log("-".repeat(86));
  console.log(`${yazilacak.length} araç kalibre edilecek.`);
  if (atlanan.length) {
    console.log(`\nAtlananlar (${atlanan.length}):`);
    for (const a of atlanan) console.log("   " + a);
  }

  if (!uygula) {
    console.log(`\nHiçbir şey yazılmadı. Kaydetmek için komutun sonuna --uygula ekleyin.`);
    return;
  }

  const simdi = new Date().toISOString();
  let ok = 0;
  for (const y of yazilacak) {
    const { error } = await sb.from("araclar").update({
      arvento_fark: y.fark,
      arvento_fark_tarihi: simdi,
      guncel_gosterge: y.okuma,
      arvento_gosterge: y.okuma,
      updated_at: simdi,
    }).eq("id", y.id);
    if (error) console.error(`  HATA ${y.plaka}: ${error.message}`);
    else ok++;
  }
  console.log(`\n${ok} aracın farkı kaydedildi ve göstergesi okumanızla güncellendi.`);
  console.log(`Bundan sonra senkron her turda: gösterge = Arvento + fark.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
