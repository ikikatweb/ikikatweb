// Netsim / Ofisnet (Firebird) KEŞİF script'i — şemayı tanımak için, SADECE OKUR.
//
// Netsim'in Firebird veritabanına salt-okunur bağlanır ve şemayı çıkarır:
//   1) Tablo listesi (satır sayısı tahminiyle)
//   2) Aranan kelimeye uyan tablo/alan adları
//   3) İstenen tablonun kolonları + ilk birkaç satırı
//
// ÖNEMLİ: Bu script hiçbir INSERT/UPDATE/DELETE yapmaz. İşlem READ ONLY açılır,
// dolayısıyla yanlışlıkla yazma denemesi bile veritabanı tarafından reddedilir.
//
// Çalıştırma (proje klasöründe):
//   npx tsx scripts/netsim-kesif.ts                 → tablo listesi
//   npx tsx scripts/netsim-kesif.ts ara santiye     → adında "santiye" geçen tablo/alanlar
//   npx tsx scripts/netsim-kesif.ts tablo SANTIYE   → o tablonun kolonları + ilk 5 satırı
//   npx tsx scripts/netsim-kesif.ts tablo SANTIYE 20 → ilk 20 satır
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

// node-firebird tip tanımı getirmiyor — gerekli kadarını burada tarif ediyoruz.
type FbDb = {
  query: (sql: string, params: unknown[], cb: (err: Error | null, rows: Record<string, unknown>[]) => void) => void;
  detach: (cb?: () => void) => void;
};
type FbModule = {
  attach: (opts: Record<string, unknown>, cb: (err: Error | null, db: FbDb) => void) => void;
};

const ayarlar = {
  host: process.env.NETSIM_DB_HOST,
  port: parseInt(process.env.NETSIM_DB_PORT || "3050", 10),
  database: process.env.NETSIM_DB_PATH,
  user: process.env.NETSIM_DB_USER,
  password: process.env.NETSIM_DB_PASSWORD,
  lowercase_keys: false,
  role: null,
  pageSize: 4096,
};

function eksikAyar(): string | null {
  for (const [k, envAd] of [
    ["host", "NETSIM_DB_HOST"], ["database", "NETSIM_DB_PATH"],
    ["user", "NETSIM_DB_USER"], ["password", "NETSIM_DB_PASSWORD"],
  ] as const) {
    if (!ayarlar[k]) return envAd;
  }
  return null;
}

async function bagla(): Promise<FbDb> {
  const fb = (await import("node-firebird")) as unknown as FbModule;
  return new Promise((resolve, reject) => {
    fb.attach(ayarlar, (err, db) => (err ? reject(err) : resolve(db)));
  });
}

function sorgula(db: FbDb, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])));
  });
}

// Firebird CHAR alanları sağdan boşlukla dolu gelir; okunabilir olsun diye kırpıyoruz.
const kirp = (v: unknown): string => (typeof v === "string" ? v.trim() : String(v ?? ""));

async function tabloListesi(db: FbDb) {
  const rows = await sorgula(db, `
    SELECT TRIM(RDB$RELATION_NAME) AS TABLO,
           CASE WHEN RDB$VIEW_BLR IS NULL THEN 'tablo' ELSE 'view' END AS TUR
    FROM RDB$RELATIONS
    WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
    ORDER BY 1
  `);
  console.log(`\n=== ${rows.length} tablo/view ===\n`);
  for (const r of rows) console.log(`${kirp(r.TUR).padEnd(6)} ${kirp(r.TABLO)}`);
  console.log(`\nİpucu: npx tsx scripts/netsim-kesif.ts ara <kelime>`);
}

async function ara(db: FbDb, kelime: string) {
  const k = `%${kelime.toUpperCase()}%`;

  const tablolar = await sorgula(db, `
    SELECT TRIM(RDB$RELATION_NAME) AS TABLO
    FROM RDB$RELATIONS
    WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND UPPER(RDB$RELATION_NAME) LIKE ?
    ORDER BY 1
  `, [k]);
  console.log(`\n=== Adında "${kelime}" geçen TABLOLAR (${tablolar.length}) ===`);
  for (const r of tablolar) console.log("  " + kirp(r.TABLO));

  const alanlar = await sorgula(db, `
    SELECT TRIM(rf.RDB$RELATION_NAME) AS TABLO, TRIM(rf.RDB$FIELD_NAME) AS ALAN
    FROM RDB$RELATION_FIELDS rf
    JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
    WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 AND UPPER(rf.RDB$FIELD_NAME) LIKE ?
    ORDER BY 1, 2
  `, [k]);
  console.log(`\n=== Adında "${kelime}" geçen ALANLAR (${alanlar.length}) ===`);
  for (const r of alanlar) console.log(`  ${kirp(r.TABLO)}.${kirp(r.ALAN)}`);
}

// Firebird alan tipi kodu → okunabilir ad
const TIP: Record<number, string> = {
  7: "SMALLINT", 8: "INTEGER", 10: "FLOAT", 12: "DATE", 13: "TIME", 14: "CHAR",
  16: "BIGINT/NUMERIC", 27: "DOUBLE", 35: "TIMESTAMP", 37: "VARCHAR", 261: "BLOB",
};

async function tablo(db: FbDb, ad: string, limit: number) {
  const kolonlar = await sorgula(db, `
    SELECT TRIM(rf.RDB$FIELD_NAME) AS ALAN, f.RDB$FIELD_TYPE AS TIP,
           f.RDB$FIELD_LENGTH AS UZUNLUK, f.RDB$FIELD_SCALE AS OLCEK
    FROM RDB$RELATION_FIELDS rf
    JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
    WHERE UPPER(rf.RDB$RELATION_NAME) = ?
    ORDER BY rf.RDB$FIELD_POSITION
  `, [ad.toUpperCase()]);

  if (kolonlar.length === 0) {
    console.log(`"${ad}" adında tablo bulunamadı. Liste için: npx tsx scripts/netsim-kesif.ts`);
    return;
  }

  console.log(`\n=== ${ad.toUpperCase()} — ${kolonlar.length} kolon ===`);
  for (const c of kolonlar) {
    const tip = TIP[Number(c.TIP)] ?? `tip:${c.TIP}`;
    const olcek = Number(c.OLCEK ?? 0);
    const ek = olcek < 0 ? ` (ondalık ${-olcek})` : tip === "VARCHAR" || tip === "CHAR" ? `(${c.UZUNLUK})` : "";
    console.log(`  ${kirp(c.ALAN).padEnd(32)} ${tip}${ek}`);
  }

  const satirlar = await sorgula(db, `SELECT FIRST ${limit} * FROM "${ad.toUpperCase()}"`);
  console.log(`\n=== İlk ${satirlar.length} satır ===`);
  for (const [i, s] of satirlar.entries()) {
    console.log(`\n--- satır ${i + 1}`);
    for (const [k, v] of Object.entries(s)) {
      if (v === null || v === undefined) continue;
      const gosterim = typeof v === "string" ? v.trim() : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      if (gosterim === "") continue;
      console.log(`  ${k.padEnd(32)} ${gosterim.slice(0, 120)}`);
    }
  }
}

// Bağlanan kullanıcının hangi tablolarda ne yetkisi var (RDB$USER_PRIVILEGES).
// P=SELECT, I=INSERT, U=UPDATE, D=DELETE, R=REFERENCES, M=rol üyeliği
async function yetkiler(db: FbDb, kullanici: string) {
  const rows = await sorgula(db, `
    SELECT TRIM(RDB$RELATION_NAME) AS NESNE, TRIM(RDB$PRIVILEGE) AS YETKI
    FROM RDB$USER_PRIVILEGES
    WHERE TRIM(RDB$USER) = ?
    ORDER BY 1, 2
  `, [kullanici.toUpperCase()]);
  console.log(`\n=== "${kullanici.toUpperCase()}" kullanıcısının yetkileri (${rows.length}) ===`);
  if (rows.length === 0) {
    console.log("  (hiç yetki tanımlı değil — GRANT SELECT gerekiyor)");
    return;
  }
  const harita = new Map<string, string[]>();
  for (const r of rows) {
    const n = kirp(r.NESNE);
    if (!harita.has(n)) harita.set(n, []);
    harita.get(n)!.push(kirp(r.YETKI));
  }
  for (const [nesne, yetki] of harita) console.log(`  ${nesne.padEnd(32)} ${yetki.join(",")}`);
}

// Serbest sorgu — GÜVENLİK: sadece SELECT çalışır. Bağlanan kullanıcı zaten
// salt-okunur ama yanlışlıkla yazan bir sorgu yapıştırılmasın diye burada da engelli.
async function serbestSorgu(db: FbDb, sql: string) {
  if (!/^\s*select\s/i.test(sql)) {
    console.error("Sadece SELECT sorgusu çalıştırılabilir.");
    return;
  }
  const rows = await sorgula(db, sql);
  console.log(`\n=== ${rows.length} satır ===`);
  for (const s of rows) {
    const parcalar: string[] = [];
    for (const [k, v] of Object.entries(s)) {
      const g = typeof v === "string" ? v.trim()
        : v instanceof Date ? v.toISOString().slice(0, 10)
        : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2))
        : String(v ?? "");
      parcalar.push(`${k}=${g}`);
    }
    console.log("  " + parcalar.join(" | "));
  }
}

async function main() {
  const eksik = eksikAyar();
  if (eksik) {
    console.error(`${eksik} tanımlı değil. .env.local dosyasına Netsim bağlantı bilgilerini ekleyin.`);
    process.exit(1);
  }

  let db: FbDb;
  try {
    db = await bagla();
  } catch (e) {
    console.error(`Bağlanamadı: ${e instanceof Error ? e.message : String(e)}`);
    console.error(`  Sunucu : ${ayarlar.host}:${ayarlar.port}`);
    console.error(`  VT     : ${ayarlar.database}`);
    console.error(`  Kullanıcı: ${ayarlar.user}`);
    process.exit(1);
  }
  console.log(`Bağlandı → ${ayarlar.host}:${ayarlar.port} ${ayarlar.database}`);

  try {
    const komut = (process.argv[2] || "liste").toLowerCase();
    if (komut === "ara") {
      const kelime = process.argv[3];
      if (!kelime) { console.error("Kullanım: netsim-kesif.ts ara <kelime>"); return; }
      await ara(db, kelime);
    } else if (komut === "sql") {
      const sql = process.argv.slice(3).join(" ");
      if (!sql) { console.error("Kullanim: netsim-kesif.ts sql \"SELECT ...\""); return; }
      await serbestSorgu(db, sql);
    } else if (komut === "yetki") {
      await yetkiler(db, process.argv[3] || String(ayarlar.user));
    } else if (komut === "tablo") {
      const ad = process.argv[3];
      if (!ad) { console.error("Kullanım: netsim-kesif.ts tablo <TABLO_ADI> [satır]"); return; }
      await tablo(db, ad, parseInt(process.argv[4] || "5", 10));
    } else {
      await tabloListesi(db);
    }
  } finally {
    db.detach();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
