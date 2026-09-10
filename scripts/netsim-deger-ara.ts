// Netsim (Firebird) DEĞER ARAMA — bilinen bir rakamın hangi tablo/alanda durduğunu bulur.
// Ekranda gördüğünüz bir tutarın veritabanı karşılığını tespit etmek için. SADECE OKUR.
//
// Okuma yetkimiz olan tüm tablolardaki sayısal alanlarda verilen değeri arar.
// Önce şantiye/işlem noktası ile ilişkili tablolara bakar (hızlı yol), sonra kalanlara.
//
// Çalıştırma:
//   npx tsx scripts/netsim-deger-ara.ts 9054459.97
//   npx tsx scripts/netsim-deger-ara.ts 9054459.97 0.5     → tolerans ±0.5
//   npx tsx scripts/netsim-deger-ara.ts 9054459.97 0.01 hepsi  → ilişkisiz tabloları da tara
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
  query: (sql: string, params: unknown[], cb: (err: Error | null, rows: Record<string, unknown>[]) => void) => void;
  detach: (cb?: () => void) => void;
};
type FbModule = { attach: (o: Record<string, unknown>, cb: (e: Error | null, db: FbDb) => void) => void };

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

async function bagla(): Promise<FbDb> {
  const fb = (await import("node-firebird")) as unknown as FbModule;
  return new Promise((res, rej) => fb.attach(ayarlar, (e, db) => (e ? rej(e) : res(db))));
}
function sorgula(db: FbDb, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return new Promise((res, rej) => db.query(sql, params, (e, rows) => (e ? rej(e) : res(rows ?? []))));
}
const kirp = (v: unknown): string => (typeof v === "string" ? v.trim() : String(v ?? ""));

async function main() {
  const hedef = parseFloat(process.argv[2] || "");
  if (!Number.isFinite(hedef)) {
    console.error("Kullanım: npx tsx scripts/netsim-deger-ara.ts <rakam> [tolerans] [hepsi]");
    process.exit(1);
  }
  const tolerans = parseFloat(process.argv[3] || "0.01");
  const hepsi = (process.argv[4] || "").toLowerCase() === "hepsi";
  const alt = hedef - tolerans;
  const ust = hedef + tolerans;

  const db = await bagla();
  console.log(`Aranan: ${hedef} (±${tolerans})\n`);

  try {
    // Okuma yetkimiz olan tablolar
    const yetkili = new Set<string>(
      (await sorgula(db, `
        SELECT DISTINCT TRIM(RDB$RELATION_NAME) AS T FROM RDB$USER_PRIVILEGES
        WHERE TRIM(RDB$USER) = ? AND TRIM(RDB$PRIVILEGE) = 'S'
      `, [String(ayarlar.user).toUpperCase()])).map((r) => kirp(r.T)),
    );

    // Sayısal alanlar (DOUBLE=27, FLOAT=10, NUMERIC/BIGINT=16, INTEGER=8)
    const alanRows = await sorgula(db, `
      SELECT TRIM(rf.RDB$RELATION_NAME) AS TABLO, TRIM(rf.RDB$FIELD_NAME) AS ALAN
      FROM RDB$RELATION_FIELDS rf
      JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
      WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0
        AND r.RDB$VIEW_BLR IS NULL
        AND f.RDB$FIELD_TYPE IN (27, 10, 16)
      ORDER BY 1, 2
    `);

    const tabloAlan = new Map<string, string[]>();
    for (const r of alanRows) {
      const t = kirp(r.TABLO);
      if (!yetkili.has(t)) continue;
      if (!tabloAlan.has(t)) tabloAlan.set(t, []);
      tabloAlan.get(t)!.push(kirp(r.ALAN));
    }

    // Şantiye/işlem noktası ile ilişkili tablolar önce taransın
    const iliskiliRows = await sorgula(db, `
      SELECT DISTINCT TRIM(RDB$RELATION_NAME) AS T FROM RDB$RELATION_FIELDS
      WHERE TRIM(RDB$FIELD_NAME) IN ('ISLEM_NOKTASI_NO', 'SANTIYE_NO')
    `);
    const iliskili = new Set(iliskiliRows.map((r) => kirp(r.T)));

    const tablolar = [...tabloAlan.keys()].sort((a, b) => {
      const ai = iliskili.has(a) ? 0 : 1, bi = iliskili.has(b) ? 0 : 1;
      return ai !== bi ? ai - bi : a.localeCompare(b);
    }).filter((t) => hepsi || iliskili.has(t));

    console.log(`${tablolar.length} tablo taranacak${hepsi ? "" : " (sadece şantiye/işlem noktası ilişkili — tümü için: ... hepsi)"}\n`);

    let bulundu = 0;
    for (const tablo of tablolar) {
      const alanlar = tabloAlan.get(tablo)!;
      const kosul = alanlar.map((a) => `"${a}" BETWEEN ${alt} AND ${ust}`).join(" OR ");
      try {
        const rows = await sorgula(db, `SELECT FIRST 3 * FROM "${tablo}" WHERE ${kosul}`);
        if (rows.length === 0) continue;
        bulundu++;
        // Hangi alan tuttu?
        for (const s of rows) {
          const tutanlar = Object.entries(s)
            .filter(([, v]) => typeof v === "number" && v >= alt && v <= ust)
            .map(([k]) => k);
          // Satırı tanımlayan alanlar (ad/no) da yazdırılsın
          const kimlik = Object.entries(s)
            .filter(([k, v]) => /_NO$|_ADI$|_KODU$/.test(k) && v !== null && kirp(v) !== "")
            .slice(0, 4)
            .map(([k, v]) => `${k}=${kirp(v)}`);
          console.log(`>>> ${tablo}.${tutanlar.join(",")}`);
          if (kimlik.length) console.log(`    ${kimlik.join(" | ")}`);
        }
      } catch {
        // yetkisiz / okunamayan tablo — sessizce atla
      }
    }
    console.log(`\n${bulundu} tabloda eşleşme bulundu.`);
  } finally {
    db.detach();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
