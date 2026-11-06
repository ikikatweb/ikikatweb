// SQL DOSYASINI SUPABASE'DE ÇALIŞTIR — Management API ile.
//
// NEDEN AYRI BİR YOL: service role anahtarı PostgREST'e açılır; tablo okur/yazar ama
// `alter table`, `create policy` gibi ŞEMA komutlarını çalıştıramaz. Bu yüzden sql/ altındaki
// dosyalar bugüne kadar elle, Supabase SQL Editor'e yapıştırılarak çalıştırıldı.
// Management API'nin sorgu uçucu (POST /v1/projects/{ref}/database/query) ise istediğin SQL'i
// çalıştırır — SQL Editor'ün kendi kullandığı uç. Supabase bu ucu "deneysel/beta" diye
// işaretliyor; davranışı değişebilir, o yüzden dosyalar yine sql/ altında ve git'te duruyor.
//
// GEREKEN: .env.local içine kişisel erişim jetonu —
//   SUPABASE_ACCESS_TOKEN=sbp_...
// Jeton: supabase.com/dashboard/account/tokens. Mümkünse "fine-grained" seçip YALNIZ bu
// projeye ve database_write iznine kıs; hesabın tamamına açılan jetondan iyidir.
//
// Kullanım (proje kökünde):
//   node scripts/sql-calistir.mjs sql/dosya.sql              → çalıştır
//   node scripts/sql-calistir.mjs sql/dosya.sql --goster     → çalıştırma, yalnız ne gideceğini yaz
//   node scripts/sql-calistir.mjs sql/dosya.sql --salt-okur  → yazmaya izin verme (read_only)
//   node scripts/sql-calistir.mjs sql/dosya.sql --yikici     → drop/truncate içeren dosyayı onayla
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const arg = process.argv.slice(2);
const GOSTER = arg.includes("--goster");
const SALT_OKUR = arg.includes("--salt-okur");
const YIKICI_ONAY = arg.includes("--yikici");
const dosyaArg = arg.find((a) => !a.startsWith("--"));

function dur(mesaj) { console.error(mesaj); process.exit(1); }

if (!dosyaArg) dur("Kullanım: node scripts/sql-calistir.mjs sql/dosya.sql [--goster] [--salt-okur] [--yikici]");

// SADECE sql/ ALTINDAN. Rastgele bir yoldan dosya çalıştırmak, yanlış dosyayı veritabanına
// uygulamanın en kolay yolu; ayrıca çalıştırdığımız her şeyin git'te izi kalsın.
const tam = path.resolve(kok, dosyaArg);
const sqlKlasor = path.join(kok, "sql") + path.sep;
if (!tam.startsWith(sqlKlasor)) dur(`Yalnız sql/ altındaki dosyalar çalıştırılır: ${dosyaArg}`);
if (!fs.existsSync(tam)) dur(`Dosya yok: ${tam}`);

const sql = fs.readFileSync(tam, "utf8");
if (!sql.trim()) dur("Dosya boş.");

// YIKICI KOMUT FRENİ. Yorum satırları elenir ki "-- drop table yapma" diye bir not freni
// gereksiz yere çekmesin.
const sade = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").toLowerCase();
const YIKICI = [
  [/\bdrop\s+(table|schema|database|column|type|function)\b/, "drop"],
  [/\btruncate\b/, "truncate"],
  [/\bdelete\s+from\b(?![\s\S]*\bwhere\b)/, "where'siz delete"],
  [/\balter\s+table\s+\S+\s+drop\b/, "sütun silme"],
];
const bulunan = YIKICI.filter(([re]) => re.test(sade)).map(([, ad]) => ad);
if (bulunan.length && !YIKICI_ONAY) {
  dur(`Bu dosya VERİ SİLEBİLİR (${bulunan.join(", ")}). Emin isen --yikici ekle.\n`
    + `Önce ne yaptığını gör: node scripts/sql-calistir.mjs ${dosyaArg} --goster`);
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

// Proje kodu zaten elimizde: https://<ref>.supabase.co
const ref = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) dur("NEXT_PUBLIC_SUPABASE_URL okunamadı — proje kodu çıkarılamıyor.");

console.log(`Dosya : ${path.relative(kok, tam)}  (${sql.split(/\r?\n/).length} satır)`);
console.log(`Proje : ${ref}${SALT_OKUR ? "  [salt okunur]" : ""}${bulunan.length ? `  [YIKICI: ${bulunan.join(", ")}]` : ""}`);
console.log("─".repeat(60));
console.log(sql.trim());
console.log("─".repeat(60));

if (GOSTER) { console.log("--goster verildi: hiçbir şey çalıştırılmadı."); process.exit(0); }

const jeton = env.SUPABASE_ACCESS_TOKEN;
if (!jeton) {
  dur("SUPABASE_ACCESS_TOKEN .env.local'de yok.\n"
    + "supabase.com/dashboard/account/tokens → yeni jeton (tercihen bu projeye kısık, database_write)\n"
    + "sonra .env.local'e:  SUPABASE_ACCESS_TOKEN=sbp_...");
}

const yanit = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: SALT_OKUR }),
});

const metin = await yanit.text();
if (!yanit.ok) {
  // Hata SESSİZ GEÇİLMEZ: SQL'in çalıştığı sanılıp aslında hiç uygulanmamış olması en kötüsü.
  dur(`ÇALIŞMADI (HTTP ${yanit.status})\n${metin.slice(0, 1500)}`);
}

let sonuc;
try { sonuc = JSON.parse(metin); } catch { sonuc = metin; }
console.log("TAMAM.");
if (Array.isArray(sonuc) && sonuc.length) console.log(JSON.stringify(sonuc.slice(0, 50), null, 1));
else if (Array.isArray(sonuc)) console.log("(dönen satır yok — şema komutları satır döndürmez)");
else console.log(sonuc);
