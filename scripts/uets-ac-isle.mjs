// TEBLİGAT AÇMA İSTEKLERİNİ İŞLE — UETS'e giden TEK yer.
//
// NEDEN BURADA: UETS API'si yalnız PTT portalında tanımlı statik IP'den çalışıyor.
// Panel Vercel'de duruyor, oradan yapılan istek TCP seviyesinde kesiliyor ("fetch
// failed"). Bu yüzden "Aç ve oku" düğmesi tebligatı indirmiyor, isteği kuyruğa yazıyor
// (bkz. sql/tebligat_acilma_kuyrugu.sql); indirme işini ofisteki bu görev yapıyor.
//
// BU İŞLEM GERİ ALINAMAZ. Taahhütname md. 7: indirilen paketler okunmuş sayılır. Yani
// bu betik bir tebligatı indirdiği an tebligat UETS'te AÇILMIŞ olur. O yüzden:
//   · yalnız kullanıcının açıkça istediği kayıtları işler (acilma_durumu='bekliyor'),
//   · kimin istediği kayda geçer (okuyan_id / okuyan_ad),
//   · indirme başladıysa sonuç ne olursa olsun satır "okundu" işaretlenir — paket
//     kaydedilemese bile tebligat açılmıştır, bunu gizlemek yanlış olur.
//
// SESSİZ HATA YOK: paket inmezse/açılmazsa sebep hem indirme_hatasi'na hem
// acilma_hatasi'na yazılır, ekranda kırmızı görünür.
//
// Çalıştırma:
//   node scripts/uets-ac-isle.mjs          → bekleyen istekleri işle
//   node scripts/uets-ac-isle.mjs --kuru   → ne yapacağını söyle, UETS'e dokunma
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
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
const KOVA = "yazismalar";
const KURU = process.argv.includes("--kuru");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

/** Paketin içinden kullanıcıya gösterilecek dosyalar; imza/üstveri paketin içinde kalır. */
const BELGE_UZANTI = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "rtf", "txt",
  "udf", "jpg", "jpeg", "png", "gif", "tif", "tiff", "bmp", "html", "htm", "eml", "zip", "rar",
]);
const TURLER = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
  txt: "text/plain; charset=utf-8", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  xml: "application/xml", eml: "message/rfc822", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const uzanti = (ad) => (ad.includes(".") ? ad.split(".").pop().toLowerCase() : "");
const TR = { "ç":"c","ğ":"g","ı":"i","ö":"o","ş":"s","ü":"u","Ç":"C","Ğ":"G","İ":"I","Ö":"O","Ş":"S","Ü":"U" };
const guvenliAd = (ad) => String(ad)
  .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => TR[c] ?? c)
  .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-120) || "dosya";

/** Firmanın UETS anahtarı. Tebligat hangi firmaya geldiyse onunkiyle inilir. */
async function anahtarBul(t) {
  let firmaId = t.firma_id;
  if (!firmaId) {
    const { data: f } = await sb.from("firmalar").select("id").eq("kisa_adi", t.hesap).maybeSingle();
    firmaId = f?.id ?? null;
  }
  if (!firmaId) throw new Error(`"${t.hesap}" hangi firmaya ait belirlenemedi.`);
  const { data } = await sb.from("firma_uets").select("api_key").eq("firma_id", firmaId).maybeSingle();
  if (!data?.api_key) {
    throw new Error(`${t.hesap} için UETS anahtarı tanımlı değil (Firma Düzenle > UETS E-Tebligat).`);
  }
  return data.api_key;
}

async function isle(t) {
  const etiket = `#${t.id} ${t.hesap} · ${t.konu ?? "konu yok"}`;
  console.log(`\n▶ ${etiket}`);

  // Zaten inmişse tekrar indirme: hem sorgu hakkı harcar hem ilk açanın kaydını bozar.
  if (t.paket_yolu) {
    console.log("  zaten açık, istek kapatıldı");
    await sb.from("tebligat").update({ acilma_durumu: null, acilma_hatasi: null }).eq("id", t.id);
    return;
  }

  const anahtar = await anahtarBul(t);
  if (KURU) { console.log("  --kuru: indirilmedi"); return; }

  // "islemde" işareti: görev üst üste çalışırsa aynı tebligat iki kez indirilmesin.
  await sb.from("tebligat").update({ acilma_durumu: "islemde" }).eq("id", t.id);

  // ───────── UETS'ten indir ─────────
  // Bu noktadan SONRA tebligat açılmış sayılır. Öncesinde hiçbir şey yazılmaz.
  let paket, etag = null;
  try {
    const r = await fetch(`${TEMEL}/messages/${encodeURIComponent(t.uets_id)}/_download`, {
      headers: { authorization: `Bearer ${anahtar}`, "content-type": "application/json" },
    });
    if (!r.ok) {
      let mesaj = (await r.text()).slice(0, 300);
      try { const j = JSON.parse(mesaj); mesaj = `${j.message ?? mesaj}${j.code ? ` (kod ${j.code})` : ""}`; } catch { /* düz metin */ }
      throw new Error(`UETS ${r.status}: ${mesaj}`);
    }
    etag = r.headers.get("etag");
    paket = Buffer.from(await r.arrayBuffer());
    if (paket.length === 0) throw new Error("UETS boş paket döndü.");
  } catch (e) {
    // İndirme OLMADI → tebligat açılmadı. Kayıt kirletilmez, istek "hata" olur.
    const mesaj = e?.message ?? String(e);
    console.error(`  İNMEDİ: ${mesaj}`);
    await sb.from("tebligat").update({ acilma_durumu: "hata", acilma_hatasi: mesaj }).eq("id", t.id);
    return { hata: `${etiket}: ${mesaj}` };
  }

  // ───────── buradan sonra TEBLİGAT AÇILMIŞTIR ─────────
  const kokYol = `tebligat/${guvenliAd(t.hesap)}/${guvenliAd(t.uets_id)}`;
  const adres = (yol) => sb.storage.from(KOVA).getPublicUrl(yol).data.publicUrl;
  const sorunlar = [];
  let paketYolu = null;
  const ekler = [];

  {
    const yol = `${kokYol}/paket.eyp`;
    const { error } = await sb.storage.from(KOVA)
      .upload(yol, paket, { upsert: true, contentType: "application/octet-stream" });
    if (error) sorunlar.push(`EYP paketi kaydedilemedi: ${error.message}`);
    else paketYolu = adres(yol);
  }

  // EYP bir arşiv dosyası (PTT'nin kendi hata mesajı da "Arşiv dosyasında ... yok" diyor).
  try {
    const zip = await JSZip.loadAsync(paket);
    const girdiler = Object.values(zip.files).filter((f) => !f.dir);
    const belgeler = girdiler.filter((f) => BELGE_UZANTI.has(uzanti(f.name)));
    if (belgeler.length === 0) {
      sorunlar.push(`Pakette gösterilebilir belge yok. İçindekiler: ${girdiler.map((f) => f.name).join(", ") || "boş"}`);
    }
    for (const f of belgeler) {
      const icerik = Buffer.from(await f.async("uint8array"));
      const ad = f.name.split("/").pop() || f.name;
      const yol = `${kokYol}/${guvenliAd(ad)}`;
      const { error } = await sb.storage.from(KOVA)
        .upload(yol, icerik, { upsert: true, contentType: TURLER[uzanti(ad)] ?? "application/octet-stream" });
      if (error) { sorunlar.push(`${ad} kaydedilemedi: ${error.message}`); continue; }
      ekler.push({ ad, yol: adres(yol), tur: uzanti(ad), boyut: icerik.length });
    }
  } catch (e) {
    sorunlar.push(`EYP paketi açılamadı: ${e?.message ?? e}`);
  }

  const simdi = new Date().toISOString();
  const { error: yazHata } = await sb.from("tebligat").update({
    durum: "read",
    okuma_tarihi: simdi,
    // Açan kişi, açılmasını isteyen kişidir — düğmeye o bastı.
    okuyan_id: t.acilma_isteyen_id,
    okuyan_ad: t.acilma_isteyen_ad,
    paket_yolu: paketYolu,
    ekler,
    etag: etag ?? undefined,
    indirme_hatasi: sorunlar.length ? sorunlar.join(" · ") : null,
    acilma_durumu: sorunlar.length ? "hata" : null,
    acilma_hatasi: sorunlar.length ? sorunlar.join(" · ") : null,
  }).eq("id", t.id);

  if (yazHata) {
    // Tebligat açıldı ama deftere yazılamadı — en kötü hâl, mutlaka duyulmalı.
    const mesaj = `Tebligat UETS'te AÇILDI ancak kaydedilemedi: ${yazHata.message}`;
    console.error(`  ${mesaj}`);
    return { hata: `${etiket}: ${mesaj}` };
  }

  console.log(`  açıldı · ${ekler.length} belge${sorunlar.length ? ` · UYARI: ${sorunlar.join(" · ")}` : ""}`);
  try {
    await pushGonder(sb, env, {
      baslik: sorunlar.length ? "Tebligat açıldı — eksik var" : "Tebligat açıldı",
      govde: `${t.gonderen_ad ?? t.hesap} · ${t.konu ?? "konu yok"}\n`
        + (sorunlar.length ? sorunlar.join(" · ") : `${ekler.length} belge hazır.`),
      url: "/dashboard/yazismalar/e-tebligat",
      etiket: `tebligat-acildi-${t.id}`,
      kategori: "e-tebligat",
    });
  } catch (e) { console.log(`  bildirim gönderilemedi: ${e.message}`); }

  return sorunlar.length ? { hata: `${etiket}: ${sorunlar.join(" · ")}` } : {};
}

async function main() {
  const { data, error } = await sb.from("tebligat")
    .select("id, hesap, uets_id, konu, gonderen_ad, firma_id, paket_yolu, acilma_isteyen_id, acilma_isteyen_ad, acilma_istegi_at")
    // "islemde" de alınır: önceki çalışma yarıda kaldıysa (makine kapandı vb.) iş asılı kalmasın.
    .in("acilma_durumu", ["bekliyor", "islemde"])
    .order("acilma_istegi_at", { ascending: true });
  if (error) throw new Error(`istekler okunamadı: ${error.message}`);
  if (!data?.length) { console.log("Bekleyen açma isteği yok."); return; }

  console.log(`${data.length} açma isteği var.`);
  const hatalar = [];
  for (const t of data) {
    try {
      const s = await isle(t);
      if (s?.hata) hatalar.push(s.hata);
    } catch (e) {
      // Bir istek patlayınca diğerleri beklemesin; sebep kayda ve çıkışa yansır.
      const mesaj = e?.message ?? String(e);
      console.error(`  HATA: ${mesaj}`);
      hatalar.push(`#${t.id}: ${mesaj}`);
      await sb.from("tebligat").update({ acilma_durumu: "hata", acilma_hatasi: mesaj }).eq("id", t.id);
    }
  }
  if (hatalar.length) throw new Error(`${hatalar.length} istek sorunlu · ${hatalar.join(" | ")}`);
}

// process.exit() KULLANILMIYOR (libuv teardown çökmesi — bkz. uets-tebligat-cek.mjs).
main().catch((e) => { console.error("HATA:", e?.message ?? e); process.exitCode = 1; });
