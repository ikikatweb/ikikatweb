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
// --kisa: zamanlanmış görevde çalışırken log şişmesin diye kilitli işlerin dökümünü
// yazmaz, sadece sayar. Bu satırlar her turda aynı olduğu için 15 dakikada bir
// tekrarlanması log'u gereksiz büyütüyordu.
const KISA = process.argv.includes("--kisa");

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
  netsim_gerceklesen: number | null;   // rozet için: senkronun en son yazdığı değer
  gecici_kabul_tarihi: string | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("santiyeler")
    .select("id, is_adi, netsim_nokta_no, sozlesme_fiyatlariyla_gerceklesen, netsim_gerceklesen, gecici_kabul_tarihi")
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
    .select("id, santiye_id, fiyat_farki, netsim_fiyat_farki")
    .eq("silindi", false);
  if (itErr) throw new Error(itErr.message);
  const iscilikMap = new Map<string, { id: string; fiyat_farki: number | null; netsim_fiyat_farki: number | null }>();
  for (const r of (itData ?? []) as { id: string; santiye_id: string; fiyat_farki: number | null; netsim_fiyat_farki: number | null }[]) {
    iscilikMap.set(r.santiye_id, { id: r.id, fiyat_farki: r.fiyat_farki, netsim_fiyat_farki: r.netsim_fiyat_farki });
  }

  // Netsim'deki TÜM işler (hakedişi olsun olmasın) — tutarları LEFT JOIN ile.
  //
  // Hakedişi olmayan işler de alınır: iş kartı Netsim'de açıldığı anda şantiyeye
  // bağlanabilsin, ilk hakediş kesildiğinde tutar kendiliğinden aksın. (Önceden
  // yalnız hakedişi olanlar alınıyordu; Tıp Fakültesi Beceri Laboratuvarı gibi
  // yeni işler bu yüzden ne önerilere ne otomatik eşleştirmeye giriyordu.)
  // Kategori düğümleri (başka noktaların ANA'sı olanlar: İNŞAAT, HARİTA) hariç.
  const db = await fbBagla();
  const toplam = new Map<number, { kesif: number; fark: number }>();
  const tumIsler: { no: number; ad: string; kesif: number; fark: number }[] = [];
  try {
    const rows = await fbSorgu(db, `
      SELECT I.ISLEM_NOKTASI_NO AS NOKTA, I.ISLEM_NOKTASI_ADI AS AD,
             COALESCE((
               SELECT SUM(CASE WHEN D.STOK_NO = 39 THEN D.HAM_TUTAR ELSE 0 END)
               FROM ALSADETA D JOIN ALSAASIL A ON A.ALISSATIS_NO = D.ALISSATIS_NO
               WHERE A.ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO AND A.ISLEM_KODU = 'HAKFAT'
             ), 0) AS TAMAMLANAN_KESIF,
             COALESCE((
               SELECT SUM(CASE WHEN D.STOK_NO = 356 THEN D.HAM_TUTAR ELSE 0 END)
               FROM ALSADETA D JOIN ALSAASIL A ON A.ALISSATIS_NO = D.ALISSATIS_NO
               WHERE A.ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO AND A.ISLEM_KODU = 'HAKFAT'
             ), 0) AS FIYAT_FARKI
      FROM ISLMNOKT I
      WHERE I.ISLEM_NOKTASI_NO > 0
        AND NOT EXISTS (
          SELECT 1 FROM ISLMNOKT C WHERE C.ANA_ISLEM_NOKTASI_NO = I.ISLEM_NOKTASI_NO
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
      ORDER BY I.ISLEM_NOKTASI_NO
    `);
    for (const r of rows) {
      const no = Number(r.NOKTA);
      const kesif = Number(r.TAMAMLANAN_KESIF ?? 0);
      const fark = Number(r.FIYAT_FARKI ?? 0);
      toplam.set(no, { kesif, fark });
      tumIsler.push({ no, ad: String(r.AD ?? "").trim(), kesif, fark });
    }
  } finally {
    db.detach();
  }

  // Ayna tablosunu tazele — form önerisi bunu okuyor. Hata olursa senkron yine de sürer.
  const bagliNoktalar = new Set(santiyeler.map((s) => s.netsim_nokta_no).filter((n): n is number => n != null));
  const { error: aynaHata } = await sb.from("netsim_isler").upsert(
    tumIsler.map((i) => ({
      nokta_no: i.no, ad: i.ad, kesif: i.kesif, fark: i.fark,
      bagli: bagliNoktalar.has(i.no), guncellendi: new Date().toISOString(),
    })),
    { onConflict: "nokta_no" },
  );
  if (aynaHata) console.error(`netsim_isler aynası güncellenemedi: ${aynaHata.message}`);

  console.log(`${santiyeler.length} bağlı şantiye, Netsim'de ${toplam.size} tanesinin hakedişi var.${KURU ? "  [KURU ÇALIŞMA — yazma yok]" : ""}\n`);

  const simdi = new Date().toISOString();
  let kesifYazilan = 0, farkYazilan = 0, kilitli = 0, degismeyen = 0;

  for (const s of santiyeler) {
    const t = toplam.get(s.netsim_nokta_no!);
    if (!t) continue;                       // Netsim'de hakedişi yok — dokunma

    // 1) Tamamlanan keşif → sozlesme_fiyatlariyla_gerceklesen
    //
    // netsim_gerceklesen (gölge alan) "Netsim şu an ne diyor"u tutar ve asıl değer
    // değişmese bile güncellenir — rozet bu ikisinin eşitliğine bakıyor. Yoksa zaten
    // güncel olan satırlarda rozet hiç çıkmazdı.
    const yama: Record<string, unknown> = {};
    if (!ayni(s.netsim_gerceklesen, t.kesif)) yama.netsim_gerceklesen = t.kesif;

    if (s.gecici_kabul_tarihi) {
      if (!ayni(s.sozlesme_fiyatlariyla_gerceklesen, t.kesif)) {
        if (!KISA) {
          console.log(`  KİLİTLİ  ${s.is_adi}`);
          console.log(`           geçici kabul yapılmış → dokunulmadı (site: ${fmt(s.sozlesme_fiyatlariyla_gerceklesen ?? 0)} / Netsim: ${fmt(t.kesif)})`);
        }
        kilitli++;
      }
    } else if (ayni(s.sozlesme_fiyatlariyla_gerceklesen, t.kesif)) {
      degismeyen++;
    } else {
      console.log(`  KEŞİF    ${s.is_adi}`);
      console.log(`           ${fmt(s.sozlesme_fiyatlariyla_gerceklesen ?? 0)} → ${fmt(t.kesif)}`);
      yama.sozlesme_fiyatlariyla_gerceklesen = t.kesif;
      yama.netsim_son_senkron = simdi;
      kesifYazilan++;
    }

    if (!KURU && Object.keys(yama).length > 0) {
      const { error: e } = await sb.from("santiyeler").update(yama).eq("id", s.id);
      if (e) { console.error(`           HATA: ${e.message}`); if (yama.sozlesme_fiyatlariyla_gerceklesen != null) kesifYazilan--; }
    }

    // 2) Fiyat farkı → iscilik_takibi.fiyat_farki
    const it = iscilikMap.get(s.id);
    if (!it) continue;                      // işçilik takibi kaydı yoksa atla

    const itYama: Record<string, unknown> = {};
    if (!ayni(it.netsim_fiyat_farki, t.fark)) itYama.netsim_fiyat_farki = t.fark;

    if (!ayni(it.fiyat_farki, t.fark)) {
      console.log(`  FARK     ${s.is_adi}`);
      console.log(`           ${fmt(it.fiyat_farki ?? 0)} → ${fmt(t.fark)}`);
      itYama.fiyat_farki = t.fark;
      farkYazilan++;
    }

    if (!KURU && Object.keys(itYama).length > 0) {
      const { error: e } = await sb.from("iscilik_takibi").update(itYama).eq("id", it.id);
      if (e) { console.error(`           HATA: ${e.message}`); if (itYama.fiyat_farki != null) farkYazilan--; }
    }
  }

  console.log(`\n${KURU ? "Yazılacaktı" : "Yazıldı"}: ${kesifYazilan} tamamlanan keşif, ${farkYazilan} fiyat farkı.`);
  if (degismeyen) console.log(`Zaten güncel: ${degismeyen}`);
  if (kilitli) console.log(`Geçici kabul nedeniyle atlanan: ${kilitli} (elle güncellemek gerekirse şantiye formundan)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
