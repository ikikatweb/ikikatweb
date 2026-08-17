// YEREL TAM YEDEK — bu makinede Görev Zamanlayıcı ile haftalık çalışır.
//
// Neden yerel: web'deki /api/yedek Vercel'in süre/boyut limitine takılıyor (tek başına
// arac_arvento_guzergah ~57 MB ve ~70 sn). Bu script aynı JSON formatını üretir ama
// limit yok — tüm tabloları ve tüm Storage dosyalarını eksiksiz indirir.
//
// Çalıştırma (proje klasöründe):
//   npx tsx scripts/yedek-al.ts               → veritabanı + dosyalar
//   npx tsx scripts/yedek-al.ts --sadece-db   → sadece veritabanı JSON'u
//   npx tsx scripts/yedek-al.ts --sadece-dosya→ sadece Storage dosyaları
//
// Çıktı (varsayılan C:\ikikatweb-yedek, YEDEK_KLASOR ile değiştirilebilir):
//   db\ikikatweb-yedek-YYYY-MM-DD_HH-mm.json   → haftalık anlık görüntü (son 8 tanesi saklanır)
//   dosyalar\<bucket>\<yol>                    → Storage AYNASI; sadece yeni/değişen dosyalar iner
//   yedek.log                                  → her çalışmanın özeti
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  YEDEK_TABLOLARI, YEDEK_DISI, PARCA_BOYUTU, OZEL_PARCA,
  BUCKET_DISI, YEDEK_BUCKET_LISTESI,
} from "@/lib/yedek/kapsam";

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

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANAHTAR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANAHTAR) throw new Error(".env.local'da NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok.");
const BASLIK = { apikey: ANAHTAR, Authorization: `Bearer ${ANAHTAR}` };

const HEDEF = process.env.YEDEK_KLASOR || "C:\\ikikatweb-yedek";
const SAKLANACAK_YEDEK = 8;               // kaç haftalık JSON saklansın
const sadeceDb = process.argv.includes("--sadece-db");
const sadeceDosya = process.argv.includes("--sadece-dosya");

const zaman = () => new Date().toLocaleString("tr-TR");
const satirlar: string[] = [];
function log(mesaj: string) {
  const s = `${zaman()} | ${mesaj}`;
  console.log(s);
  satirlar.push(s);
}
const mb = (bayt: number) => `${(bayt / 1024 / 1024).toFixed(1)} MB`;

// ── 1) Veritabanı → tek JSON (akış halinde yazılır, bellekte birikmez) ──────────
async function veritabaniYedegi(): Promise<{ dosya: string; boyut: number; hata: number }> {
  const klasor = path.join(HEDEF, "db");
  fs.mkdirSync(klasor, { recursive: true });
  const t = new Date();
  const damga = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}_${String(t.getHours()).padStart(2, "0")}-${String(t.getMinutes()).padStart(2, "0")}`;
  const cikti = path.join(klasor, `ikikatweb-yedek-${damga}.json`);
  const akis = fs.createWriteStream(cikti, { encoding: "utf8" });
  const yaz = (metin: string) =>
    new Promise<void>((coz, hata) => { akis.write(metin, (e) => (e ? hata(e) : coz())); });

  const hatalar: { tablo: string; hata: string }[] = [];
  const uyarilar: string[] = [];
  const satirSayilari: Record<string, number> = {};

  // Kapsam denetimi — listede olmayan yeni tablo var mı?
  try {
    const spec = await fetch(`${URL_}/rest/v1/`, { headers: BASLIK }).then((r) => (r.ok ? r.json() : null));
    const canli: string[] = Object.keys(spec?.definitions ?? {});
    if (canli.length) {
      const listelenmemis = canli.filter((x) => !YEDEK_TABLOLARI.includes(x) && !(x in YEDEK_DISI));
      if (listelenmemis.length) uyarilar.push(`Yedek listesinde OLMAYAN tablolar: ${listelenmemis.join(", ")}`);
      const bulunmayan = YEDEK_TABLOLARI.filter((x) => !canli.includes(x));
      if (bulunmayan.length) uyarilar.push(`Listede olup veritabanında BULUNMAYAN tablolar: ${bulunmayan.join(", ")}`);
    }
  } catch { uyarilar.push("Tablo listesi denetimi yapılamadı."); }

  await yaz('{"veriler":{');
  let ilk = true;
  for (const tablo of YEDEK_TABLOLARI) {
    await yaz(`${ilk ? "" : ","}${JSON.stringify(tablo)}:[`);
    ilk = false;
    let sayi = 0;
    let offset = 0;
    let parcaBoyutu = OZEL_PARCA[tablo] ?? PARCA_BOYUTU;
    try {
      while (true) {
        const r = await fetch(`${URL_}/rest/v1/${tablo}?select=*&offset=${offset}&limit=${parcaBoyutu}`, { headers: BASLIK });
        if (!r.ok) {
          // Ağır tablolarda 500 gelebiliyor → parçayı küçültüp yeniden dene.
          if (r.status >= 500 && parcaBoyutu > 10) { parcaBoyutu = Math.max(10, Math.floor(parcaBoyutu / 4)); continue; }
          throw new Error(`HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
        }
        const parca = (await r.json()) as unknown[];
        for (const kayit of parca) { await yaz(`${sayi ? "," : ""}${JSON.stringify(kayit)}`); sayi++; }
        if (parca.length < parcaBoyutu) break;
        offset += parcaBoyutu;
        if (offset > 1_000_000) break;
      }
    } catch (e) {
      hatalar.push({ tablo, hata: e instanceof Error ? e.message : String(e) });
      log(`  HATA ${tablo}: ${e instanceof Error ? e.message : String(e)}`);
    }
    satirSayilari[tablo] = sayi;
    await yaz("]");
  }

  const meta = {
    proje: "ikikatweb",
    yedek_tarihi: t.toISOString(),
    kaynak: "yerel (scripts/yedek-al.ts)",
    toplam_tablo: YEDEK_TABLOLARI.length,
    basarili_tablo: YEDEK_TABLOLARI.length - hatalar.length,
    toplam_satir: Object.values(satirSayilari).reduce((s, n) => s + n, 0),
    yedek_disi: YEDEK_DISI,
    hatalar,
    uyarilar,
    tablo_satir_sayilari: satirSayilari,
  };
  await yaz(`},"meta":${JSON.stringify(meta)}}`);
  await new Promise<void>((coz) => akis.end(coz));

  const boyut = fs.statSync(cikti).size;
  log(`Veritabanı: ${meta.toplam_satir.toLocaleString("tr-TR")} satır / ${YEDEK_TABLOLARI.length} tablo → ${path.basename(cikti)} (${mb(boyut)})`);
  for (const u of uyarilar) log(`  UYARI: ${u}`);

  // Eski yedekleri temizle (en yeni SAKLANACAK_YEDEK tanesi kalsın)
  const eskiler = fs.readdirSync(klasor).filter((d) => d.endsWith(".json")).sort().reverse().slice(SAKLANACAK_YEDEK);
  for (const d of eskiler) { fs.unlinkSync(path.join(klasor, d)); log(`  eski yedek silindi: ${d}`); }

  return { dosya: cikti, boyut, hata: hatalar.length };
}

// ── 2) Storage → yerel ayna (sadece yeni/değişen dosyalar iner) ─────────────────
type Nesne = { name: string; id: string | null; metadata: { size?: number } | null };

async function bucketListesi(): Promise<string[]> {
  try {
    const r = await fetch(`${URL_}/storage/v1/bucket`, { headers: BASLIK });
    if (r.ok) {
      const b = (await r.json()) as { name: string }[];
      if (b?.length) return b.map((x) => x.name).filter((ad) => !BUCKET_DISI.has(ad));
    }
  } catch { /* aşağıdaki sabit listeye düş */ }
  return YEDEK_BUCKET_LISTESI.filter((b) => !BUCKET_DISI.has(b));
}

async function klasorListele(bucket: string, onEk = ""): Promise<{ yol: string; boyut: number }[]> {
  const sonuc: { yol: string; boyut: number }[] = [];
  const r = await fetch(`${URL_}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...BASLIK, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: onEk, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (!r.ok) return sonuc;
  for (const o of (await r.json()) as Nesne[]) {
    const tamYol = onEk ? `${onEk}/${o.name}` : o.name;
    if (o.id === null || o.metadata == null) sonuc.push(...(await klasorListele(bucket, tamYol)));
    else sonuc.push({ yol: tamYol, boyut: o.metadata?.size ?? 0 });
  }
  return sonuc;
}

async function dosyaYedegi(): Promise<{ yeni: number; atlanan: number; bayt: number; hata: number }> {
  const kokKlasor = path.join(HEDEF, "dosyalar");
  let yeni = 0, atlanan = 0, bayt = 0, hata = 0;
  for (const bucket of await bucketListesi()) {
    const dosyalar = await klasorListele(bucket);
    let bYeni = 0;
    for (const d of dosyalar) {
      const hedefYol = path.join(kokKlasor, bucket, ...d.yol.split("/"));
      // Aynı boyutta dosya zaten varsa tekrar indirme (ayna mantığı — haftalık çalışma hızlı olsun)
      if (fs.existsSync(hedefYol) && fs.statSync(hedefYol).size === d.boyut && d.boyut > 0) { atlanan++; continue; }
      try {
        const r = await fetch(`${URL_}/storage/v1/object/${bucket}/${d.yol.split("/").map(encodeURIComponent).join("/")}`, { headers: BASLIK });
        if (!r.ok) { hata++; log(`  HATA indirilemedi ${bucket}/${d.yol}: HTTP ${r.status}`); continue; }
        fs.mkdirSync(path.dirname(hedefYol), { recursive: true });
        fs.writeFileSync(hedefYol, Buffer.from(await r.arrayBuffer()));
        yeni++; bYeni++; bayt += d.boyut;
      } catch (e) {
        hata++; log(`  HATA ${bucket}/${d.yol}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    log(`Storage ${bucket}: ${dosyalar.length} dosya (${bYeni} yeni indirildi)`);
  }
  return { yeni, atlanan, bayt, hata };
}

// ── 3) Çalıştır ────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(HEDEF, { recursive: true });
  log(`=== YEDEK BAŞLADI → ${HEDEF} ===`);
  let hataSayisi = 0;

  if (!sadeceDosya) {
    const db = await veritabaniYedegi();
    hataSayisi += db.hata;
  }
  if (!sadeceDb) {
    const d = await dosyaYedegi();
    hataSayisi += d.hata;
    log(`Storage toplam: ${d.yeni} yeni dosya (${mb(d.bayt)}), ${d.atlanan} değişmemiş atlandı, ${d.hata} hata`);
  }

  // Dashboard'daki Cumartesi "yedek al" hatırlatması düşsün — web butonuyla aynı damga.
  try {
    const bugun = new Date();
    const g = `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, "0")}-${String(bugun.getDate()).padStart(2, "0")}`;
    await fetch(`${URL_}/rest/v1/yedek_kaydi`, {
      method: "POST",
      headers: { ...BASLIK, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ tarih: g, alan_id: null, alan_ad: "Otomatik yedek (bu bilgisayar)", alindi_at: new Date().toISOString() }),
    });
  } catch { /* damga yazılamazsa yedek yine geçerli */ }

  log(`=== YEDEK BİTTİ — ${hataSayisi} hata ===\n`);
  fs.appendFileSync(path.join(HEDEF, "yedek.log"), satirlar.join("\r\n") + "\r\n", "utf8");
  process.exit(hataSayisi ? 1 : 0);
}

main().catch((e) => {
  log(`ÖLÜMCÜL HATA: ${e instanceof Error ? e.message : String(e)}`);
  try { fs.mkdirSync(HEDEF, { recursive: true }); fs.appendFileSync(path.join(HEDEF, "yedek.log"), satirlar.join("\r\n") + "\r\n", "utf8"); } catch { /* yoksay */ }
  process.exit(1);
});
