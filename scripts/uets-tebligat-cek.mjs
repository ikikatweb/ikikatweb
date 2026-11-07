// UETS → gelen elektronik tebligatları çeker.
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
// kadar cevap süresi kaybedilir. Açma kararı insanın: panelde "Aç ve oku" düğmesi var
// (app/api/tebligat/ac) ve kimin açtığı kayda geçer.
//
// ANAHTARLAR VERİTABANINDA: her firmanın anahtarı Firma Düzenle > UETS E-Tebligat
// sekmesinden giriliyor ve firma_uets tablosunda duruyor (bkz. sql/firma_uets.sql).
// .env.local'de UETS anahtarı ARANMAZ — yeni firma eklemek için sunucu dosyası
// düzenlemek gerekmesin diye taşındı.
//
// SORGU HAKKI SINIRLI: Standart tarifede günde 12 sorgu (2 saatte 1). Her firmanın
// ayrı anahtarı, ayrı sorgu hakkı var. Görev 2 saatte bir çalışır ve firma başına
// TEK istek atar — limit gerçekten 2 saatlik: ikinci istek "406 · istek limiti aşıldı
// (kod 501) · 85 dakika sonra tekrar deneyiniz" ile döner. Elle deneme yaparken bunu
// unutma: bir deneme, o firmanın o 2 saatlik hakkını yer.
//
// Çalıştırma:
//   node scripts/uets-tebligat-cek.mjs            → son 7 günü sorgula, yaz, bildir
//   node scripts/uets-tebligat-cek.mjs --gun=30   → daha geniş pencere (ilk kurulumda)
//   node scripts/uets-tebligat-cek.mjs --kuru     → yazma, ekrana dök
import fs from "fs";
import path from "path";
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
const GUN = Number((process.argv.find((a) => a.startsWith("--gun=")) ?? "").split("=")[1]) || 7;

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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

/**
 * Gelen kutusunu sayfalayarak getirir. `durum` verilmezse status SÜZGECİ GÖNDERİLMEZ —
 * tek sorguda bütün durumlar gelir, ayrım çağıran tarafta yapılır (bkz. TEK İSTEK KURALI).
 */
async function listele(anahtar, durum, baslangic, bitis) {
  const hepsi = [];
  for (let start = 0; ; start += 250) {
    const parametreler = {
      start, count: 250, sort: "-inserttime", type: "incoming",
      starttime: baslangic, endtime: bitis,
    };
    if (durum) parametreler.status = durum;
    const { satirlar, toplam } = await istek(anahtar, "/messages", parametreler);
    hepsi.push(...satirlar);
    // PTT'nin önerisi: toplam, getirilenden fazlaysa sayfalamaya devam.
    if (satirlar.length < 250 || hepsi.length >= toplam) break;
  }
  return hepsi;
}

function kayda(hesap, firmaId, m) {
  return {
    hesap,
    firma_id: firmaId,
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

/**
 * Firma ayarlarındaki son durum alanı — ekranda "son çekim / son hata" olarak görünür.
 * `adres` verilirse firmanın UETS adresi de yazılır: bu bilgi kullanıcıdan istenmiyor,
 * ilk gelen tebligatın "recipient" alanından öğreniliyor (zaten bizim adresimiz).
 */
async function durumYaz(firmaId, hata, adres) {
  const yama = { son_cekim: new Date().toISOString(), son_hata: hata ?? null };
  if (adres) yama.uets_adres = adres;
  const { error } = await sb.from("firma_uets").update(yama).eq("firma_id", firmaId);
  if (error) console.log(`   (firma_uets durumu yazılamadı: ${error.message})`);
}

async function main() {
  // Hangi firmalar sorgulanacak? Ayar ekranından girilen, aktif ve anahtarı olanlar.
  const { data: ayarlar, error: ayarHata } = await sb
    .from("firma_uets")
    .select("firma_id, api_key, aktif, uets_adres, firmalar ( firma_adi, kisa_adi )")
    .eq("aktif", true);
  if (ayarHata) throw new Error(`firma_uets okunamadı: ${ayarHata.message}`);

  const firmalar = (ayarlar ?? []).filter((f) => f.api_key);
  if (firmalar.length === 0) {
    throw new Error(
      "UETS anahtarı tanımlı firma yok. Firma Düzenle > UETS E-Tebligat sekmesinden anahtarı girin.");
  }

  const simdi = Math.floor(Date.now() / 1000);
  const baslangic = simdi - GUN * 86400;
  const yeniler = [];
  const raporlar = [];
  const hatalar = [];

  for (const f of firmalar) {
    // hesap = firmanın kısa adı; tebligat defterinde hangi şirkete geldiğini bu gösterir.
    const hesap = (f.firmalar?.kisa_adi || f.firmalar?.firma_adi || f.firma_id).slice(0, 20);
    try {
      // TEK İSTEK KURALI: tarife firma başına 2 SAATTE 1 sorgu veriyor (günde 12).
      // Burada eskiden durum başına ayrı sorgu atılıyordu (delivered + readtimeout);
      // ikinci istek daima "406 · API entegrasyonuna ait istek limiti aşıldı (kod 501)"
      // ile dönüyor, yani çekim hiçbir zaman tamamlanmıyordu. Artık tek sorgu atılıyor,
      // durum süzgeci gönderilmiyor ve ayrım burada yapılıyor.
      //   delivered   → teslim edilmiş ama açılmamış (asıl takip edilecek olan)
      //   readtimeout → 5 gün açılmadığı için otomatik okundu sayılmış (gözden kaçmasın)
      // Diğer durumlar (ör. elle okunmuş) aynı cevapta geliyor ama deftere YAZILMIYOR —
      // kapsam bilerek eskisiyle aynı tutuldu.
      const gelenler = await listele(f.api_key, null, baslangic, simdi);
      const acik = gelenler.filter((m) => m.status === "delivered");
      const gecmis = gelenler.filter((m) => m.status === "readtimeout");
      const tumu = [...acik, ...gecmis];
      // HANGİ DURUMLAR GELDİ: "0 açılmamış" tek başına iki ayrı şeyi anlatıyor — gerçekten
      // tebligat yok, ya da hepsi başka bir durumda (ör. portalda elle açılmış → "read") ve
      // bu süzülmüş. İkisini ayırt edebilmek için sayım loga yazılıyor; ek istek gerektirmiyor,
      // aynı cevabın içinden çıkıyor. Sorgu hakkı 2 saatte 1 olduğu için "bir daha bakıp
      // öğrenelim" seçeneği pahalı: cevap geldiğinde bıraktığı iz yeterli olmalı.
      const durumSayim = gelenler.reduce((t, m) => {
        const d = m.status ?? "bilinmiyor";
        t[d] = (t[d] ?? 0) + 1;
        return t;
      }, /** @type {Record<string, number>} */ ({}));
      const durumOzet = Object.entries(durumSayim).map(([d, n]) => `${d}:${n}`).join(" ") || "hiç kayıt yok";
      raporlar.push(`${hesap}: ${acik.length} açılmamış · ${gecmis.length} süresi dolmuş · pencerede ${gelenler.length} kayıt (${durumOzet})`);

      if (KURU) {
        for (const m of tumu) console.log(`  ${hesap} · ${gunTR(tarih(m.inserttime))} · ${m.status} · ${m.sender_name} · ${m.subject}`);
        continue;
      }
      // Firmanın UETS adresi henüz bilinmiyorsa ilk tebligattan öğren (alıcı = biziz).
      const ogrenilenAdres = f.uets_adres ? null : (tumu.find((m) => m.recipient)?.recipient ?? null);
      if (ogrenilenAdres) console.log(`   ${hesap} UETS adresi öğrenildi: ${ogrenilenAdres}`);

      if (tumu.length === 0) { await durumYaz(f.firma_id, null); continue; }

      // Hangi kayıtlar YENİ? Bildirim yalnız ilk görülenler için gitsin.
      const idler = tumu.map((m) => m.id);
      const { data: mevcut, error: okuHata } = await sb
        .from("tebligat").select("uets_id").eq("hesap", hesap).in("uets_id", idler);
      if (okuHata) throw new Error(`tebligat okunamadı: ${okuHata.message}`);
      const bilinen = new Set((mevcut ?? []).map((r) => r.uets_id));

      const { error } = await sb.from("tebligat")
        .upsert(tumu.map((m) => kayda(hesap, f.firma_id, m)), { onConflict: "hesap,uets_id" });
      // Yazılamadıysa SESSİZ GEÇME: tebligat geldi ama deftere girmedi demektir.
      if (error) throw new Error(`tebligat yazılamadı: ${error.message}`);

      for (const m of tumu) if (!bilinen.has(m.id)) yeniler.push({ hesap, m });
      await durumYaz(f.firma_id, null, ogrenilenAdres);
    } catch (e) {
      // BİR FİRMA PATLAYINCA DİĞERLERİ DE ÇEKİLMESİN OLMAZ: kalanlara devam edilir,
      // ama hata firmanın ayar ekranına yazılır ve görev hatayla biter (sessiz kalmaz).
      const mesaj = e?.message ?? String(e);
      console.error(`HATA · ${hesap}: ${mesaj}`);
      hatalar.push(`${hesap}: ${mesaj}`);
      raporlar.push(`${hesap}: ÇEKİLEMEDİ — ${mesaj}`);
      if (!KURU) await durumYaz(f.firma_id, mesaj);
    }
  }

  console.log(raporlar.join("\n"));
  if (KURU) { console.log("--kuru: hiçbir şey yazılmadı."); }

  // ───────── bildirim ─────────
  if (!KURU && yeniler.length === 0) console.log("Yeni tebligat yok.");

  for (const { hesap, m } of yeniler) {
    const ulasma = tarih(m.inserttime);
    const sonGun = new Date(new Date(ulasma).getTime() + 5 * 86400000);
    const sonGunTR = sonGun.toLocaleDateString("tr-TR");
    console.log(`YENİ · ${hesap} · ${m.sender_name} · ${m.subject} · tebliğ sayılacağı gün ${sonGunTR}`);

    // Bildirimde SON GÜN yazıyor, "yeni tebligat var" demekle yetinmiyoruz: e-tebligatta
    // önemli olan geldiği değil, ne zamana kadar cevap verilmesi gerektiğidir.
    const govde = `${m.sender_name ?? m.sender} · ${m.subject ?? "konu yok"}`
      + `
Tebliğ sayılacağı gün: ${sonGunTR}`
      + (m.status === "readtimeout" ? " · SÜRE DOLDU, otomatik okundu sayıldı" : "");
    try {
      const n = await pushGonder(sb, env, {
        baslik: `${hesap} · yeni e-tebligat`,
        govde,
        url: "/dashboard/yazismalar/e-tebligat",
        // Etiket tebligata özel: aynı tebligat için ikinci bir push üst üste binmesin.
        etiket: `tebligat-${m.id}`,
        kategori: "e-tebligat",
      });
      if (n > 0) console.log(`   bildirim → ${n} cihaz`);
    } catch (e) {
      // Bildirim hatası veriyi etkilemesin; tebligat zaten deftere yazıldı.
      console.log(`   bildirim gönderilemedi: ${e.message}`);
    }
  }

  if (hatalar.length) throw new Error(`${hatalar.length} firma çekilemedi · ${hatalar.join(" | ")}`);
}

// process.exit() KULLANILMIYOR: bu projede libuv teardown çökmesine yol açıyordu
// (0xC0000409). Çıkış kodunu işaretleyip akışın kendiliğinden bitmesini bekliyoruz.
main().catch((e) => { console.error("HATA:", e?.message ?? e); process.exitCode = 1; });
