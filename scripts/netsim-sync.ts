// NETSIM SENKRONU — Netsim/Ofisnet (Firebird) → Supabase. Tek yönlü, Netsim'e HİÇBİR ŞEY YAZMAZ.
//
// Netsim'de her iş bir "işlem noktası"dır ve tutarlar hakediş faturası satırlarından toplanır:
//
//   Tamamlanan Keşif      = SUM(ALSADETA.HAM_TUTAR)  STOK_NO = 39   ("Hakediş Bedeli")
//   Alınan Fiyat Farkı    = SUM(ALSADETA.HAM_TUTAR)  STOK_NO = 356  ("Hakediş Fiyat Farkı Bedeli")
//   ... her ikisi de SADECE  ALSAASIL.ISLEM_KODU = 'HAKFAT'  olan belgelerden.
//
// ISLEM_KODU filtresi KRİTİK: aynı stok kartlarıyla girilmiş alış faturaları (ALIFAT) da var,
// onlar hakediş değil. Samsun Vezirköprü'de bu filtre olmadan rakam 971.821,30 TL şişiyordu.
// Fiyat farkı tarafı SANTIYELER.FIYAT_FARKI ile 7 şantiyede birebir doğrulandı.
//
// Yazdığı yerler:
//   santiyeler.sozlesme_fiyatlariyla_gerceklesen  ← Tamamlanan Keşif (iş deneyim belgesi tutarı)
//   iscilik_takibi.fiyat_farki                    ← Alınan Fiyat Farkı
//
// Geçici kabulü yapılmış işlerde "gerçekleşen" tutar formda KİLİTLİ (belge kesinleşmiş sayılır),
// bu yüzden senkron da onlara DOKUNMAZ — sadece raporlar.
//
// Çalıştırma:
//   npx tsx scripts/netsim-sync.ts           → senkronla
//   npx tsx scripts/netsim-sync.ts --kuru    → hiçbir şey yazma, ne değişecekti göster
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

const KURU = process.argv.includes("--kuru");

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

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Kuruş farkı yüzünden boşuna UPDATE atmayalım
// null'u 0 sayar: hic girilmemis alan ile 0 arasinda fark yok, bosuna UPDATE atma.
const ayni = (a: number | null, b: number) => Math.abs((a ?? 0) - b) < 0.005;

type SantiyeRow = {
  id: string;
  is_adi: string;
  netsim_nokta_no: number | null;
  sozlesme_fiyatlariyla_gerceklesen: number | null;
  gecici_kabul_tarihi: string | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("santiyeler")
    .select("id, is_adi, netsim_nokta_no, sozlesme_fiyatlariyla_gerceklesen, gecici_kabul_tarihi")
    .not("netsim_nokta_no", "is", null);
  if (error) throw new Error(error.message);
  const santiyeler = (data ?? []) as SantiyeRow[];

  if (santiyeler.length === 0) {
    console.log("Netsim'e bağlanmış şantiye yok. Önce: npx tsx scripts/netsim-eslestir.ts");
    return;
  }

  // İşçilik takibi satırları (fiyat farkı buraya yazılıyor)
  const { data: itData, error: itErr } = await sb
    .from("iscilik_takibi")
    .select("id, santiye_id, fiyat_farki")
    .eq("silindi", false);
  if (itErr) throw new Error(itErr.message);
  const iscilikMap = new Map<string, { id: string; fiyat_farki: number | null }>();
  for (const r of (itData ?? []) as { id: string; santiye_id: string; fiyat_farki: number | null }[]) {
    iscilikMap.set(r.santiye_id, { id: r.id, fiyat_farki: r.fiyat_farki });
  }

  // Netsim'den tüm hakediş toplamlarını TEK sorguda al
  const noktalar = santiyeler.map((s) => s.netsim_nokta_no!).filter((n) => Number.isFinite(n));
  const db = await fbBagla();
  const toplam = new Map<number, { kesif: number; fark: number }>();
  try {
    const rows = await fbSorgu(db, `
      SELECT A.ISLEM_NOKTASI_NO AS NOKTA,
             SUM(CASE WHEN D.STOK_NO = 39  THEN D.HAM_TUTAR ELSE 0 END) AS TAMAMLANAN_KESIF,
             SUM(CASE WHEN D.STOK_NO = 356 THEN D.HAM_TUTAR ELSE 0 END) AS FIYAT_FARKI
      FROM ALSADETA D
      JOIN ALSAASIL A ON A.ALISSATIS_NO = D.ALISSATIS_NO
      WHERE D.STOK_NO IN (39, 356)
        AND A.ISLEM_KODU = 'HAKFAT'
        AND A.ISLEM_NOKTASI_NO IN (${noktalar.join(",")})
      GROUP BY A.ISLEM_NOKTASI_NO
    `);
    for (const r of rows) {
      toplam.set(Number(r.NOKTA), {
        kesif: Number(r.TAMAMLANAN_KESIF ?? 0),
        fark: Number(r.FIYAT_FARKI ?? 0),
      });
    }
  } finally {
    db.detach();
  }

  console.log(`${santiyeler.length} bağlı şantiye, Netsim'de ${toplam.size} tanesinin hakedişi var.${KURU ? "  [KURU ÇALIŞMA — yazma yok]" : ""}\n`);

  const simdi = new Date().toISOString();
  let kesifYazilan = 0, farkYazilan = 0, kilitli = 0, degismeyen = 0;

  for (const s of santiyeler) {
    const t = toplam.get(s.netsim_nokta_no!);
    if (!t) continue;                       // Netsim'de hakedişi yok — dokunma

    // 1) Tamamlanan keşif → sozlesme_fiyatlariyla_gerceklesen
    if (s.gecici_kabul_tarihi) {
      if (!ayni(s.sozlesme_fiyatlariyla_gerceklesen, t.kesif)) {
        console.log(`  KİLİTLİ  ${s.is_adi}`);
        console.log(`           geçici kabul yapılmış → dokunulmadı (site: ${fmt(s.sozlesme_fiyatlariyla_gerceklesen ?? 0)} / Netsim: ${fmt(t.kesif)})`);
        kilitli++;
      }
    } else if (ayni(s.sozlesme_fiyatlariyla_gerceklesen, t.kesif)) {
      degismeyen++;
    } else {
      console.log(`  KEŞİF    ${s.is_adi}`);
      console.log(`           ${fmt(s.sozlesme_fiyatlariyla_gerceklesen ?? 0)} → ${fmt(t.kesif)}`);
      if (!KURU) {
        const { error: e } = await sb.from("santiyeler")
          .update({ sozlesme_fiyatlariyla_gerceklesen: t.kesif, netsim_son_senkron: simdi })
          .eq("id", s.id);
        if (e) console.error(`           HATA: ${e.message}`);
        else kesifYazilan++;
      } else kesifYazilan++;
    }

    // 2) Fiyat farkı → iscilik_takibi.fiyat_farki
    const it = iscilikMap.get(s.id);
    if (!it) continue;                      // işçilik takibi kaydı yoksa atla
    if (ayni(it.fiyat_farki, t.fark)) continue;
    console.log(`  FARK     ${s.is_adi}`);
    console.log(`           ${fmt(it.fiyat_farki ?? 0)} → ${fmt(t.fark)}`);
    if (!KURU) {
      const { error: e } = await sb.from("iscilik_takibi").update({ fiyat_farki: t.fark }).eq("id", it.id);
      if (e) console.error(`           HATA: ${e.message}`);
      else farkYazilan++;
    } else farkYazilan++;
  }

  console.log(`\n${KURU ? "Yazılacaktı" : "Yazıldı"}: ${kesifYazilan} tamamlanan keşif, ${farkYazilan} fiyat farkı.`);
  if (degismeyen) console.log(`Zaten güncel: ${degismeyen}`);
  if (kilitli) console.log(`Geçici kabul nedeniyle atlanan: ${kilitli} (elle güncellemek gerekirse şantiye formundan)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
