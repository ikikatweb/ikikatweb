// Netsim ↔ site RAKAM KARŞILAŞTIRMASI — bağlı tüm işlerde fark var mı?
//
// Senkron bazı durumlarda kasten yazmaz; bu script "neden farklı kaldı"yı gösterir:
//   KİLİTLİ      → geçici kabul yapılmış, tutar iş deneyim belgesinde kesinleşmiş sayılır
//   KAYIT YOK    → işçilik takibi satırı yok, fiyat farkının yazılacağı alan yok
//   ÇÖPTE        → işçilik takibi satırı silinmiş (silindi=true), senkron dokunmaz
//   FARKLI       → yazılabilirdi ama tutmuyor (senkron çalışmamış olabilir)
//
// "BEKLENEN FARK": geçici kabullü işlerde iki kaynak farklı olabilir ve sitedeki
// tutar doğrudur (iş deneyim belgesine giren rakam kesinleşmiştir). Bir kez
// incelenip kabul edilen farklar işaretlenir ve bir daha uyarı listesine girmez —
// ta ki Netsim'deki tutar değişene kadar (yeni hakediş), o zaman tekrar sorar.
//
// SADECE OKUR (--kabul hariç). Çalıştırma:
//   npx tsx scripts/netsim-karsilastir.ts           → incelenmesi gerekenler
//   npx tsx scripts/netsim-karsilastir.ts --hepsi   → bağlı tüm işler
//   npx tsx scripts/netsim-karsilastir.ts --kabul   → mevcut farkları "kontrol edildi" işaretle
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

function kabulEdelim(liste: { id: string; kesif: number; ad: string }[], id: string, kesif: number, ad: string) {
  liste.push({ id, kesif, ad });
}

async function main() {
  const hepsi = process.argv.includes("--hepsi");
  const kabulEt = process.argv.includes("--kabul");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local'da Supabase anahtarları yok.");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: sData, error } = await sb
    .from("santiyeler")
    .select("id, sira_no, is_adi, netsim_nokta_no, sozlesme_fiyatlariyla_gerceklesen, gecici_kabul_tarihi, netsim_fark_kabul")
    .not("netsim_nokta_no", "is", null)
    .order("sira_no");
  if (error) throw new Error(error.message);
  const santiyeler = (sData ?? []) as {
    id: string; sira_no: number; is_adi: string; netsim_nokta_no: number;
    sozlesme_fiyatlariyla_gerceklesen: number | null; gecici_kabul_tarihi: string | null;
    netsim_fark_kabul: number | null;
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

  let ortusen = 0;
  const incelenecek: string[] = [];
  const beklenen: string[] = [];
  const kabulEdilecek: { id: string; kesif: number; ad: string }[] = [];

  for (const s of santiyeler) {
    const n = netsim.get(s.netsim_nokta_no);
    if (!n) continue;
    const it = iscilik.get(s.id);

    const kesifAyni = ayni(s.sozlesme_fiyatlariyla_gerceklesen, n.kesif);
    // Fiyat farkı: işçilik kaydı yoksa/çöpteyse siteye yazılacak alan yok — bu bir
    // fark değil, kapsam dışı. Kullanıcı bu işlerin fiyat farkıyla ilgilenmiyor.
    const farkKapsamDisi = !it || it.silindi;
    const farkAyni = farkKapsamDisi ? true : ayni(it.fiyat_farki, n.fark);

    if (kesifAyni && farkAyni) { ortusen++; if (!hepsi) continue; }

    // Daha önce incelenip kabul edilmiş mi? (Netsim tutarı o günden beri değişmemişse)
    const kabulEdilmis = s.netsim_fark_kabul != null && ayni(s.netsim_fark_kabul, n.kesif);

    const govde: string[] = [];
    govde.push(`sıra ${String(s.sira_no).padEnd(4)} [nokta ${String(s.netsim_nokta_no).padEnd(4)}] ${s.is_adi}`);
    govde.push(`  tamamlanan keşif  site ${tl(s.sozlesme_fiyatlariyla_gerceklesen).padStart(16)}   netsim ${tl(n.kesif).padStart(16)}   ${kesifAyni ? "aynı" : "FARK " + tl(Math.abs((Number(n.kesif) || 0) - (Number(s.sozlesme_fiyatlariyla_gerceklesen) || 0)))}`);
    if (!farkKapsamDisi) {
      govde.push(`  fiyat farkı       site ${tl(it.fiyat_farki).padStart(16)}   netsim ${tl(n.fark).padStart(16)}   ${farkAyni ? "aynı" : "FARK " + tl(Math.abs((Number(n.fark) || 0) - (Number(it.fiyat_farki) || 0)))}`);
    }

    if (kabulEdilmis) {
      beklenen.push(`sıra ${String(s.sira_no).padEnd(4)} ${s.is_adi.slice(0, 52).padEnd(52)} site ${tl(s.sozlesme_fiyatlariyla_gerceklesen).padStart(15)}  netsim ${tl(n.kesif).padStart(15)}`);
      continue;
    }

    const neden: string[] = [];
    if (!kesifAyni && s.gecici_kabul_tarihi) neden.push("KİLİTLİ (geçici kabul " + s.gecici_kabul_tarihi.slice(0, 10) + ")");
    if (!kesifAyni && !s.gecici_kabul_tarihi) neden.push("SENKRON YAZMALIYDI");
    if (!farkAyni) neden.push("SENKRON YAZMALIYDI (fiyat farkı)");
    if (neden.length) govde.push(`  → ${neden.join(" · ")}`);
    govde.push("");
    incelenecek.push(govde.join("\n"));
    if (!kesifAyni) kabulEdelim(kabulEdilecek, s.id, Number(n.kesif) || 0, s.is_adi);
  }

  console.log(`Bağlı iş: ${santiyeler.length}  |  örtüşen: ${ortusen}  |  beklenen fark (kontrol edildi): ${beklenen.length}  |  incelenmesi gereken: ${incelenecek.length}\n`);

  if (incelenecek.length) {
    console.log("===== İNCELENMESİ GEREKEN =====\n");
    console.log(incelenecek.join("\n"));
  } else {
    console.log("İncelenmesi gereken fark yok.\n");
  }

  if (beklenen.length) {
    console.log("===== BEKLENEN FARK (daha önce kontrol edildi, site doğru) =====");
    console.log(beklenen.join("\n"));
    console.log("");
  }

  if (kabulEt && kabulEdilecek.length) {
    let yazilan = 0;
    for (const k of kabulEdilecek) {
      const { error: e } = await sb.from("santiyeler").update({ netsim_fark_kabul: k.kesif }).eq("id", k.id);
      if (e) console.error(`  HATA ${k.ad}: ${e.message}`); else yazilan++;
    }
    console.log(`${yazilan} iş "kontrol edildi" olarak işaretlendi; bundan sonra beklenen fark sayılacaklar.`);
    console.log(`(Netsim'deki tutar değişirse tekrar incelenecekler listesine düşerler.)`);
  } else if (kabulEt) {
    console.log("İşaretlenecek yeni fark yok.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
