// Netsim (Firebird) TOPLAM ARAMA — bir rakam tek satırda değil, TOPLANARAK oluşuyorsa
// hangi tablo/alanın toplamı olduğunu bulur. SADECE OKUR.
//
// Şantiye/işlem noktası anahtarı ile filtreleyip her sayısal alanın SUM'ını alır,
// aranan değere eşit olanları yazar.
//
// Çalıştırma:
//   npx tsx scripts/netsim-toplam-ara.ts 9054459.97 ISLEM_NOKTASI_NO=154
//   npx tsx scripts/netsim-toplam-ara.ts 9054459.97 SANTIYE_NO=103 1
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
  query: (sql: string, p: unknown[], cb: (e: Error | null, r: Record<string, unknown>[]) => void) => void;
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
function sorgula(db: FbDb, sql: string, p: unknown[] = []): Promise<Record<string, unknown>[]> {
  return new Promise((res, rej) => db.query(sql, p, (e, r) => (e ? rej(e) : res(r ?? []))));
}
const kirp = (v: unknown): string => (typeof v === "string" ? v.trim() : String(v ?? ""));

async function main() {
  const hedef = parseFloat(process.argv[2] || "");
  const filtre = process.argv[3] || "";           // örn. ISLEM_NOKTASI_NO=154
  const tolerans = parseFloat(process.argv[4] || "0.05");
  if (!Number.isFinite(hedef) || !filtre.includes("=")) {
    console.error("Kullanım: npx tsx scripts/netsim-toplam-ara.ts <rakam> <ALAN=deger> [tolerans]");
    process.exit(1);
  }
  const [filtreAlan, filtreDeger] = filtre.split("=");

  const db = await bagla();
  console.log(`Aranan toplam: ${hedef} (±${tolerans})   filtre: ${filtreAlan}=${filtreDeger}\n`);
  try {
    const yetkili = new Set<string>(
      (await sorgula(db, `
        SELECT DISTINCT TRIM(RDB$RELATION_NAME) AS T FROM RDB$USER_PRIVILEGES
        WHERE TRIM(RDB$USER) = ? AND TRIM(RDB$PRIVILEGE) = 'S'
      `, [String(ayarlar.user).toUpperCase()])).map((r) => kirp(r.T)),
    );

    // Filtre alanını içeren tablolar
    const tablolar = (await sorgula(db, `
      SELECT DISTINCT TRIM(rf.RDB$RELATION_NAME) AS T
      FROM RDB$RELATION_FIELDS rf
      JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
      WHERE COALESCE(r.RDB$SYSTEM_FLAG,0) = 0 AND r.RDB$VIEW_BLR IS NULL
        AND TRIM(rf.RDB$FIELD_NAME) = ?
      ORDER BY 1
    `, [filtreAlan.toUpperCase()])).map((r) => kirp(r.T)).filter((t) => yetkili.has(t));

    const alanRows = await sorgula(db, `
      SELECT TRIM(rf.RDB$RELATION_NAME) AS TABLO, TRIM(rf.RDB$FIELD_NAME) AS ALAN
      FROM RDB$RELATION_FIELDS rf
      JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      WHERE f.RDB$FIELD_TYPE IN (27, 10, 16)
      ORDER BY 1, 2
    `);
    const tabloAlan = new Map<string, string[]>();
    for (const r of alanRows) {
      const t = kirp(r.TABLO);
      if (!tabloAlan.has(t)) tabloAlan.set(t, []);
      tabloAlan.get(t)!.push(kirp(r.ALAN));
    }

    console.log(`${tablolar.length} tablo taranacak\n`);
    let bulundu = 0;
    for (const tablo of tablolar) {
      const alanlar = tabloAlan.get(tablo);
      if (!alanlar?.length) continue;
      const secim = alanlar.map((a) => `SUM("${a}") AS "${a}"`).join(", ");
      try {
        const rows = await sorgula(db,
          `SELECT COUNT(*) AS SATIR, ${secim} FROM "${tablo}" WHERE "${filtreAlan.toUpperCase()}" = ?`,
          [Number(filtreDeger)]);
        const r = rows[0];
        if (!r || Number(r.SATIR) === 0) continue;
        for (const [k, v] of Object.entries(r)) {
          if (k === "SATIR" || typeof v !== "number") continue;
          if (Math.abs(v - hedef) <= tolerans) {
            console.log(`>>> ${tablo}.${k} = ${v.toFixed(2)}   (${r.SATIR} satırın toplamı)`);
            bulundu++;
          }
        }
      } catch { /* okunamayan tablo — atla */ }
    }
    console.log(`\n${bulundu} eşleşme.`);
  } finally {
    db.detach();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
