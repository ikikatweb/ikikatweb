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
import { pdfMetni, belgeCozumle } from "./icra-belge-oku.mjs";

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

  // Zaten inmişse tekrar İNDİRİLMEZ: ilk açanın kaydını bozmamak için (bkz. aşağıdaki
  // "ÖNEMLİ OLAN İLK AÇANDIR" notu).
  //
  // AMA BELGE YİNE DE OKUNUR (09.11.2026): burada koşulsuz çıkılıyordu ve bu bir boşluk
  // bırakıyordu — belgesi daha önce inmiş tebligatlarda icra defteri hiç dolmuyordu.
  // Okuyucu bugün eklendi; ondan önce indirilmiş 19 belge varken bu "sessizce hiç
  // çalışmayan özellik" demekti. Artık "Belgeleri getir" denince mevcut paket okunup
  // defter dolduruluyor; geçmişi tamamlamanın yolu da bu.
  if (t.paket_yolu) {
    console.log("  zaten açık — indirilmedi, belge okunuyor");
    const not = await icraDefteriniDoldur(t, t.ekler ?? []);
    await sb.from("tebligat").update({ acilma_durumu: null, acilma_hatasi: null }).eq("id", t.id);
    if (not) {
      // Ödeme emri ya da okunamayan belge: sessiz geçilmez, haber verilir.
      try {
        await pushGonder(sb, env, {
          baslik: not.startsWith("⚠") ? "⚠ ŞİRKETE ÖDEME EMRİ" : "Tebligat belgesi okundu",
          govde: `${t.gonderen_ad ?? t.hesap} · ${t.konu ?? "konu yok"}
${not}`,
          url: "/dashboard/yazismalar/e-tebligat",
          etiket: `icra-not-${t.id}`,
          kategori: "e-tebligat",
        });
      } catch (e) { console.log(`  bildirim gönderilemedi: ${e.message}`); }
    }
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
    // AĞ KOPMASINDA TEKRAR DENENİR (09.11.2026): kullanıcı "Aç ve oku"ya bastı, istek
    // 3,5 saat "bekliyor" kaldı ve elle çalıştırınca "fetch failed" verdi — aynı anda
    // curl sorunsuz bağlanıyordu, yani anlık bir kopma. Böyle bir kopma yüzünden isteğin
    // "hata"ya düşüp insanın yeniden basmasını beklemesi, 5 günlük sürede kayıp demek.
    // TEKRAR GÜVENLİ: UETS'te indirme ikinci kez yapılsa da tebligat zaten açılmıştır,
    // ikinci indirme yeni bir şey açmaz. Yalnız AĞ hatasında denenir; sunucu bir
    // cevap verdiyse (401, 406, 500…) tekrar denenmez, o cevap bilgidir.
    const indir = async () => {
      const r = await fetch(`${TEMEL}/messages/${encodeURIComponent(t.uets_id)}/_download`, {
        headers: { authorization: `Bearer ${anahtar}`, "content-type": "application/json" },
      });
      return r;
    };
    let r;
    for (let deneme = 1; ; deneme++) {
      try { r = await indir(); break; }
      catch (agHatasi) {
        // SEBEP YAZILIR: "fetch failed" tek başına hiçbir şey anlatmıyor; altındaki
        // kod (ENOTFOUND, ECONNRESET, ETIMEDOUT…) arızayı teşhis ettiren şey.
        const sebep = agHatasi?.cause?.code ?? agHatasi?.cause?.message ?? "sebep bilinmiyor";
        if (deneme >= 3) throw new Error(`${agHatasi.message} (${sebep}, ${deneme} deneme)`);
        console.error(`  ağ hatası (${sebep}), ${deneme}. deneme — 10 sn sonra tekrar`);
        await new Promise((c) => setTimeout(c, 10_000));
      }
    }
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

  // ÖNEMLİ OLAN İLK AÇANDIR (09.11.2026 düzeltmesi).
  // Eskiden her indirmede okuyan_ad üzerine yazılıyordu. Oysa tebligat BİR KEZ açılır;
  // ikinci indirme yeni bir açma değil, yalnız belgeleri panele getirmektir.
  // İki kayıp vardı:
  //   · Panelden açılmış bir tebligatın belgeleri sonradan getirilince İLK AÇAN siliniyor,
  //     yerine düğmeye son basan yazılıyordu.
  //   · PTT UETS sitesinden açılmış bir tebligatta "panelden X açtı" diye YANLIŞ bir
  //     kayıt oluşuyordu. 09.11.2026'da #108'de tam bu oldu: UETS 10:10 çekiminde kaydı
  //     zaten "read" bildiriyordu, yani biri PTT'den açmıştı; bizim indirme 11:41'de
  //     üstüne Ahmet Can KILINÇ'i yazdı.
  // Kural: açan bilgisi YALNIZ tebligat o ana kadar açılmamışken yazılır. Daha önce
  // açılmışsa (durum read/readtimeout) o alanlara DOKUNULMAZ.
  const ilkAcmaBizde = t.durum !== "read" && t.durum !== "readtimeout";
  if (!ilkAcmaBizde) {
    console.log(`  not: tebligat zaten açıkmış (${t.durum}) — yalnız belgeler getirildi,`
      + ` açan bilgisi değiştirilmedi${t.okuyan_ad ? ` (${t.okuyan_ad})` : " (panel dışında açılmış)"}`);
  }
  const { error: yazHata } = await sb.from("tebligat").update({
    durum: "read",
    ...(ilkAcmaBizde ? {
      okuma_tarihi: simdi,
      okuyan_id: t.acilma_isteyen_id,
      okuyan_ad: t.acilma_isteyen_ad,
    } : {}),
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

  // ═══ BELGEYİ OKU, İCRA DEFTERİNİ DOLDUR ═══
  const icraNotu = await icraDefteriniDoldur(t, ekler);


  try {
    await pushGonder(sb, env, {
      // ŞİRKETE TAKİP BİLDİRİMİ YÜKSELTİLİR: "Tebligat açıldı" başlığı altında
      // kaybolmamalı. Üçüncü şahıs haciz yazısı rutin iştir; şirketten para
      // istenmesi değildir.
      baslik: icraNotu?.startsWith("⚠") ? "⚠ ŞİRKETE ÖDEME EMRİ"
        : sorunlar.length ? "Tebligat açıldı — eksik var" : "Tebligat açıldı",
      govde: `${t.gonderen_ad ?? t.hesap} · ${t.konu ?? "konu yok"}\n`
        + (sorunlar.length ? sorunlar.join(" · ") : `${ekler.length} belge hazır.`)
        + (icraNotu ? `\n${icraNotu}` : ""),
      // BİLDİRİME TIKLAYINCA DOĞRUDAN YAZI AÇILSIN (09.11.2026 kullanıcı isteği):
      // eskiden tebligat listesine götürüyordu, oradan satırı bulup belgeye tıklamak
      // gerekiyordu. Artık asıl belgeye gidiyor.
      //
      // HANGİSİ "ASIL" BELGE: pakette genelde iki dosya var — tebligat yazısının
      // kendisi ve "ustyazi.pdf" (PTT'nin zarf/mazbata kapağı). Kapak değil, yazı
      // açılmalı; o yüzden adı "ustyazi" olmayan ilk PDF seçiliyor.
      // Belge yoksa ya da seçilemezse ESKİ DAVRANIŞ: listeye götürür. Bildirimin
      // tıklanamaz hale gelmesindense liste açılsın.
      url: (() => {
        const yazi = ekler.find((e) => !/ustyazi/i.test(e.ad) && /pdf/i.test(e.tur ?? e.ad))
          ?? ekler.find((e) => /pdf/i.test(e.tur ?? e.ad))
          ?? ekler[0];
        // Kovalar ÖZEL: doğrudan Storage adresine gidilirse 400 döner. /api/dosya
        // geçidi oturumu doğrulayıp kısa ömürlü imzalı adrese yönlendiriyor
        // (bkz. lib/utils/dosya-url).
        return yazi?.yol
          ? `/api/dosya?u=${encodeURIComponent(yazi.yol)}`
          : "/dashboard/yazismalar/e-tebligat";
      })(),
      etiket: `tebligat-acildi-${t.id}`,
      kategori: "e-tebligat",
    });
  } catch (e) { console.log(`  bildirim gönderilemedi: ${e.message}`); }

  return sorunlar.length ? { hata: `${etiket}: ${sorunlar.join(" · ")}` } : {};
}

/**
 * Belgeyi okuyup icra defterini doldurur. Dönen: bildirime eklenecek kısa not (ya da null).
 *
 * ÜÇ SONUÇ:
 *   · üçüncü şahıs yazısı (89/1, maaş haczi) → taslak satır alacaklı/borçlu/tutarla dolar
 *   · ÖDEME EMRİ (borçlu biz)                → DEFTERE YAZILMAZ, uyarı döner
 *   · tanınmayan belge                        → yazılmaz, sebebi loga ve nota düşer
 *
 * NİYE ÖDEME EMRİ YAZILMIYOR: icra defteri "üçüncü şahıs" modeline göre kurulu
 * (ucuncu_sahis, borclu_adi…). Şirkete açılmış bir takibi oraya yazmak, onu rutin
 * bir maaş haczi gibi gösterirdi. 09.11.2026'da kutuda dört tane çıktı ve dördü de
 * hiç açılmamıştı — biri 252.199,22 TL.
 */
export async function icraDefteriniDoldur(t, ekler) {
  // Asıl yazı: "ustyazi" PTT'nin zarf kapağı, ekler arasında başka belgeler de olabilir
  // (fatura, takip dayanağı). Tebligat yazısı olan ilk PDF alınır.
  const yazi = ekler.find((e) => !/ustyazi/i.test(e.ad) && /pdf/i.test(e.tur ?? e.ad));
  if (!yazi) return null;

  let cozum;
  try {
    // Kayıtlı adres genel-URL biçiminde duruyor; kova içi yol oradan çıkarılıyor.
    // Kova ÖZEL: düz fetch 400 döner, service role ile indirilmeli.
    const icYol = decodeURIComponent(String(yazi.yol).split(`/${KOVA}/`)[1] ?? "").split("?")[0];
    if (!icYol) throw new Error("belge yolu çözülemedi");
    const { data: dosya } = await sb.storage.from(KOVA).download(icYol);
    if (!dosya) throw new Error("belge storage'dan inmedi");
    const vknler = await bizimVknler();
    cozum = belgeCozumle(await pdfMetni(Buffer.from(await dosya.arrayBuffer())), vknler);
  } catch (e) {
    // SESSİZ GEÇİLMEZ: okunamadıysa defter elle doldurulmalı, bu duyulmalı.
    console.log(`  belge okunamadı: ${e.message} — icra defteri elle doldurulmalı`);
    return `Belge okunamadı (${e.message}); icra defteri elle doldurulmalı.`;
  }

  if (cozum.rolumuz === "borclu") {
    return await sirketTakibineYaz(t, cozum, yazi);
  }
  if (cozum.tur === "haciz_kaldirma") {
    // KALDIRMA YAZISI YENİ SATIR AÇMAZ. Metin maaş haczi yazısına benziyor (aynı
    // ALACAKLI/BORÇLU etiketleri) ama söylediği tersi: var olan haciz kaldırılıyor.
    // Deftere yazılsaydı, kaldırılmış bir haciz açık borç gibi görünürdü.
    // Hangi dosyanın kapatılacağı insan kararı: kısmi kaldırma da olabiliyor
    // ("bu dosyamıza şamil olmak üzere"), makine kapatmamalı.
    // VAR OLAN DOSYAYA İŞARETLENİR, yeni satır açılmaz. Dosya KAPATILMAZ: kaldırma
    // kısmi olabiliyor ("bu dosyamıza şamil olmak üzere"), başka dosyalardan gelen
    // hacizler sürebilir. Karar insanın; panel yalnız haberi veriyor.
    let nereye = "defterde o dosya yok, işaretlenemedi";
    if (cozum.dosya_esas_no) {
      const { data: satir } = await sb.from("icra").select("id, haciz_kaldirma_tarihi")
        .eq("dosya_esas_no", cozum.dosya_esas_no).limit(1).maybeSingle();
      if (satir && !satir.haciz_kaldirma_tarihi) {
        const { error } = await sb.from("icra").update({
          haciz_kaldirma_tarihi: cozum.belge_tarihi,
          haciz_kaldirma_notu: `İcra dairesinden haciz kaldırma yazısı geldi`
            + `${cozum.belge_tarihi ? ` (${cozum.belge_tarihi})` : ""}.`
            + ` Dosya otomatik kapatılmadı — kaldırma kısmi olabilir, kontrol edin.`,
        }).eq("id", satir.id);
        nereye = error ? `işaretlenemedi: ${error.message}` : "defterdeki dosyaya işaretlendi";
      } else if (satir) {
        nereye = "zaten işaretliymiş";
      }
    }
    console.log(`  haciz KALDIRMA yazısı · ${cozum.dosya_esas_no ?? "dosya no yok"}`
      + ` · ${cozum.borclu_adi ?? "?"} — ${nereye}`);
    return `Haciz KALDIRMA yazısı${cozum.dosya_esas_no ? ` · ${cozum.dosya_esas_no}` : ""}`
      + `${cozum.borclu_adi ? ` · ${cozum.borclu_adi}` : ""} — yeni haciz değil (${nereye}).`;
  }
  if (cozum.tur === "bilinmiyor" || !cozum.dosya_esas_no) {
    console.log(`  belge türü tanınmadı ya da dosya no yok — icra defteri elle doldurulmalı`);
    return "Belge türü tanınmadı; icra defteri elle doldurulmalı.";
  }

  // Taslak satır çekme sırasında açılmıştı; şimdi belgeden gelenlerle doluyor.
  // BOŞ ALAN EZİLMEZ: okunamayan alan null döner ve mevcut değere dokunulmaz —
  // insan elle doldurmuşsa makinenin boşu onu silmesin.
  const yama = {};
  if (cozum.alacakli_adi) yama.alacakli_adi = cozum.alacakli_adi;
  if (cozum.alacakli_vergi_no) yama.alacakli_vergi_no = cozum.alacakli_vergi_no;
  if (cozum.borclu_adi) yama.borclu_adi = cozum.borclu_adi;
  if (cozum.borclu_tc_no) yama.borclu_tc_no = cozum.borclu_tc_no;
  if (cozum.borc_miktari != null) yama.borc_miktari = cozum.borc_miktari;
  if (cozum.belge_tarihi) yama.gelen_yazi_tarihi = cozum.belge_tarihi;
  // Süre BELGEDEN: yazmıyorsa yazılmaz, ekran da süre göstermez.
  if (cozum.cevap_suresi_gun != null) yama.cevap_suresi_gun = cozum.cevap_suresi_gun;
  yama.aciklama = `${cozum.tur === "maas_haczi" ? "Maaş haczi müzekkeresi" : "89/1 haciz ihbarnamesi"}`
    + ` — tebligat belgesinden otomatik okundu.`
    + (cozum.uyarilar.length ? ` Okunamayan: ${cozum.uyarilar.join(", ")}.` : "");

  const { data: satir } = await sb.from("icra")
    .select("id, alacakli_adi, alacakli_vergi_no, borclu_adi, borclu_tc_no, borc_miktari, gelen_yazi_tarihi")
    .eq("dosya_esas_no", cozum.dosya_esas_no).limit(1).maybeSingle();
  if (!satir) {
    console.log(`  icra defterinde ${cozum.dosya_esas_no} satırı yok — doldurulamadı`);
    return null;
  }

  // İNSANIN GİRDİĞİ DEĞER EZİLMEZ: defterdeki 98 satır elle doldurulmuş ve kısaltılmış
  // ünvanlar içeriyor ("ERDEM KILIÇ PETROL MAD. NAK. SAN. VE TİC. LTD. ŞTİ."). Makine
  // yalnız BOŞ alanları doldurur. Zaten dolu bir alanı "daha doğrusu bu" diye değiştirmek,
  // insanın bilerek yazdığını sessizce silmek olurdu.
  const doluAlanlar = [];
  for (const alan of Object.keys(yama)) {
    if (alan === "aciklama") continue;                    // açıklama her zaman tazelenir
    const mevcut = satir[alan];
    if (mevcut !== null && mevcut !== undefined && mevcut !== "" && Number(mevcut) !== 0) {
      doluAlanlar.push(alan);
      delete yama[alan];
    }
  }
  if (doluAlanlar.length) {
    console.log(`  not: ${doluAlanlar.join(", ")} zaten dolu — dokunulmadı (elle girilmiş olabilir)`);
  }
  if (Object.keys(yama).length <= 1) {                    // yalnız aciklama kaldıysa
    console.log(`  icra defteri zaten dolu · ${cozum.dosya_esas_no} — değişiklik yapılmadı`);
    return null;
  }

  const { error } = await sb.from("icra").update(yama).eq("id", satir.id);
  if (error) { console.log(`  icra defteri güncellenemedi: ${error.message}`); return `İcra defteri güncellenemedi: ${error.message}`; }
  console.log(`  icra defteri dolduruldu · ${cozum.dosya_esas_no} · ${cozum.alacakli_adi ?? "?"}`
    + ` → ${cozum.borclu_adi ?? "?"} · ${cozum.borc_miktari ?? "?"}`);
  return null;
}

/**
 * İcra dairesinin adı. UETS konusu şu biçimde geliyor ve BU EN GÜVENİLİR KAYNAK:
 *   "Ankara 7. Genel İcra Dairesi [2026/27774] [Ankara 7. Genel İcra Dairesi-5002...-0-2026/27774]"
 * Belge metninden okumaya çalışmak yerine konunun ilk köşeli parantezden önceki
 * kısmı alınıyor; belgede daire adı başlıkta bazen iki satıra bölünüyor.
 */
function icraDairesi(konu) {
  const ad = String(konu ?? "").split("[")[0].trim();
  return ad || null;
}

/** UETS barkodu — konudaki "…-<13 hane>-0-…" kalıbından; bulunamazsa uets_id. */
function barkodBul(t) {
  return String(t.konu ?? "").match(/-(\d{11,15})-\d+-/)?.[1] ?? t.uets_id ?? null;
}

/**
 * ŞİRKETE AÇILAN TAKİP defterine yazar (public.icra_sirket_takip).
 *
 * NİYE AYRI DEFTER: üçüncü şahıs defteri (public.icra) "borçlu bir başkası, şirket
 * işveren" modeline göre kurulu. Ödeme emrinde rol ters — borçlu şirketin kendisi.
 * Oraya yazmak, şirketten para istenmesini rutin bir maaş haczi gibi gösterirdi.
 * 09.11.2026'ya kadar bu belgeler hiçbir ekranda görünmüyordu: dört tanesi kutuda
 * duruyordu ve dördü de hiç açılmamıştı, biri 252.199,22 TL.
 *
 * İNSANIN GİRDİĞİ EZİLMEZ: satır zaten varsa yalnız BOŞ alanlar doldurulur, durum
 * ve itiraz bilgilerine hiç dokunulmaz.
 */
async function sirketTakibineYaz(t, cozum, yazi) {
  const daire = icraDairesi(t.konu);
  const dosya = cozum.dosya_esas_no ?? String(t.konu ?? "").match(/(\d{4}\/\d+)/)?.[1] ?? null;
  const tutar = cozum.borc_miktari;
  const ozet = `${cozum.alacakli_adi ?? "alacaklı okunamadı"}`
    + `${tutar != null ? ` · ${tutar.toLocaleString("tr-TR")} TL` : ""}`;

  // SESSİZ GEÇİLMEZ: dosya no ya da daire yoksa satır açılmaz (tekrar kaydı engelleyen
  // indeks de bu ikisine dayanıyor) — ama bu durum bildirimde SÖYLENİR.
  if (!dosya || !daire) {
    console.log(`  ⚠ ŞİRKETE ÖDEME EMRİ · ${ozet} — dosya no/daire okunamadı, deftere yazılamadı`);
    return `⚠ ŞİRKETE ÖDEME EMRİ · ${ozet}. Dosya no ya da icra dairesi okunamadı —`
      + ` "Şirkete Açılan Takipler" sekmesine ELLE eklenmeli. İtiraz süresi işliyor.`;
  }

  // Bizim hangi firmamız borçlu: tebligat hangi firmanın hesabına düştüyse o.
  let firmaAdi = null;
  if (t.firma_id) {
    const { data } = await sb.from("firmalar").select("firma_adi").eq("id", t.firma_id).maybeSingle();
    firmaAdi = data?.firma_adi ?? null;
  }

  const { data: mevcut, error: okumaHatasi } = await sb.from("icra_sirket_takip")
    .select("id, borclu_firma, alacakli_adi, alacakli_vergi_no, takip_tutari, belge_tarihi, teblig_tarihi, itiraz_suresi_gun, belge_yolu, tebligat_barkod")
    .eq("icra_dairesi", daire).eq("dosya_esas_no", dosya).limit(1).maybeSingle();
  if (okumaHatasi) {
    // Tablo henüz kurulmamış olabilir (sql/icra_sirket_takip.sql çalıştırılmadıysa).
    console.log(`  ⚠ ŞİRKETE ÖDEME EMRİ · ${dosya} · ${ozet} — defter okunamadı: ${okumaHatasi.message}`);
    return `⚠ ŞİRKETE ÖDEME EMRİ · ${dosya} · ${ozet}. Defter yazılamadı (${okumaHatasi.message});`
      + ` sql/icra_sirket_takip.sql çalıştırılmalı. İtiraz süresi işliyor.`;
  }

  const alanlar = {
    borclu_firma: firmaAdi,
    alacakli_adi: cozum.alacakli_adi,
    alacakli_vergi_no: cozum.alacakli_vergi_no,
    takip_tutari: tutar,
    belge_tarihi: cozum.belge_tarihi,
    // Süre tebligatın ULAŞTIĞI günden işler (defterdeki tebliğ tarihi kuralı aynı).
    teblig_tarihi: (t.ulasma_tarihi ?? "").slice(0, 10) || null,
    // Süre BELGEDEN: yazmıyorsa null kalır ve ekran son itiraz günü göstermez.
    itiraz_suresi_gun: cozum.cevap_suresi_gun,
    belge_yolu: yazi?.yol ?? null,
    tebligat_barkod: barkodBul(t),
  };

  if (mevcut) {
    // Yalnız BOŞ alanlar doldurulur — elle girilmiş değer silinmez.
    const yama = {};
    for (const [k, v] of Object.entries(alanlar)) {
      if (v === null || v === undefined || v === "") continue;
      const eski = mevcut[k];
      if (eski === null || eski === undefined || eski === "" || Number(eski) === 0) yama[k] = v;
    }
    if (Object.keys(yama).length === 0) {
      console.log(`  şirkete açılan takip zaten kayıtlı · ${daire} ${dosya} — değişiklik yapılmadı`);
      return `⚠ ŞİRKETE ÖDEME EMRİ · ${dosya} · ${ozet} — "Şirkete Açılan Takipler"de zaten kayıtlı.`;
    }
    const { error } = await sb.from("icra_sirket_takip").update({ ...yama, updated_at: new Date().toISOString() }).eq("id", mevcut.id);
    if (error) {
      console.log(`  şirket takibi güncellenemedi: ${error.message}`);
      return `⚠ ŞİRKETE ÖDEME EMRİ · ${dosya} · ${ozet}. Defter güncellenemedi: ${error.message}`;
    }
    console.log(`  şirkete açılan takip güncellendi · ${daire} ${dosya} · ${Object.keys(yama).join(", ")}`);
    return `⚠ ŞİRKETE ÖDEME EMRİ · ${dosya} · ${ozet} — "Şirkete Açılan Takipler"deki kayıt dolduruldu.`;
  }

  const { data: yeni, error } = await sb.from("icra_sirket_takip")
    .insert({ ...alanlar, icra_dairesi: daire, dosya_esas_no: dosya, durum: "yeni",
      aciklama: `Ödeme emri — tebligat belgesinden otomatik okundu.`
        + (cozum.uyarilar.length ? ` Okunamayan: ${cozum.uyarilar.join(", ")}.` : "") })
    .select("id").single();
  if (error) {
    console.log(`  şirket takibi açılamadı: ${error.message}`);
    return `⚠ ŞİRKETE ÖDEME EMRİ · ${dosya} · ${ozet}. Deftere yazılamadı: ${error.message} —`
      + ` "Şirkete Açılan Takipler" sekmesine ELLE eklenmeli. İtiraz süresi işliyor.`;
  }
  console.log(`  ⚠ ŞİRKETE ÖDEME EMRİ · ${daire} ${dosya} · ${ozet} — "Şirkete Açılan Takipler"e yazıldı`);
  return `⚠ ŞİRKETE ÖDEME EMRİ: BORÇLU BİZİZ · ${dosya} · ${ozet}.`
    + ` "Şirkete Açılan Takipler"e yazıldı (durum: yeni) — itiraz süresi kaçırılmamalı.`;
}

/** Kendi firmalarımızın VKN'leri — "borçlu biz miyiz" kontrolü için. */
async function bizimVknler() {
  const { data } = await sb.from("firmalar").select("vergi_no").not("vergi_no", "is", null);
  return (data ?? []).map((f) => String(f.vergi_no).replace(/\D/g, "")).filter(Boolean);
}

async function main() {
  const { data, error } = await sb.from("tebligat")
    // durum + okuyan_ad DA OKUNUR: "ilk açan kim" sorusu için gerekli (aşağıya bak).
    .select("id, hesap, uets_id, konu, gonderen_ad, firma_id, paket_yolu, ekler, durum, okuyan_ad, ulasma_tarihi, acilma_isteyen_id, acilma_isteyen_ad, acilma_istegi_at")
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
//
// SADECE DOĞRUDAN ÇALIŞTIRILINCA: bu dosya icraDefteriniDoldur'u dışa veriyor ve
// geçmişi tamamlayan betik onu içe alıyor. Koruma olmasaydı içe alma işlemi UETS
// kuyruğunu da işletirdi — yani bir betiği çağırmak tebligat AÇARDI.
const dogrudanCalistirildi = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (dogrudanCalistirildi) {
  main().catch((e) => { console.error("HATA:", e?.message ?? e); process.exitCode = 1; });
}
