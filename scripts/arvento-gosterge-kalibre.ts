// Araç göstergesi KALİBRASYONU — gerçek okumalardan Arvento farkını hesaplar.
//
// Arvento cihazın kendi saydığı değeri verir; aracın gösterge sayacını bilmez.
// Bu yüzden araç başına sabit bir fark tutulur:  gerçek = Arvento + fark
//
// Kullanım: araçlar STOP hâldeyken gösterge değerlerini okuyun (o sırada Arvento da
// ilerlemediği için fark birebir tutar), bir metin dosyasına yazın ve bu script'i
// çalıştırın. Her satırda önce plaka, sonra değer gelir; aradaki "=" ya da "-" şart değil,
// sondaki birim (km/sa/saat) yazılabilir. Boş satır ve # ile başlayan satır yok sayılır.
// Ondalık/binlik ayraçları serbest (452.146 · 452146 · 452.146,0 hepsi olur).
//
//   60 ACE 788 = 452146
//   60 bp 842 177700 km
//   60-00-10-0011 - 21055 sa     # ekskavatör: motor saati
//   34-00-15-13879 15192,6 sa
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
    let s = satir.split("#")[0].trim();
    if (!s) continue;
    // Sondaki birim yazısı atılır: "177700 km", "21055 sa", "15192,6 saat"
    s = s.replace(/\s*(km|sa|saat|h)\s*$/i, "").trim();
    // Son SAYI değerdir, öncesi plakadır. Böylece hem "60 ACE 788 = 452146" hem de
    // kullanıcının doğal yazımı ("60 bp 842 177700", "60-00-10-0011 - 21055") okunur.
    const parcalar = s.split(/[\s=]+/).filter((x) => x && x !== "-");
    if (parcalar.length < 2) { hatali.push(satir); continue; }
    const deger = sayiCoz(parcalar[parcalar.length - 1]);
    const plaka = parcalar.slice(0, -1).join(" ").trim();
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
  const { data: kartlar } = await sb.from("araclar").select("id, plaka, cinsi, sayac_tipi, guncel_gosterge, arvento_fark, arvento_fark_tarihi");
  type K = { id: string; plaka: string; cinsi: string | null; sayac_tipi: string | null; guncel_gosterge: number | null; arvento_fark: number | null; arvento_fark_tarihi: string | null };
  const kartByPlaka = new Map(((kartlar ?? []) as K[]).map((k) => [plakaAnahtar(k.plaka), k]));

  // 4) Hesapla
  // kayitliFark/kalibreTarih: daha önce kalibre edilmiş araçlarda SAPMAYI gösterebilmek için.
  // Sapma = yeni hesaplanan fark − kayıtlı fark. Sıfırdan uzaklaştıkça sayaç kaymış demektir
  // (saatli iş makinelerinde Arvento kontak sayıyor, makine çalışma saati tutuyor → kayma beklenir).
  const yazilacak: { id: string; plaka: string; birim: string; okuma: number; arv: number; fark: number;
    eski: number | null; kayitliFark: number | null; kalibreTarih: string | null }[] = [];
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
      kayitliFark: kart.arvento_fark, kalibreTarih: kart.arvento_fark_tarihi,
    });
  }
  yazilacak.sort((a, b) => a.plaka.localeCompare(b.plaka, "tr"));

  const isaretli = (v: number) => (v > 0 ? "+" : "") + Math.round(v).toLocaleString("tr-TR");
  console.log(`PLAKA           BİRİM   OKUMANIZ      ARVENTO      YENİ FARK   KAYITLI FARK      SAPMA  SON KALİBRASYON`);
  console.log("-".repeat(108));
  for (const y of yazilacak) {
    const sapma = y.kayitliFark == null ? null : y.fark - y.kayitliFark;
    console.log(
      `${y.plaka.padEnd(15)} ${y.birim.padEnd(6)} ${n(y.okuma).padStart(11)}  ${n(y.arv).padStart(11)}  ` +
      `${isaretli(y.fark).padStart(11)}  ${(y.kayitliFark == null ? "—" : isaretli(y.kayitliFark)).padStart(12)}  ` +
      `${(sapma == null ? "yeni" : isaretli(sapma)).padStart(9)}  ${(y.kalibreTarih ?? "—").slice(0, 10)}`,
    );
  }
  console.log("-".repeat(108));
  const yeniler = yazilacak.filter((y) => y.kayitliFark == null).length;
  const sapanlar = yazilacak.filter((y) => y.kayitliFark != null && Math.abs(y.fark - y.kayitliFark) >= 1);
  console.log(`${yazilacak.length} araç — ${yeniler} ilk kalibrasyon, ${sapanlar.length} araçta sapma var.`);
  if (sapanlar.length) {
    console.log(`En çok sapanlar:`);
    for (const y of [...sapanlar].sort((a, b) => Math.abs(b.fark - b.kayitliFark!) - Math.abs(a.fark - a.kayitliFark!)).slice(0, 8)) {
      console.log(`   ${y.plaka.padEnd(16)} ${isaretli(y.fark - y.kayitliFark!)} ${y.birim}`);
    }
  }
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
