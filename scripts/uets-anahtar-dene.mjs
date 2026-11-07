// UETS ANAHTARI ÇALIŞIYOR MU? — saat başı yoklama.
//
// NEDEN VAR: PTT'nin verdiği API anahtarları 06.11.2026 itibarıyla "401 · API anahtarı
// bulunamadı (kod 602)" dönüyor. Kurulum tarafında yapılacak bir şey kalmadı; anahtarın
// PTT'de aktifleşmesi bekleniyor. Bu betik saat başı tek bir yoklama isteği atar ve
// anahtar çalışmaya başladığı AN sistemi kendiliğinden ayağa kaldırır.
//
// ÇALIŞTIĞI ANDA NE YAPAR
//   1. Tebligatları hemen çeker (son 30 gün) — "açılınca veriler siteye gelsin".
//   2. 2 saatlik düzenli çekme görevini kurar ve çalıştırır.
//   3. Kendi saatlik görevini KAPATIR — iş bitti, sorgu hakkı boşa harcanmasın.
//   4. Telefona bildirim gönderir.
//
// ÇALIŞMADIĞINDA: log'a satır yazar, SUSAR. Her saat "yine olmadı" diye bildirim
// göndermek telefonu günde 24 kez titretir ve haber değeri taşımaz. TEK İSTİSNA: hata
// mesajı DEĞİŞİRSE bildirim gider — PTT tarafında bir şey oynamış demektir, bu haberdir.
//
// SORGU HAKKI: yoklama isteği 401'de kimlik doğrulamadan önce reddediliyor, yani
// başarısız denemeler kotadan yemiyor. Anahtar çalıştığı anda da bu görev kapanıyor;
// toplamda kotadan yenen tek istek, işe yarayan o son yoklama.
//
// Çalıştırma:
//   node scripts/uets-anahtar-dene.mjs          → yokla, çalışırsa her şeyi başlat
//   node scripts/uets-anahtar-dene.mjs --kuru   → yokla, hiçbir şey kurma/çekme
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { pushGonder } from "./push-gonder.mjs";

const kok = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

// ASIL SUNUCU: api.etebligat.gov.tr. "apipp.*" PİLOT (pp) ortamıdır — ayrı IP, ayrı
// sürüm numarası, ayrı anahtar havuzu. 06–07.11.2026'da anahtarlar PTT portalında
// "Aktif" göründüğü halde sürekli "401 · API anahtarı bulunamadı (kod 602)" alınmasının
// sebebi buydu: istek pilot sunucuya gidiyordu, gerçek anahtar orada kayıtlı değil.
// Aynı anahtar api.etebligat.gov.tr'de ilk denemede 200 döndü. DEĞİŞTİRMEDEN ÖNCE DÜŞÜN.
const TEMEL = "https://api.etebligat.gov.tr/v1";
const KURU = process.argv.includes("--kuru");
const GOREV_YOKLAMA = "UETS Anahtar Dene";     // bu betiğin kendi görevi (saat başı)
const GOREV_CEKME = "UETS Tebligat Cek";       // asıl çekme görevi (2 saatte bir)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const durumYol = path.join(kok, "logs", ".uets-dene-durum.json");
const log = (s) => {
  const satir = `${new Date().toLocaleString("tr-TR")} · ${s}`;
  console.log(satir);
  try {
    fs.mkdirSync(path.join(kok, "logs"), { recursive: true });
    fs.appendFileSync(path.join(kok, "logs", "uets-anahtar-dene.log"), satir + "\n", "utf8");
  } catch { /* log yazılamıyorsa bile akış sürsün; ekrana zaten basıldı */ }
};

function durumOku() {
  try { return JSON.parse(fs.readFileSync(durumYol, "utf8")); } catch { return {}; }
}
function durumYaz(d) {
  try {
    fs.mkdirSync(path.join(kok, "logs"), { recursive: true });
    fs.writeFileSync(durumYol, JSON.stringify(d, null, 1), "utf8");
  } catch (e) { log(`durum dosyası yazılamadı: ${e.message}`); }
}

/** Tek yoklama isteği. Dönen: { ok, mesaj }. */
async function yokla(anahtar) {
  const u = new URL(`${TEMEL}/messages`);
  u.searchParams.set("start", "0");
  u.searchParams.set("count", "1");
  u.searchParams.set("type", "incoming");
  try {
    const r = await fetch(u, { headers: { authorization: `Bearer ${anahtar}`, "content-type": "application/json" } });
    const metin = await r.text();
    if (r.ok) return { ok: true, mesaj: `HTTP ${r.status}` };
    let mesaj = metin.slice(0, 200);
    try { const j = JSON.parse(metin); mesaj = `${j.message ?? mesaj}${j.code ? ` (kod ${j.code})` : ""}`; } catch { /* düz metin */ }
    return { ok: false, mesaj: `HTTP ${r.status}: ${mesaj}` };
  } catch (e) {
    return { ok: false, mesaj: `ulaşılamadı: ${e.message}` };
  }
}

/** Windows görevini kurar/açar. Hata ÖLÜMCÜL DEĞİL — veri zaten çekildi, haber verilir. */
function gorevKur() {
  const bat = path.join(kok, "scripts", "uets-tebligat-cek.bat");
  const kullanici = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`.replace(/^\\/, "");
  try {
    // Varsa kapalıyken açılsın, yoksa kurulsun. /NP + /RU → S4U: oturum açık olmadan da çalışır
    // (diğer görevler de böyle; makine güç kesintisinden sonra kimse giriş yapmadan toparlıyor).
    execFileSync("schtasks", [
      "/Create", "/F", "/TN", GOREV_CEKME, "/TR", `"${bat}"`,
      "/SC", "MINUTE", "/MO", "120", "/RU", kullanici, "/NP", "/RL", "LIMITED",
    ], { stdio: "pipe" });
    log(`"${GOREV_CEKME}" görevi kuruldu (2 saatte bir).`);
    return true;
  } catch (e) {
    log(`UYARI: "${GOREV_CEKME}" görevi kurulamadı: ${String(e.stderr ?? e.message).trim()}`);
    return false;
  }
}

/** Saatlik yoklama görevini kapatır — işi bitti. */
function yoklamayiKapat() {
  try {
    execFileSync("schtasks", ["/Change", "/TN", GOREV_YOKLAMA, "/DISABLE"], { stdio: "pipe" });
    log(`"${GOREV_YOKLAMA}" görevi kapatıldı.`);
  } catch (e) {
    // Kapatılamazsa saat başı yoklama sürer; zararı yok ama SÖYLENİR.
    log(`UYARI: "${GOREV_YOKLAMA}" kapatılamadı: ${String(e.stderr ?? e.message).trim()}`);
  }
}

async function main() {
  const { data: ayarlar, error } = await sb
    .from("firma_uets").select("firma_id, api_key, aktif, firmalar ( kisa_adi, firma_adi )")
    .eq("aktif", true);
  if (error) throw new Error(`firma_uets okunamadı: ${error.message}`);
  const firmalar = (ayarlar ?? []).filter((f) => f.api_key);
  if (firmalar.length === 0) { log("Anahtarı olan aktif firma yok — yoklama yapılmadı."); return; }

  const sonuclar = [];
  for (const f of firmalar) {
    const ad = f.firmalar?.kisa_adi || f.firmalar?.firma_adi || f.firma_id;
    const s = await yokla(f.api_key);
    sonuclar.push({ ad, ...s });
    log(`${ad}: ${s.ok ? "ÇALIŞTI" : "olmadı"} · ${s.mesaj}`);
  }

  const calisan = sonuclar.filter((s) => s.ok);
  const durum = durumOku();
  const imza = sonuclar.map((s) => `${s.ad}=${s.mesaj}`).join(" | ");

  // ───────── hâlâ çalışmıyor ─────────
  if (calisan.length === 0) {
    const degisti = durum.imza && durum.imza !== imza;
    durumYaz({ ...durum, imza, sonDeneme: new Date().toISOString() });
    if (!degisti) { log("Değişiklik yok — bildirim gönderilmedi (kasıtlı)."); return; }
    // Hata mesajı değiştiyse bu haberdir: PTT tarafında bir şey oynamış.
    log("Hata mesajı DEĞİŞTİ — bildirim gönderiliyor.");
    if (KURU) return;
    try {
      await pushGonder(sb, env, {
        baslik: "UETS anahtarı — hata mesajı değişti",
        govde: `Önceki: ${durum.imza}\nŞimdi: ${imza}`,
        url: "/dashboard/yazismalar/e-tebligat",
        etiket: "uets-anahtar-degisti",
        kategori: "e-tebligat",
      });
    } catch (e) { log(`bildirim gönderilemedi: ${e.message}`); }
    return;
  }

  // ───────── ÇALIŞTI ─────────
  log(`UETS AÇILDI — çalışan firma: ${calisan.map((s) => s.ad).join(", ")}`);
  if (KURU) { log("--kuru: çekme ve görev kurulumu atlandı."); return; }

  // 1) Verileri hemen getir. Pencere yok: gelen kutusunun en yenileri süzgeçsiz çekiliyor
  //    (sebep: uets-tebligat-cek.mjs başındaki "TARİH PENCERESİ GÖNDERİLMİYOR" notu).
  let cekmeOzet = "";
  let cekmeHata = null;
  try {
    cekmeOzet = execFileSync(process.execPath, [path.join(kok, "scripts", "uets-tebligat-cek.mjs")],
      { cwd: kok, encoding: "utf8", stdio: "pipe", timeout: 10 * 60_000 });
    log("İlk çekim tamam:\n" + cekmeOzet.trim());
  } catch (e) {
    // SESSİZ GEÇME: anahtar çalıştı ama veri gelmediyse bu mutlaka bilinmeli.
    cekmeHata = String(e.stdout ?? "") + String(e.stderr ?? e.message);
    log("İlk çekim HATA verdi:\n" + cekmeHata.trim());
  }

  // 2) Düzenli görevi kur, 3) kendini kapat
  const kuruldu = gorevKur();
  yoklamayiKapat();
  durumYaz({ imza, basariliZaman: new Date().toISOString(), gorevKuruldu: kuruldu });

  // 4) Haber ver
  const satirlar = (cekmeOzet || "").split(/\r?\n/).filter((s) => /açılmamış|süresi dolmuş|YENİ|çekilemedi/.test(s));
  const govde = [
    cekmeHata ? "ANCAK İLK ÇEKİM HATA VERDİ, kontrol edin." : (satirlar.join("\n") || "Çekim tamam."),
    kuruldu ? "2 saatlik otomatik çekme görevi kuruldu." : "UYARI: 2 saatlik görev KURULAMADI, elle kurulmalı.",
  ].join("\n");
  try {
    await pushGonder(sb, env, {
      baslik: "✅ UETS anahtarı çalışmaya başladı",
      govde,
      url: "/dashboard/yazismalar/e-tebligat",
      etiket: "uets-anahtar-calisti",
      kategori: "e-tebligat",
    });
  } catch (e) { log(`bildirim gönderilemedi: ${e.message}`); }

  if (cekmeHata) process.exitCode = 1;
}

// process.exit() KULLANILMIYOR (libuv teardown çökmesi — bkz. uets-tebligat-cek.mjs).
main().catch((e) => { log(`HATA: ${e?.message ?? e}`); process.exitCode = 1; });
