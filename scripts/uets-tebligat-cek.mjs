// UETS → MESNET DEĞİL, İKİKAT: gelen elektronik tebligatları çeker.
//
// NE YAPAR, NE YAPMAZ
// ---------------------------------------------------------------------------
// YAPAR : UETS'teki tebligat LİSTESİNİ sorgular, yeni olanları veritabanına yazar,
//         açılmamış olanları bildirir.
// YAPMAZ: tebligatı İNDİRMEZ. Çünkü UETS'te indirmek = açmak (taahhütname md. 7:
//         "indirdiğimiz paketlerin/eklerin okunmuş olarak işlem göreceğini").
//
// Neden indirmiyoruz: kanun süreyi "adrese ulaştığı tarihi izleyen 5. günün sonu"ndan
// sayar (7201 s. K. 7/a), açılsa da açılmasa da. Ama uygulamada bazı mahkemeler süreyi
// AÇILMA tarihinden başlatıyor. Robot her geleni gece otomatik açarsa, o yorumda 5 güne
// kadar cevap süresi kaybedilir. Açma kararı insanın.
//
// SORGU HAKKI SINIRLI: Standart tarifede günde 12 sorgu (2 saatte 1). Her şirket için
// ayrı anahtar, ayrı sorgu hakkı. Bu yüzden görev 2 saatte bir çalışacak ve her
// çalışmada şirket başına EN FAZLA 2 istek atar (delivered + readtimeout).
//
// Çalıştırma:
//   node scripts/uets-tebligat-cek.mjs            → son 7 günü sorgula, yaz, bildir
//   node scripts/uets-tebligat-cek.mjs --gun=30   → daha geniş pencere (ilk kurulumda)
//   node scripts/uets-tebligat-cek.mjs --kuru     → yazma, ekrana dök
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const TEMEL = "https://apipp.etebligat.gov.tr/v1";
const KURU = process.argv.includes("--kuru");
const GUN = Number((process.argv.find((a) => a.startsWith("--gun=")) ?? "").split("=")[1]) || 7;

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const hesaplar = (env.UETS_HESAPLAR ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const tarih = (saniye) => (saniye ? new Date(Number(saniye) * 1000).toISOString() : null);
const gunTR = (iso) => (iso ? new Date(iso).toLocaleDateString("tr-TR") : "—");

/** UETS'e tek istek. Hata YUTULMAZ: üstteki akış durur ve sebebi bildirilir. */
async function istek(anahtar, yol, parametreler) {
  const u = new URL(TEMEL + yol);
  for (const [k, v] of Object.entries(parametreler ?? {})) u.searchParams.set(k, String(v));
  const r = await fetch(u, {
    headers: { authorization: `Bearer ${anahtar}`, "content-type": "application/json" },
  });
  const govde = await r.text();
  if (!r.ok) {
    let mesaj = govde.slice(0, 200);
    try { const j = JSON.parse(govde); mesaj = `${j.message ?? ""} (kod ${j.code ?? "?"})${j.link ? " · " + j.link : ""}`; } catch { /* düz metin */ }
    throw new Error(`UETS ${r.status}: ${mesaj}`);
  }
  return {
    satirlar: govde ? JSON.parse(govde) : [],
    toplam: Number(r.headers.get("x-total-count") ?? 0),
    okunmamis: Number(r.headers.get("x-unread-count") ?? 0),
  };
}

/** Bir durumdaki tebligatları sayfalayarak getirir. */
async function listele(anahtar, durum, baslangic, bitis) {
  const hepsi = [];
  for (let start = 0; ; start += 250) {
    const { satirlar, toplam } = await istek(anahtar, "/messages", {
      start, count: 250, sort: "-inserttime", type: "incoming",
      status: durum, starttime: baslangic, endtime: bitis,
    });
    hepsi.push(...satirlar);
    // PTT'nin önerisi: toplam, getirilenden fazlaysa sayfalamaya devam.
    if (satirlar.length < 250 || hepsi.length >= toplam) break;
  }
  return hepsi;
}

function kayda(hesap, m) {
  return {
    hesap,
    uets_id: m.id,
    reference_id: m.reference_id ?? null,
    gonderen_adres: m.sender ?? null,
    gonderen_ad: m.sender_name ?? null,
    alici_adres: m.recipient ?? null,
    alici_ad: m.recipient_name ?? null,
    konu: m.subject ?? null,
    ulasma_tarihi: tarih(m.inserttime),
    guncelleme_tarihi: tarih(m.updatetime),
    durum: m.status ?? "bilinmiyor",
    klasor_id: m.folders_id ?? null,
    yon: m.type ? String(m.type).trim() : null,
    boyut: m.size ?? null,
    etag: m.etag ?? null,
    ham: m,
  };
}

async function main() {
  if (hesaplar.length === 0) throw new Error("UETS_HESAPLAR boş — .env.local'e şirket kodlarını yazın.");
  const simdi = Math.floor(Date.now() / 1000);
  const baslangic = simdi - GUN * 86400;
  const yeniler = [];
  const raporlar = [];

  for (const hesap of hesaplar) {
    const anahtar = env[`UETS_${hesap}_API_KEY`];
    // Eksik anahtar SESSİZ GEÇİLMEZ: o şirketin tebligatları hiç gelmez ve kimse bilmez.
    if (!anahtar) throw new Error(`UETS_${hesap}_API_KEY tanımlı değil.`);

    // İki sorgu, PTT'nin kendi önerdiği biçimde:
    //   delivered   → teslim edilmiş ama açılmamış (asıl takip edilecek olan)
    //   readtimeout → 5 gün açılmadığı için otomatik okundu sayılmış (gözden kaçmasın)
    const acik = await listele(anahtar, "delivered", baslangic, simdi);
    const gecmis = await listele(anahtar, "readtimeout", baslangic, simdi);
    const tumu = [...acik, ...gecmis];
    raporlar.push(`${hesap}: ${acik.length} açılmamış · ${gecmis.length} süresi dolmuş`);

    if (tumu.length === 0 || KURU) {
      if (KURU) for (const m of tumu) console.log(`  ${hesap} · ${gunTR(tarih(m.inserttime))} · ${m.status} · ${m.sender_name} · ${m.subject}`);
      continue;
    }

    // Hangi kayıtlar YENİ? Bildirim yalnız ilk görülenler için gitsin.
    const idler = tumu.map((m) => m.id);
    const { data: mevcut, error: okuHata } = await sb
      .from("tebligat").select("uets_id").eq("hesap", hesap).in("uets_id", idler);
    if (okuHata) throw new Error(`tebligat okunamadı: ${okuHata.message}`);
    const bilinen = new Set((mevcut ?? []).map((r) => r.uets_id));

    const { error } = await sb.from("tebligat")
      .upsert(tumu.map((m) => kayda(hesap, m)), { onConflict: "hesap,uets_id" });
    // Yazılamadıysa SESSİZ GEÇME: tebligat geldi ama deftere girmedi demektir.
    if (error) throw new Error(`tebligat yazılamadı: ${error.message}`);

    for (const m of tumu) if (!bilinen.has(m.id)) yeniler.push({ hesap, m });
  }

  console.log(raporlar.join("\n"));
  if (KURU) { console.log("--kuru: hiçbir şey yazılmadı."); return; }

  // ───────── bildirim ─────────
  if (yeniler.length === 0) { console.log("Yeni tebligat yok."); return; }
  for (const { hesap, m } of yeniler) {
    const sonGun = new Date(new Date(tarih(m.inserttime)).getTime() + 5 * 86400000);
    console.log(`YENİ · ${hesap} · ${m.sender_name} · ${m.subject} · tebliğ sayılacağı gün ${sonGun.toLocaleDateString("tr-TR")}`);
  }
  // Bildirim gönderimi bir sonraki adımda bağlanacak (lib/bildirim.ts sunucu tarafında).
  // Buraya kadar olan kısım anahtar çalışır çalışmaz denenebilir.
}

main().catch((e) => { console.error("HATA:", e?.message ?? e); process.exit(1); });
