// Netsim ile EŞLEŞMEMİŞ işleri iki liste halinde yazar — elle eşleştirmek için.
//
//   1) Netsim tarafı : hakedişi olduğu halde hiçbir şantiyeye bağlanmamış işlem noktaları
//   2) Site tarafı   : netsim_nokta_no'su boş olan şantiyeler (sıra no ile)
//
// Eşleştirmeyi gördükten sonra bağlamak için:
//   npx tsx scripts/netsim-eslestir.ts --bagla <santiye_id> <nokta_no>
// (bu script her şantiyenin id'sini de yazar, kopyalayıp kullanabilirsiniz)
//
// SADECE OKUR — hiçbir şey yazmaz.
//
// Çalıştırma:
//   npx tsx scripts/netsim-eslesmeyen.ts            → ekrana yaz
//   npx tsx scripts/netsim-eslesmeyen.ts --dosya    → ayrıca .txt olarak kaydet
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

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const dosyayaYaz = process.argv.includes("--dosya");
  const cikti: string[] = [];
  const yaz = (s = "") => { console.log(s); cikti.push(s); };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da Supabase anahtarları yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("santiyeler")
    .select("id, sira_no, is_adi, netsim_nokta_no, durum")
    .order("sira_no");
  if (error) throw new Error(error.message);
  const santiyeler = (data ?? []) as {
    id: string; sira_no: number; is_adi: string; netsim_nokta_no: number | null; durum: string;
  }[];

  const bagliNoktalar = new Set(
    santiyeler.map((s) => s.netsim_nokta_no).filter((n): n is number => n != null),
  );

  // Netsim: hakedişi olan işler (kategori düğümleri hariç) + tutarları
  const db = await fbBagla();
  let netsimler: { no: number; ad: string; kesif: number; fark: number }[];
  try {
    const rows = await fbSorgu(db, `
      SELECT I.ISLEM_NOKTASI_NO AS NOKTA, I.ISLEM_NOKTASI_ADI AS AD,
             (SELECT SUM(CASE WHEN D.STOK_NO = 39 THEN D.HAM_TUTAR ELSE 0 END)
                FROM ALSADETA D JOIN ALSAASIL A ON A.ALISSATIS_NO = D.ALISSATIS_NO
               WHERE A.ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO AND A.ISLEM_KODU = 'HAKFAT') AS KESIF,
             (SELECT SUM(CASE WHEN D.STOK_NO = 356 THEN D.HAM_TUTAR ELSE 0 END)
                FROM ALSADETA D JOIN ALSAASIL A ON A.ALISSATIS_NO = D.ALISSATIS_NO
               WHERE A.ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO AND A.ISLEM_KODU = 'HAKFAT') AS FARK
      FROM ISLMNOKT I
      WHERE EXISTS (
        SELECT 1 FROM ALSAASIL A
        WHERE A.ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO AND A.ISLEM_KODU = 'HAKFAT'
      )
      AND NOT EXISTS (
        SELECT 1 FROM ISLMNOKT C WHERE C.ANA_ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO
      )
      ORDER BY I.ISLEM_NOKTASI_ADI
    `);
    netsimler = rows.map((r) => ({
      no: Number(r.NOKTA),
      ad: String(r.AD ?? "").trim(),
      kesif: Number(r.KESIF ?? 0),
      fark: Number(r.FARK ?? 0),
    }));
  } finally {
    db.detach();
  }

  const netsimBos = netsimler.filter((n) => !bagliNoktalar.has(n.no));
  const siteBos = santiyeler.filter((s) => s.netsim_nokta_no == null);

  yaz(`EŞLEŞMEYENLER — ${new Date().toLocaleString("tr-TR")}`);
  yaz(`Bağlı eşleşme: ${bagliNoktalar.size}`);
  yaz();
  yaz(`##### 1) NETSİM TARAFI — hakedişi var, şantiyeye bağlı değil (${netsimBos.length}) #####`);
  yaz(`${"NoktaNo".padEnd(8)} ${"Tamamlanan Keşif".padStart(18)} ${"Fiyat Farkı".padStart(16)}  İş Adı`);
  for (const n of netsimBos) {
    yaz(`${String(n.no).padEnd(8)} ${tl(n.kesif).padStart(18)} ${tl(n.fark).padStart(16)}  ${n.ad}`);
  }

  yaz();
  yaz(`##### 2) SİTE TARAFI — Netsim'e bağlanmamış şantiyeler (${siteBos.length}) #####`);
  yaz(`${"SıraNo".padEnd(7)} ${"Durum".padEnd(12)} İş Adı`);
  for (const s of siteBos) {
    yaz(`${String(s.sira_no).padEnd(7)} ${(s.durum ?? "").padEnd(12)} ${s.is_adi}`);
  }

  yaz();
  yaz("##### BAĞLAMA KOMUTLARI (sıra no → id eşlemesi) #####");
  yaz("Hangi sıra no'nun hangi NoktaNo'ya gittiğini söylemeniz yeter; komutu ben çalıştırırım.");
  for (const s of siteBos) {
    yaz(`sıra ${String(s.sira_no).padEnd(5)} → npx tsx scripts/netsim-eslestir.ts --bagla ${s.id} <NoktaNo>   # ${s.is_adi.slice(0, 60)}`);
  }

  // --json: eşleştirme sayfası (Artifact) için ham veri
  if (process.argv.includes("--json")) {
    const p = path.join(kok, "logs", "netsim-eslesmeyen.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      netsim: netsimBos.map((n) => ({ no: n.no, ad: n.ad, kesif: n.kesif, fark: n.fark })),
      site: siteBos.map((s) => ({ id: s.id, sira: s.sira_no, ad: s.is_adi, durum: s.durum })),
      bagliSayisi: bagliNoktalar.size,
    }, null, 1), "utf8");
    console.log(`JSON yazıldı: ${p}`);
  }

  if (dosyayaYaz) {
    const p = path.join(kok, "logs", "netsim-eslesmeyen.txt");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, cikti.join("\n"), "utf8");
    console.log(`\nDosyaya yazıldı: ${p}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
