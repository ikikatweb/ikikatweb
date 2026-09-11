// Netsim ↔ şantiye EŞLEŞTİRME — hangi şantiyenin Netsim'de hangi "işlem noktası"
// olduğunu bir kez bağlar. netsim-sync.ts bu eşleşmeyi kullanır.
//
// Ada göre otomatik eşleştirme SADECE ÖNERİDİR: Netsim iş adlarını 40 karaktere
// kırpıyor, bu yüzden önce normalize edip ön-ek/kelime örtüşmesine bakarız.
// Yazma işlemi --uygula verilmeden YAPILMAZ; önce listeyi görüp onaylarsınız.
//
// Çalıştırma:
//   npx tsx scripts/netsim-eslestir.ts              → öneri listesini göster (hiçbir şey yazmaz)
//   npx tsx scripts/netsim-eslestir.ts --uygula     → kesin eşleşmeleri Supabase'e yaz
//   npx tsx scripts/netsim-eslestir.ts --bagla <santiye_id> <nokta_no>  → tek bir eşleşmeyi elle kur
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

type FbDb = {
  query: (sql: string, p: unknown[], cb: (e: Error | null, r: Record<string, unknown>[]) => void) => void;
  detach: (cb?: () => void) => void;
};
type FbModule = { attach: (o: Record<string, unknown>, cb: (e: Error | null, db: FbDb) => void) => void };

const fbAyar = {
  host: process.env.NETSIM_DB_HOST,
  port: parseInt(process.env.NETSIM_DB_PORT || "3050", 10),
  database: process.env.NETSIM_DB_PATH,
  user: process.env.NETSIM_DB_USER,
  password: process.env.NETSIM_DB_PASSWORD,
  lowercase_keys: false,
  role: null,
  pageSize: 4096,
};

async function fbBagla(): Promise<FbDb> {
  const fb = (await import("node-firebird")) as unknown as FbModule;
  return new Promise((res, rej) => fb.attach(fbAyar, (e, db) => (e ? rej(e) : res(db))));
}
function fbSorgu(db: FbDb, sql: string, p: unknown[] = []): Promise<Record<string, unknown>[]> {
  return new Promise((res, rej) => db.query(sql, p, (e, r) => (e ? rej(e) : res(r ?? []))));
}

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok.");
  return createClient(url, key, { auth: { persistSession: false } });
}

// "Karabük Mrk. Cevizlidere 2.Kısım" → "KARABUK MRK CEVIZLIDERE 2 KISIM"
function normalize(s: string): string {
  return (s || "")
    .toUpperCase()
    .replace(/İ/g, "I").replace(/I/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// Netsim adları VARCHAR(40) — kırpılmış olabilir. Bu yüzden:
//   1) Netsim adı, şantiye adının ön-eki mi? (kırpma senaryosu) → çok güçlü sinyal,
//      ama SADECE yeterince uzunsa. "HARİTA" gibi kısa adlar ön-ek sayılmaz.
//   2) Değilse ortak kelime oranı — en az 2 ortak kelime şartıyla.
//
// DİKKAT: Burada "min(nk,sk)" kullanmak tek kelimelik adların (HARİTA, İNŞAAT)
// içinde o kelime geçen HER şantiyeye %100 vermesine yol açıyordu. Bu yüzden
// payda olarak Netsim adının kelime sayısı alınır ve tek kelimelik adlar elenir.
const ONEK_MIN_UZUNLUK = 15;

function kelimeler(s: string): Set<string> {
  return new Set(s.split(" ").filter((x) => x.length > 2));
}

function benzerlik(netsimAd: string, santiyeAd: string): number {
  const n = normalize(netsimAd);
  const s = normalize(santiyeAd);
  if (!n || !s) return 0;

  const nk = kelimeler(n);
  const sk = kelimeler(s);
  // Tek anlamlı kelimeden ibaret Netsim adı ("HARİTA") hiçbir şeyle eşleştirilmez —
  // ayırt edici değil, kategori adı olma ihtimali yüksek.
  if (nk.size < 2 || sk.size < 2) return 0;

  // Kırpılmış ad, şantiye adının başlangıcıysa: kesin eşleşme
  if (n.length >= ONEK_MIN_UZUNLUK && (s.startsWith(n) || n.startsWith(s))) return 1;

  let ortak = 0;
  for (const k of nk) if (sk.has(k)) ortak++;
  if (ortak < 2) return 0;
  return ortak / nk.size;
}

type Santiye = { id: string; is_adi: string; netsim_nokta_no: number | null };

async function main() {
  const uygula = process.argv.includes("--uygula");
  // --kisa: zamanlanmış görevde çalışırken log şişmesin diye sadece bağlananları yazar.
  // (Şüpheli/bulunamayan listeleri her turda 200+ satır ekliyordu.)
  const kisa = process.argv.includes("--kisa");
  const baglaIdx = process.argv.indexOf("--bagla");
  const sb = supabase();

  // Elle tek eşleşme kur
  if (baglaIdx >= 0) {
    const santiyeId = process.argv[baglaIdx + 1];
    const noktaNo = parseInt(process.argv[baglaIdx + 2] || "", 10);
    if (!santiyeId || !Number.isFinite(noktaNo)) {
      console.error("Kullanım: --bagla <santiye_id> <nokta_no>");
      process.exit(1);
    }
    const { error } = await sb.from("santiyeler").update({ netsim_nokta_no: noktaNo }).eq("id", santiyeId);
    if (error) { console.error(error.message); process.exit(1); }
    console.log(`Bağlandı: ${santiyeId} → Netsim nokta ${noktaNo}`);
    return;
  }

  const { data, error } = await sb.from("santiyeler").select("id, is_adi, netsim_nokta_no").order("is_adi");
  if (error) throw new Error(error.message);
  const santiyeler = (data ?? []) as Santiye[];

  const db = await fbBagla();
  let netsimler: { no: number; ad: string }[];
  try {
    // Hakedişi olan işlem noktaları — senkronun ilgilendiği tek küme
    // Netsim'deki TÜM işler — hakediş şartı YOK. İş kartı açıldığı anda bağlanabilsin,
    // ilk hakediş kesildiğinde tutar kendiliğinden aksın.
    // Başka noktaların ANA'sı olanlar (İNŞAAT, HARİTA gibi kategori düğümleri) hariç —
    // onlar proje değil, altındaki işlerin üst grubu.
    const rows = await fbSorgu(db, `
      SELECT I.ISLEM_NOKTASI_NO AS NOKTA, I.ISLEM_NOKTASI_ADI AS AD
      FROM ISLMNOKT I
      WHERE I.ISLEM_NOKTASI_NO > 0
      AND NOT EXISTS (
        SELECT 1 FROM ISLMNOKT C
        WHERE C.ANA_ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO
      )
        -- Gerçek bir İŞ olma şartı: ya sözleşme bedeli girilmiş ya da hakedişi var.
        -- İkisi de yoksa bu bir muhasebe kalemi/gider merkezidir (ör. "TARIM VE
        -- HAYVANCILIK İŞLETMESİ"), şantiyeye bağlanmamalı.
        AND (
          COALESCE(I.K_SOZLESME_BEDELI, 0) > 0
          OR EXISTS (
            SELECT 1 FROM ALSAASIL A2
            WHERE A2.ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO AND A2.ISLEM_KODU = 'HAKFAT'
          )
        )
      ORDER BY I.ISLEM_NOKTASI_ADI
    `);
    netsimler = rows.map((r) => ({ no: Number(r.NOKTA), ad: String(r.AD ?? "").trim() }));
  } finally {
    db.detach();
  }

  if (!kisa) console.log(`Netsim'de hakedişi olan ${netsimler.length} iş, Supabase'de ${santiyeler.length} şantiye var.\n`);

  const bagliNoktalar = new Set(santiyeler.map((s) => s.netsim_nokta_no).filter((x): x is number => x != null));
  const kesin: { santiye: Santiye; no: number; ad: string; skor: number }[] = [];
  const belirsiz: { santiye: Santiye; adaylar: { no: number; ad: string; skor: number }[] }[] = [];
  const bulunamadi: Santiye[] = [];

  for (const s of santiyeler) {
    if (s.netsim_nokta_no != null) continue; // zaten bağlı
    const adaylar = netsimler
      .filter((n) => !bagliNoktalar.has(n.no))
      .map((n) => ({ ...n, skor: benzerlik(n.ad, s.is_adi) }))
      .filter((n) => n.skor >= 0.5)
      .sort((a, b) => b.skor - a.skor);

    if (adaylar.length === 0) { bulunamadi.push(s); continue; }
    // Tek aday ve tam ön-ek eşleşmesi → kesin. Aksi halde insana sor.
    if (adaylar[0].skor === 1 && (adaylar.length === 1 || adaylar[1].skor < 1)) {
      kesin.push({ santiye: s, no: adaylar[0].no, ad: adaylar[0].ad, skor: 1 });
    } else {
      belirsiz.push({ santiye: s, adaylar: adaylar.slice(0, 3) });
    }
  }

  // Aynı Netsim işini birden fazla şantiye "kesin" iddia ediyorsa hiçbiri kesin değildir
  // (ör. "Yurt Onarım 1.Kısım" hem 1. hem 3. kısma benziyordu). Hepsi insana sorulur.
  const noktaSayaci = new Map<number, number>();
  for (const k of kesin) noktaSayaci.set(k.no, (noktaSayaci.get(k.no) ?? 0) + 1);
  for (let i = kesin.length - 1; i >= 0; i--) {
    if ((noktaSayaci.get(kesin[i].no) ?? 0) > 1) {
      const k = kesin[i];
      belirsiz.push({ santiye: k.santiye, adaylar: [{ no: k.no, ad: k.ad, skor: k.skor }] });
      kesin.splice(i, 1);
    }
  }

  const zatenBagli = santiyeler.filter((s) => s.netsim_nokta_no != null);
  if (zatenBagli.length && !kisa) {
    console.log(`=== Zaten bağlı (${zatenBagli.length}) ===`);
    for (const s of zatenBagli) console.log(`  [${s.netsim_nokta_no}] ${s.is_adi}`);
    console.log("");
  }

  if (kesin.length > 0 || !kisa) {
    console.log(`=== KESİN eşleşmeler (${kesin.length}) ===`);
    for (const k of kesin) console.log(`  [${k.no}] ${k.ad}\n      → ${k.santiye.is_adi}`);
  }

  if (belirsiz.length && !kisa) {
    console.log(`\n=== ŞÜPHELİ — elle bağlayın (${belirsiz.length}) ===`);
    for (const b of belirsiz) {
      console.log(`  ${b.santiye.is_adi}`);
      for (const a of b.adaylar) {
        console.log(`      [${a.no}] ${a.ad}  (%${Math.round(a.skor * 100)})`);
        console.log(`        npx tsx scripts/netsim-eslestir.ts --bagla ${b.santiye.id} ${a.no}`);
      }
    }
  }

  if (bulunamadi.length && !kisa) {
    console.log(`\n=== Netsim'de karşılığı bulunamadı (${bulunamadi.length}) ===`);
    for (const s of bulunamadi) console.log(`  ${s.is_adi}`);
  }

  if (!uygula) {
    console.log(`\nHiçbir şey yazılmadı. Kesin eşleşmeleri kaydetmek için: --uygula`);
    return;
  }
  // Bağlanacak bir şey yoksa sessizce çık — zamanlanmış görev her 15 dakikada
  // "0 eşleşme kaydedildi" satırı yazmasın.
  if (kesin.length === 0) {
    if (!kisa) console.log("\nBağlanacak kesin eşleşme yok.");
    return;
  }

  let yazilan = 0;
  for (const k of kesin) {
    const { error: e } = await sb.from("santiyeler").update({ netsim_nokta_no: k.no }).eq("id", k.santiye.id);
    if (e) console.error(`  HATA ${k.santiye.is_adi}: ${e.message}`);
    else yazilan++;
  }
  console.log(`\n${yazilan} eşleşme kaydedildi.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
