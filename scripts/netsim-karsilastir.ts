// Netsim ↔ site RAKAM KARŞILAŞTIRMASI — bağlı tüm işlerde fark var mı?
//
// Senkron bazı durumlarda kasten yazmaz; bu script "neden farklı kaldı"yı gösterir:
//   KİLİTLİ      → geçici kabul yapılmış, tutar iş deneyim belgesinde kesinleşmiş sayılır
//   KAYIT YOK    → işçilik takibi satırı yok, fiyat farkının yazılacağı alan yok
//   ÇÖPTE        → işçilik takibi satırı silinmiş (silindi=true), senkron dokunmaz
//   FARKLI       → yazılabilirdi ama tutmuyor (senkron çalışmamış olabilir)
//
// SADECE OKUR. Çalıştırma:
//   npx tsx scripts/netsim-karsilastir.ts           → sadece farklı olanlar
//   npx tsx scripts/netsim-karsilastir.ts --hepsi   → bağlı tüm işler
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

const tl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ayni = (a: number | null | undefined, b: number | null | undefined) =>
  Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

async function main() {
  const hepsi = process.argv.includes("--hepsi");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da Supabase anahtarları yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: sData, error } = await sb
    .from("santiyeler")
    .select("id, sira_no, is_adi, netsim_nokta_no, sozlesme_fiyatlariyla_gerceklesen, gecici_kabul_tarihi")
    .not("netsim_nokta_no", "is", null)
    .order("sira_no");
  if (error) throw new Error(error.message);
  const santiyeler = (sData ?? []) as {
    id: string; sira_no: number; is_adi: string; netsim_nokta_no: number;
    sozlesme_fiyatlariyla_gerceklesen: number | null; gecici_kabul_tarihi: string | null;
  }[];

  const { data: nData } = await sb.from("netsim_isler").select("nokta_no, ad, kesif, fark");
  const netsim = new Map(
    ((nData ?? []) as { nokta_no: number; ad: string; kesif: number | null; fark: number | null }[])
      .map((n) => [n.nokta_no, n]),
  );

  // İşçilik takibi satırları — silinmişler dahil (durumu raporlayacağız)
  const { data: itData } = await sb.from("iscilik_takibi").select("santiye_id, fiyat_farki, silindi");
  const iscilik = new Map<string, { fiyat_farki: number | null; silindi: boolean }>();
  for (const r of (itData ?? []) as { santiye_id: string; fiyat_farki: number | null; silindi: boolean }[]) {
    const mevcut = iscilik.get(r.santiye_id);
    // Aktif satır varsa o kazanır
    if (!mevcut || (mevcut.silindi && !r.silindi)) iscilik.set(r.santiye_id, { fiyat_farki: r.fiyat_farki, silindi: r.silindi });
  }

  let farkli = 0;
  const satirlar: string[] = [];

  for (const s of santiyeler) {
    const n = netsim.get(s.netsim_nokta_no);
    if (!n) continue;
    const it = iscilik.get(s.id);

    const kesifAyni = ayni(s.sozlesme_fiyatlariyla_gerceklesen, n.kesif);
    const farkAyni = it && !it.silindi ? ayni(it.fiyat_farki, n.fark) : Number(n.fark || 0) === 0;

    if (kesifAyni && farkAyni && !hepsi) continue;
    if (!kesifAyni || !farkAyni) farkli++;

    const neden: string[] = [];
    if (!kesifAyni && s.gecici_kabul_tarihi) neden.push("KİLİTLİ (geçici kabul " + s.gecici_kabul_tarihi.slice(0, 10) + ")");
    if (!farkAyni && !it) neden.push("İŞÇİLİK KAYDI YOK");
    if (!farkAyni && it?.silindi) neden.push("İŞÇİLİK KAYDI ÇÖPTE");
    if (!kesifAyni && !s.gecici_kabul_tarihi) neden.push("SENKRON YAZMALIYDI");
    if (!farkAyni && it && !it.silindi) neden.push("SENKRON YAZMALIYDI");

    satirlar.push(`sıra ${String(s.sira_no).padEnd(4)} [nokta ${String(s.netsim_nokta_no).padEnd(4)}] ${s.is_adi}`);
    satirlar.push(`  tamamlanan keşif  site ${tl(s.sozlesme_fiyatlariyla_gerceklesen).padStart(16)}   netsim ${tl(n.kesif).padStart(16)}   ${kesifAyni ? "aynı" : "FARK " + tl(Math.abs((Number(n.kesif) || 0) - (Number(s.sozlesme_fiyatlariyla_gerceklesen) || 0)))}`);
    satirlar.push(`  fiyat farkı       site ${tl(it && !it.silindi ? it.fiyat_farki : null).padStart(16)}   netsim ${tl(n.fark).padStart(16)}   ${farkAyni ? "aynı" : "FARK " + tl(Math.abs((Number(n.fark) || 0) - (Number(it?.fiyat_farki) || 0)))}`);
    if (neden.length) satirlar.push(`  → ${neden.join(" · ")}`);
    satirlar.push("");
  }

  console.log(`Bağlı iş: ${santiyeler.length}   |   farklı olan: ${farkli}\n`);
  console.log(satirlar.join("\n") || "Tüm rakamlar Netsim ile aynı.");
}

main().catch((e) => { console.error(e); process.exit(1); });
