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
// TARİH PENCERESİ GÖNDERİLMİYOR (07.11.2026). Eskiden isteğe starttime/endtime
// eklenirdi; PTT'nin bu iki parametreyi hangi biçimde beklediği (saniye? milisaniye?
// tarih metni?) hiçbir açık kaynakta yazmıyor — entegrasyon kılavuzu yalnız sözleşmeli
// firmalara veriliyor. Biçim yanlışsa sunucu HATA DÖNDÜRMEZ, BOŞ LİSTE döndürür; o da
// "tebligat yok" ile aynı görünür. 14:10 çekimi iki firmada da "0 kayıt" dedi ve bunun
// gerçek mi yoksa süzgeç arızası mı olduğu ayırt edilemedi. Artık gelen kutusunun en
// yenileri süzgeçsiz istenir, tarih ayıklaması BURADA yapılır ve rapora sunucunun
// bildirdiği toplam kayıt sayısı yazılır: "0 kayıt · sunucu toplamı 0" gerçekten boş
// kutudur, "0 kayıt · sunucu toplamı 12" ise bizim tarafta arıza demektir.
//
// Çalıştırma:
//   node scripts/uets-tebligat-cek.mjs            → gelen kutusunu sorgula, yaz, bildir
//   node scripts/uets-tebligat-cek.mjs --tumu     → TAM DÖKÜM: kutunun tamamı, sayfalayarak
//   node scripts/uets-tebligat-cek.mjs --kuru     → yazma, ekrana dök
//
// TAM DÖKÜM (--tumu) NE ZAMAN: bir kez, kurulumda. Rutin çalışma kutunun yalnız en yeni
// 250 kaydını alır; geçmişi daha uzunsa gerisi hiç gelmez. --tumu sayfalayarak hepsini
// alır ama HER SAYFA BİR SORGU HAKKI YER (günde 12, 2 saatte 1) — 250'den fazla kayıt
// varsa döküm birkaç saate yayılır. Kota dolunca durur, aldığını yazar ve kaçının eksik
// kaldığını söyler; yarım dökümü "tamam" diye bildirmez.
// Döküm kipinde TELEFON BİLDİRİMİ GÖNDERİLMEZ: geçmişin tamamı için push atmak telefonu
// onlarca kez titretir ve haber değeri taşımaz. Kayıtlar deftere girer, ekranda görünür;
// kaç bildirimin bastırıldığı loga yazılır (sessiz geçilmez).
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
const TUMU = process.argv.includes("--tumu");
// SAYFA BOYU: tek istekte alınabilen en fazla kayıt. Sorgu hakkı 2 saatte 1 olduğu için
// sayfalama YAPILMIYOR — ikinci sayfa isteği "406 · istek limiti aşıldı" ile dönerdi.
// Sunucudaki toplam bundan fazlaysa rapora uyarı düşer, sessiz kalmaz.
const SAYFA = 250;
// BİLDİRİM PENCERESİ: bu kadar günden eski tebligat için telefon ÖTMEZ. 07.11.2026'da
// tarih penceresi arızası giderilince geçmişin tamamı bir anda deftere girdi ve 2023
// tarihli bir icra tebligatı için bile bildirim gitti — 9 bildirim × 10 cihaz. Eski kayıt
// haber değil, arşivdir; bildirimi değersizleştirir. Kayıtlar deftere YAZILIR, rozete ve
// ekrana girer, yalnız push gönderilmez.
const BILDIRIM_GUN = 7;
if (process.argv.some((a) => a.startsWith("--gun"))) {
  // Sessiz yutma yok: bayrak artık bir şey yapmıyorsa bu söylenir, yoksa "30 günü
  // taradım" sanılır. Pencere sunucuya hiç gönderilmiyor (yukarıdaki nota bak).
  console.log("UYARI: --gun artık kullanılmıyor, yoksayıldı — gelen kutusunun en yenileri süzgeçsiz çekiliyor.");
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const tarih = (saniye) => (saniye ? new Date(Number(saniye) * 1000).toISOString() : null);
const gunTR = (iso) => (iso ? new Date(iso).toLocaleDateString("tr-TR") : "—");

/** UETS'e tek istek. Hata YUTULMAZ: üstteki akış durur ve sebebi bildirilir. */
async function istek(anahtar, yol, parametreler) {
  const u = new URL(TEMEL + yol);
  for (const [k, v] of Object.entries(parametreler ?? {})) u.searchParams.set(k, String(v));
  // AĞ KOPMASINDA TEKRAR DENENİR (09.11.2026). 10:10 turunda IKI "fetch failed" aldı,
  // aynı anda curl sorunsuz bağlanıyordu — anlık bir kopma. Eskiden o firma o tur
  // atlanıyor ve 2 SAAT sonraki tura kalıyordu; tebligatta süre 5 gün, bir tur kaybı
  // ucuz değil.
  //
  // TEKRAR BEDAVA: ağ koptuğunda istek PTT'ye HİÇ ulaşmıyor, yani sorgu hakkından
  // (günde 12, 2 saatte 1) yemiyor. Sunucu bir cevap verdiyse — 401, 406, 500 — o
  // cevap bilgidir ve TEKRAR DENENMEZ: 406 "kotan doldu" demek, üst üste denemek
  // limiti daha da kilitler.
  let r;
  for (let deneme = 1; ; deneme++) {
    try {
      r = await fetch(u, {
        headers: { authorization: `Bearer ${anahtar}`, "content-type": "application/json" },
      });
      break;
    } catch (agHatasi) {
      // SEBEP YAZILIR: "fetch failed" tek başına hiçbir şey anlatmıyor; teşhis
      // ettiren altındaki kod (ENOTFOUND, ECONNRESET, ETIMEDOUT…).
      const sebep = agHatasi?.cause?.code ?? agHatasi?.cause?.message ?? "sebep bilinmiyor";
      if (deneme >= 3) throw new Error(`${agHatasi.message} (${sebep}, ${deneme} deneme)`);
      console.log(`   ağ hatası (${sebep}), ${deneme}. deneme — 10 sn sonra tekrar`);
      await new Promise((c) => setTimeout(c, 10_000));
    }
  }
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
 * Gelen kutusunun en yenilerini TEK istekle getirir. Status süzgeci de, tarih penceresi
 * de sunucuya GÖNDERİLMEZ (yukarıdaki nota bak) — ayrım çağıran tarafta yapılır.
 * Dönen: { satirlar: alınan kayıtlar, toplam: sunucunun bildirdiği toplam }.
 */
async function listele(anahtar) {
  return istek(anahtar, "/messages", {
    start: 0, count: SAYFA, sort: "-inserttime", type: "incoming",
  });
}

/**
 * TAM DÖKÜM: gelen kutusunun tamamını sayfalayarak getirir — okunmuş, okunmamış, süresi
 * dolmuş, hepsi. Status süzgeci yok, tarih penceresi yok.
 *
 * SIRALAMA BİLEREK "-inserttime" (yeniden eskiye, rutin çalışmayla aynı): bu sıralamanın
 * çalıştığı görüldü, artan sıralama sözdizimi doğrulanmadı. Döküm sürerken yeni tebligat
 * gelirse sayfalar kayar; eski kayıtlar yerinde durduğu için kaçan olmaz, yeni gelen ise
 * rutin çalışmanın her turda okuduğu ilk sayfada zaten görünür.
 *
 * KOTA: her sayfa bir sorgu hakkı. Hak dolunca PTT "406 · istek limiti aşıldı (kod 501)"
 * döner. O noktada DURULUR, o ana kadar alınanlar yazılır ve eksik kalan söylenir:
 * yarım dökümü tamam saymak, bir tebligatı hiç görmemek demek olurdu.
 */
async function listeleTumu(anahtar, hesap) {
  const hepsi = [];
  let toplam = 0;
  let eksik = null;
  for (let start = 0; ; start += SAYFA) {
    let sayfa;
    try {
      sayfa = await istek(anahtar, "/messages", {
        start, count: SAYFA, sort: "-inserttime", type: "incoming",
      });
    } catch (e) {
      // İLK sayfa alınamadıysa bu gerçek bir hata: yukarıya fırlat, firma "ÇEKİLEMEDİ" olsun.
      if (start === 0) throw e;
      eksik = `${hepsi.length}. kayıttan sonrası alınamadı — ${e.message}`;
      console.log(`   ${hesap} · DÖKÜM YARIM KALDI: ${eksik}`);
      break;
    }
    toplam = sayfa.toplam || toplam;
    hepsi.push(...sayfa.satirlar);
    console.log(`   ${hesap} · döküm ${hepsi.length}/${toplam || "?"} kayıt`);
    if (sayfa.satirlar.length === 0 || (toplam && hepsi.length >= toplam)) break;
  }
  return { satirlar: hepsi, toplam, eksik };
}

/**
 * İCRA DAİRESİNDEN GELEN YAZI MI? Konu "… İcra Dairesi [2026/368508] …" biçiminde.
 * Mahkeme/hâkimlik tebligatları KAPSAM DIŞI: onların icra defterinde yeri yok ve
 * otomatik açılmaları için bir sebep de yok — açmak geri alınamaz bir işlem.
 */
// TÜRKÇE "İ" TUZAĞI: /icra dairesi/i kalıbı "İcra Dairesi"yi BULMUYOR. JavaScript
// "İ" (U+0130) harfini küçültünce "i̇" (i + birleşen nokta) üretiyor ve bu "i" ile
// eşleşmiyor. İlk yazımda bu kalıp kullanılmıştı: otomatik açma HİÇ TETİKLENMEZDİ,
// üstelik sessizce — "yeni icra yazısı yok" gibi görünürdü. Türkçe locale ile
// küçültüp aramak gerekiyor.
const icraYazisiMi = (m) => String(m.subject ?? "").toLocaleLowerCase("tr").includes("icra dairesi");

/** Konudaki dosya esas numarası: "… [2026/368508] …" → "2026/368508". Yoksa null. */
const dosyaEsasNo = (m) => String(m.subject ?? "").match(/(\d{4}\/\d+)/)?.[1] ?? null;

/**
 * İCRA DEFTERİNE TASLAK SATIR — tebligat düşer düşmez.
 *
 * NİYE: icra yazıları elle icra sayfasına işleniyordu; kullanıcı "gelir gelmez
 * işlensin" dedi (09.11.2026). Satır hemen açılırsa dosya gözden kaçmıyor ve
 * cevap süresi ilk günden görünür oluyor.
 *
 * YALNIZ BİLİNENLER YAZILIR: üçüncü şahıs (firma ünvanı), dosya esas no ve tebliğ
 * tarihi. Alacaklı, borçlu ve tutar BELGENİN İÇİNDE — onları açma işleyicisi PDF'ten
 * okuyup dolduruyor. Burada tahmin yok: bilinmeyen alan boş kalır.
 *
 * TEBLİĞ TARİHİ = ULAŞMA TARİHİ. "Ulaşma + 5" (VUK/7201) DEĞİL — ev usulü böyle:
 * 09.11.2026'da mevcut kayıtlarda doğrulandı (2026/368508 → 08.10, 2026/17289 → 02.10).
 * Hesaplayıp yazsaydım bütün satırlar yanlış tarihle girerdi.
 *
 * AYNI DOSYA İKİNCİ KEZ AÇILMAZ: bir dosyaya ikinci tebligat gelebiliyor (89/2 gibi);
 * ikinci satır "iki ayrı icra dosyası" gibi okunur.
 */
async function icraTaslagiAc(m, firmaId, hesap) {
  const dosya = dosyaEsasNo(m);
  if (!dosya) {
    console.log(`   ${hesap} · icra taslağı açılmadı: konuda dosya esas no yok — "${String(m.subject ?? "").slice(0, 60)}"`);
    return;
  }
  const { data: mevcut, error: bakHata } = await sb.from("icra")
    .select("id").eq("dosya_esas_no", dosya).limit(1);
  if (bakHata) { console.log(`   ${hesap} · icra tablosu okunamadı: ${bakHata.message}`); return; }
  if ((mevcut ?? []).length) { console.log(`   ${hesap} · ${dosya} icra defterinde zaten var — taslak açılmadı.`); return; }

  // Üçüncü şahıs = firmanın ünvanı. UYDURULMAZ: firmalar.firma_adi ile icra.ucuncu_sahis
  // birebir aynı değerler (09.11.2026'da doğrulandı: KAD 44, IKI 31 eşleşme).
  let unvan = null;
  if (firmaId) {
    const { data: f } = await sb.from("firmalar").select("firma_adi").eq("id", firmaId).maybeSingle();
    unvan = f?.firma_adi ?? null;
  }

  const { error } = await sb.from("icra").insert({
    ucuncu_sahis: unvan,
    dosya_esas_no: dosya,
    teblig_tarihi: tarih(m.inserttime)?.slice(0, 10) ?? null,
    aciklama: "UETS tebligatından otomatik açıldı — alacaklı/borçlu/tutar belge okunduktan sonra dolar.",
  });
  // SESSİZ GEÇİLMEZ: satır açılamadıysa dosya elle işlenmeli, bu duyulmalı.
  if (error) console.log(`   ${hesap} · İCRA TASLAĞI AÇILAMADI (${dosya}): ${error.message}`);
  else console.log(`   ${hesap} · icra defterine taslak açıldı: ${dosya}`);
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
    .select("firma_id, api_key, aktif, uets_adres, son_cekim, firmalar ( firma_adi, kisa_adi )")
    .eq("aktif", true);
  if (ayarHata) throw new Error(`firma_uets okunamadı: ${ayarHata.message}`);

  const firmalar = (ayarlar ?? []).filter((f) => f.api_key);
  if (firmalar.length === 0) {
    throw new Error(
      "UETS anahtarı tanımlı firma yok. Firma Düzenle > UETS E-Tebligat sekmesinden anahtarı girin.");
  }

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
      const { satirlar: gelenler, toplam: sunucuToplam, eksik } = TUMU
        ? await listeleTumu(f.api_key, hesap)
        : { ...(await listele(f.api_key)), eksik: null };
      const acik = gelenler.filter((m) => m.status === "delivered");
      const gecmis = gelenler.filter((m) => m.status === "readtimeout");
      // DEFTERE HEPSİ YAZILIR, BİLDİRİM YALNIZ İKİSİNE: önceden yalnız delivered +
      // readtimeout yazılıyordu, portalda açılmış (read) tebligatlar deftere hiç
      // girmiyordu — geçmişte ne geldiği panelden görülemiyordu. Artık gelen kutusunun
      // tamamı yazılıyor. Rozet ve ana ekran uyarısı bundan ETKİLENMEZ: ikisi de
      // durum = delivered/readtimeout sayar (bkz. hooks/use-okunmamis-tebligat).
      const tumu = gelenler;
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
      // SUNUCU TOPLAMI RAPORA YAZILIR: "0 kayıt" tek başına iki ayrı şeyi anlatıyor —
      // kutu gerçekten boş, ya da kayıt var ama bize gelmiyor. Toplam, aynı cevabın
      // x-total-count başlığından geliyor; ek istek yok, ek kota yok.
      const fazla = sunucuToplam > gelenler.length
        ? (TUMU
            ? ` · UYARI: sunucuda ${sunucuToplam} kayıt var, ${gelenler.length} tanesi alındı — DÖKÜM EKSİK`
            : ` · UYARI: sunucuda ${sunucuToplam} kayıt var, ilk ${gelenler.length} tanesi alındı`
              + ` (rutin çalışma sayfalamaz; tam döküm için: node scripts/uets-tebligat-cek.mjs --tumu)`)
        : "";
      raporlar.push(
        `${hesap}: ${acik.length} açılmamış · ${gecmis.length} süresi dolmuş`
        + ` · gelen kutusunda ${gelenler.length} kayıt (${durumOzet}) · sunucu toplamı ${sunucuToplam}${fazla}`);

      if (KURU) {
        for (const m of tumu) console.log(`  ${hesap} · ${gunTR(tarih(m.inserttime))} · ${m.status} · ${m.sender_name} · ${m.subject}`);
        continue;
      }
      // Firmanın UETS adresi henüz bilinmiyorsa ilk tebligattan öğren (alıcı = biziz).
      const ogrenilenAdres = f.uets_adres ? null : (tumu.find((m) => m.recipient)?.recipient ?? null);
      if (ogrenilenAdres) console.log(`   ${hesap} UETS adresi öğrenildi: ${ogrenilenAdres}`);

      // Hiç kayıt gelmediyse de "eksik" yazılır: dökümün yarım kaldığı bilgisi,
      // kayıt sayısından bağımsız olarak firmanın ayar ekranında durmalı.
      if (tumu.length === 0) {
        await durumYaz(f.firma_id, eksik);
        if (eksik) hatalar.push(`${hesap}: ${eksik}`);
        continue;
      }

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

      // BİLDİRİM SÜZGİCİ: yalnız açılmamış ya da süresi dolmuş olanlar haber değerinde.
      // Portalda zaten açılmış (read) bir tebligat için telefon ötürmek, hele ilk kurulumda
      // geçmişin tamamı için ötürmek, bildirimi değersizleştirir.
      const bildirilir = new Set(["delivered", "readtimeout"]);
      const adaylar = tumu.filter((m) => !bilinen.has(m.id) && bildirilir.has(m.status));
      // GÜNCEL Mİ? Eşik iki ölçüden GENİŞ olanı:
      //   a) son BILDIRIM_GUN gün,
      //   b) bu firmanın en son başarılı çekimi.
      // (b) olmasaydı sabit pencere tehlikeliydi: çekim 10 gün durursa (anahtar, kota,
      // makine kapalı) o arada gelen GERÇEK tebligat "eski" sayılıp sessizce geçerdi.
      // Çekim ne kadar uzun durmuşsa pencere o kadar geniş açılır. İlk kurulumda
      // son_cekim boştur → yalnız (a) geçerlidir, yani geçmiş sessizce yazılır.
      const simdiMs = Date.now();
      const sonCekimMs = f.son_cekim ? new Date(f.son_cekim).getTime() : null;
      const esikSaniye = Math.floor(
        Math.min(simdiMs - BILDIRIM_GUN * 86400000, sonCekimMs ?? Infinity) / 1000);
      const guncelMi = (m) => Number(m.inserttime ?? 0) >= esikSaniye;
      const haberlik = adaylar.filter(guncelMi);
      const eskiler = adaylar.filter((m) => !guncelMi(m));
      // SESSİZ GEÇİLMEZ: bildirim gitmediyse bu loga yazılır, kayıtlar panelde durur.
      if (eskiler.length) {
        const enYeni = eskiler.reduce((a, m) =>
          Number(m.inserttime ?? 0) > Number(a.inserttime ?? 0) ? m : a);
        console.log(`   ${hesap} · ${eskiler.length} ESKİ kayıt deftere girdi, bildirim gönderilmedi`
          + ` (en yenisi ${gunTR(tarih(enYeni.inserttime))}) — rozette ve e-tebligat ekranında görünür.`);
      }
      if (TUMU) {
        // Geçmişin tamamı için push atılmaz (yukarıdaki nota bak) — ama kaç tanesinin
        // bastırıldığı SÖYLENİR, kayıtlar panelde duruyor.
        if (haberlik.length) {
          console.log(`   ${hesap} · ${haberlik.length} açılmamış/süresi dolmuş kayıt deftere girdi,`
            + ` döküm kipinde telefon bildirimi gönderilmedi — panelden bakın.`);
        }
      } else {
        yeniler.push(...haberlik.map((m) => ({ hesap, m })));
      }

      // ═══ İCRA YAZISI GELİR GELMEZ İŞLENSİN (09.11.2026, kullanıcı kararı) ═══
      // Yeni gelen bir İCRA DAİRESİ yazısı için iki şey yapılıyor:
      //   1) icra defterine taslak satır açılıyor (yukarıdaki nota bak),
      //   2) belge indirme kuyruğuna otomatik alınıyor ki alacaklı/borçlu/tutar
      //      PDF'ten doldurulabilsin.
      //
      // DİKKAT — BU BİR POLİTİKA DEĞİŞİKLİĞİDİR: UETS'te indirmek tebligatı AÇMAK
      // demektir (taahhütname md. 7) ve geri alınamaz. Panel bugüne kadar hiçbir
      // tebligatı kendiliğinden açmıyordu; açma kararı bilerek insana bırakılmıştı.
      // Kullanıcı bu kararı makineye devretti. KAPSAM DAR TUTULDU: yalnız konusunda
      // "İcra Dairesi" geçen yazılar. Mahkeme ve hâkimlik tebligatları eskisi gibi
      // elle açılır — onların icra defterinde yeri yok, otomatik açmanın da kazancı yok.
      if (!KURU) {
        const yeniIcra = tumu.filter((m) => !bilinen.has(m.id) && icraYazisiMi(m));
        for (const m of yeniIcra) {
          await icraTaslagiAc(m, f.firma_id, hesap);
          // Zaten açılmış olanlarda da belge getirilir: tebligat read/readtimeout ise
          // indirmek yeni bir hukuki sonuç doğurmuyor, yalnız belgeyi getiriyor.
          const { data: satir } = await sb.from("tebligat")
            .select("id, paket_yolu, acilma_durumu").eq("hesap", hesap).eq("uets_id", m.id).maybeSingle();
          if (!satir || satir.paket_yolu || satir.acilma_durumu) continue;
          const { error: kuyrukHata } = await sb.from("tebligat").update({
            acilma_durumu: "bekliyor",
            acilma_istegi_at: new Date().toISOString(),
            // Kim istedi: insan değil, panel. Uydurma bir isim yazılmıyor.
            acilma_isteyen_id: null,
            acilma_isteyen_ad: "otomatik (icra yazısı)",
          }).eq("id", satir.id);
          if (kuyrukHata) console.log(`   ${hesap} · açma kuyruğuna alınamadı: ${kuyrukHata.message}`);
          else console.log(`   ${hesap} · belge indirme kuyruğuna alındı (otomatik): ${dosyaEsasNo(m) ?? m.id}`);
        }
      }
      await durumYaz(f.firma_id, eksik, ogrenilenAdres);
      // EKSİK DÖKÜM ARIZADIR: hatalar listesine girer, görev hatayla biter ve .bat
      // gorev-hata-bildir'i çağırır. Yoksa yarım döküm "tamam" görünür.
      if (eksik) hatalar.push(`${hesap}: ${eksik}`);
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
