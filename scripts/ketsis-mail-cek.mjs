// KETSİS / GİB E-TEBLİGAT BİLDİRİM MAİLİNİ OKU
//
// Vergi dairesi tebligatı UETS'te değil, GİB'in KETSİS'inde durur ve alıcı tarafı için
// API'si YOK (gerekçe: sql/ketsis_bildirim.sql başlığı). Tebligata ancak Dijital Vergi
// Dairesi ekranından bakılabiliyor. Elde kalan tek otomatik sinyal, GİB'in başvuruda
// bildirilen adrese yolladığı BİLGİLENDİRME MAİLİ — bu script onu yakalar.
//
// NE YAPAR: muhasebe posta kutularını tarar, vergi tebligatı bildirimine benzeyen
// mailleri ketsis_bildirim tablosuna yazar, yeni kayıt varsa telefonlara push atar.
// BELGEYİ İNDİRMEZ — indirilebilecek bir belge yok; mail "gel bak" der, o kadar.
//
// GÖNDEREN UYDURULMUYOR: GİB'in gönderen adresi resmî bir kaynakta yazılı değil. Tek
// adrese bel bağlayıp "eşleşmedi → yok" demek, kaçırmak istemediğimiz şeyi kaçırmak olur.
//   kesin : resmî alan (gib.gov.tr / gelirler.gov.tr / hmb.gov.tr) ya da panelde daha
//           önce ONAYLANMIŞ bir gönderen.
//   aday  : gönderen tanıdık değil ama konu/gövde vergi tebligatına benziyor → ekranda
//           "doğrula" diye görünür. Kullanıcı onaylarsa o gönderen artık kesin sayılır.
// Hiç ipucu yoksa satır açılmaz; her maili tebligat sanmak uyarıyı değersizleştirir.
//
// SESSİZLİK GÜVENCE DEĞİL: mail gelmemesi "tebligat yok" demek değil (bilgilendirme maili
// hukuken tebligatın parçası değil, süre VUK 107/A'ya göre işler). O yüzden paneldeki
// haftalık "Dijital Vergi Dairesi'ne bak" hatırlatması bu scriptten BAĞIMSIZ çalışır
// (ketsis_kontrol). Burada bir şey bulunmaması oradaki hatırlatmayı susturmaz.
//
// NEREDE ÇALIŞIR: ofisteki makinede, Görev Zamanlayıcı ile. Vercel paylaşımlı hosting'in
// IMAP'ına bağlanamıyor (aynı sorun Arvento ve sigorta mail senkronunda da var).
//
// Çalıştırma:
//   node scripts/ketsis-mail-cek.mjs             → son duruma göre yeni mailler
//   node scripts/ketsis-mail-cek.mjs --gun 90    → son 90 günü yeniden tara
//   node scripts/ketsis-mail-cek.mjs --deneme    → hiçbir şey yazma, ne bulduğunu göster
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";
import { pushGonder } from "./push-gonder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kok = path.join(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(kok, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const arg = process.argv.slice(2);
const DENEME = arg.includes("--deneme");
const GUN = (() => { const i = arg.indexOf("--gun"); if (i < 0) return null; const v = Number(arg[i + 1]); return Number.isFinite(v) ? v : 30; })();
// --tumu: silinmis/cop klasorlerini de tara. Gecmisi bir kez taramak icin; rutin turda
// kullanilmaz, cunku yillar once silinmis bir bildirim bugun "yeni" diye alarm vermemeli.
const TUMU = arg.includes("--tumu");
// --gun 0  → tarih siniri koyma, klasorun TAMAMINI tara. Gecmisi bir kez taramak icin:
// ikikat kutusunun INBOX_OLD klasoru 2017'den kalma ve gun penceresiyle hic gorunmuyordu.
const TUM_TARIH = GUN === 0;

// Taranacak klasorler. Sunucular farkli adlar kullaniyor; olmayan sessizce atlanir.
// Junk/Spam LISTEDE: spam'e dusmus bir tebligat bildirimi hic gorulmemis olabilir —
// kacirilmasindan en cok korktugumuz hal tam olarak budur.
const KLASORLER = [
  "INBOX", "INBOX_OLD",
  "Junk", "Junk E-mail", "Spam", "Önemsiz Elektronik Posta",
  ...(TUMU ? ["Deleted Items", "Deleted Messages", "Trash", "Çöp Kutusu"] : []),
];

const log = (...a) => console.log(new Date().toLocaleTimeString("tr-TR"), ...a);

// ───────────────────────── eşleştirme kuralları ─────────────────────────

// Resmî alanlar. Env ile eklenebilir (KETSIS_MAIL_ALAN=alan1.gov.tr,alan2.gov.tr) ki
// GİB gönderen adresini değiştirirse kod değişmeden tanınsın.
//
// DOĞRULANMIŞ (06.11.2026, muhasebe kutularındaki gerçek mailler):
//   ketsis-noreply@gelirler.gov.tr → "KETSİS Tebliğ Bilgilendirme İletisi - BELGE NO[MC…]"
//   internetvd@gelirler.gov.tr     → "Borç Durum Yazısı"  ← TEBLİGAT DEĞİL, aşağıda elenir
const RESMI_ALANLAR = [
  "gib.gov.tr", "gelirler.gov.tr", "hmb.gov.tr", "maliye.gov.tr",
  ...String(env.KETSIS_MAIL_ALAN ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
];

// PTT UETS'in kendi bildirim maili ("Yeni Elektronik Tebligat", uets@bilgi.ptt.gov.tr)
// BURAYA GİRMEZ: o tebligatlar UETS tablosunda, API'den çekiliyor (sql/tebligat.sql).
// İki yerde görünmesi "iki tebligat var" diye okunur.
const UETS_ALANLAR = ["ptt.gov.tr", "etebligat.gov.tr"];
const uetsMi = (adres) => {
  const a = alanAdi(adres);
  return UETS_ALANLAR.some((r) => a === r || a.endsWith("." + r));
};

const alanAdi = (adres) => String(adres ?? "").toLowerCase().split("@")[1] ?? "";
const resmiMi = (adres) => {
  const a = alanAdi(adres);
  return RESMI_ALANLAR.some((r) => a === r || a.endsWith("." + r));
};
const kamuMu = (adres) => /(^|\.)gov\.tr$/.test(alanAdi(adres));

// Türkçe harf duyarsız arama için sadeleştir (konu "TEBLİGAT" / "tebliğ" gelebiliyor).
const sadele = (s) => String(s ?? "")
  .replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g")
  .replace(/[Üü]/g, "u").replace(/[Öö]/g, "o").replace(/[Çç]/g, "c")
  .toLowerCase();

// sadele() Türkçe harfleri indirdiği için desenler sade yazılır: "tebliğ" → "teblig".
const TEBLIGAT_IZI = /teblig|ketsis|ihbarname|odeme emri/;
const VERGI_IZI = /vergi|gib|ketsis|gelir idaresi|ihbarname|odeme emri|defterdarlik|dijital vergi/;

/**
 * Mail vergi tebligatı bildirimi mi? Döndürür: "kesin" | "aday" | null
 *
 * @param adres  gönderen e-posta
 * @param metin  konu + gövde (sadeleşmiş)
 * @param ogrenilmis panelde onaylanmış gönderen adresleri
 */
function siniflandir(adres, metin, ogrenilmis) {
  const a = String(adres ?? "").toLowerCase();
  // PTT UETS bildirimi → UETS tablosunun işi, burada yer almaz.
  if (uetsMi(a)) return null;
  // RESMÎ GÖNDEREN TEK BAŞINA YETMEZ. Vergi dairesi aynı adresten tebligatla ilgisi
  // olmayan rutin mailler de yolluyor: internetvd@gelirler.gov.tr "Borç Durum Yazısı"
  // (doğrulandı, 06.11.2026 — kutuda üç tane vardı). Hepsini tebligat saymak uyarıyı
  // değersizleştirir; "tebligat var" uyarısı tebligat olduğunda çıkmalı.
  if (resmiMi(a) || ogrenilmis.has(a)) return TEBLIGAT_IZI.test(metin) ? "kesin" : null;
  // Kamu alanından geliyorsa tebligat kelimesi tek başına yeter — vergi dairesi
  // maillerinde "vergi" kelimesi geçmeyebiliyor.
  if (kamuMu(a) && TEBLIGAT_IZI.test(metin)) return "aday";
  // Dışarıdan geliyorsa iki iz birlikte aranır: tek "tebligat" kelimesiyle avukat
  // maili, haber bülteni, reklam da içeri girerdi.
  if (TEBLIGAT_IZI.test(metin) && VERGI_IZI.test(metin)) return "aday";
  return null;
}

/**
 * BELGE NO — GİB mailinin konusunda geçiyor: "… İletisi - BELGE NO[MC09994486]".
 * Dijital Vergi Dairesi'nde tebligatlar bu numarayla listelendiği için ekrana yazılır:
 * kullanıcı hangi satıra bakacağını bilsin.
 */
function belgeNoBul(metin) {
  const s = String(metin);
  // Yeni biçim (2026): "KETSİS Tebliğ Bilgilendirme İletisi - BELGE NO[MC09994486]"
  const belge = s.match(/BELGE\s*NO\s*[[(]?\s*([A-Z0-9-]{4,30})/i);
  if (belge) return belge[1];
  // Eski biçim (2017, eteblig-noreply@gelirler.gov.tr): "... - ZARF ID[0rj27mq3hw15d0]"
  const zarf = s.match(/ZARF\s*ID\s*[[(]?\s*([A-Za-z0-9-]{6,40})/i);
  return zarf ? zarf[1] : null;
}

/**
 * VKN — mailin ilk cümlesinde geçiyor: "48*****760 vergi kimlik numaralı sayın …".
 * GİB numarayı MASKELİ yolluyor (doğrulandı, 06.11.2026), yani firma eşleştirmesi
 * buradan YAPILAMAZ; yalnız ekranda gösterilir. Firma, kutunun sahibinden bulunur.
 *
 * Rastgele 10 haneli sayı aramıyoruz: gövdede tarih, tutar, dosya numarası da var;
 * yanlış VKN göstermek firmayı yanlış göstermekten beter olur. Yalnız "vergi kimlik"
 * ifadesinin hemen önündeki numara alınır.
 */
function vknBul(metin) {
  const s = String(metin);
  // Yeni biçim: "48*****760 vergi kimlik numaralı sayın …" (maskeli)
  // Eski biçim: "\"6130900818\" vergi kimlik numaralı …" / "6130900818 vkn numaralı …" (maskesiz)
  const m = s.match(/([\d*]{10,11})["'\s]{0,3}(?:vergi\s*kimlik|vkn)/i);
  return m ? m[1] : null;
}
/**
 * MASKELİ VKN'den FİRMA BUL. GİB numarayı "47*****586" diye yolluyor: ilk 2 ile son 3
 * hane açık, uzunluk da belli. Altı firmalı bir kayıtta bu birebir eşleşmedir
 * (çakışma 100.000'de bir) — ve eşleştirmenin TEK güvenilir yolu budur.
 *
 * NİYE KUTUYA GÜVENİLMİYOR: muhasebe@ikikat.com.tr kutusunu ÜÇ firma paylaşıyor
 * (IYI, IKI, KTI). Kutudan firmaya gitmek tahmin olur; 06.11.2026'da ilk denemede
 * tam bu oldu — İkikat İnşaat'ın (47*****586) tebligatı KTI'ye, KADTEM'in
 * (48*****760) tebligatı KAT'a yazıldı. Yanlış firma, yanlış alarm demek.
 *
 * İki firma birden uyuyorsa TAHMİN EDİLMEZ: null döner, ekranda "firma belirsiz"
 * görünür. Yanlış firma göstermek, belirsiz göstermekten kötüdür.
 */
function firmaEslesVkn(vkn, firmalar) {
  if (!vkn) return null;
  const bas = vkn.slice(0, 2), son = vkn.slice(-3);
  if (!/^\d{2}$/.test(bas) || !/^\d{3}$/.test(son)) return null;
  const uyan = firmalar.filter((f) => {
    const v = String(f.vergi_no ?? "").replace(/\D/g, "");
    return v.length === vkn.length && v.startsWith(bas) && v.endsWith(son);
  });
  return uyan.length === 1 ? uyan[0] : null;
}

// ───────────────────────────── ana akış ─────────────────────────────

async function main() {
  // Posta kutuları: firmaların SMTP kimlikleri (muhasebe@ikikat / muhasebe@kadtem).
  // Aynı kutuyu iki firma paylaşıyorsa bir kez taranır; firma eşleşmesi aşağıda
  // VKN'ye, bulunamazsa kutunun sahibi firmaya düşer.
  const { data: firmaRows, error: firmaHata } = await sb
    .from("firmalar").select("id, firma_adi, kisa_adi, vergi_no, smtp_user, smtp_password")
    .not("smtp_user", "is", null);
  if (firmaHata) throw new Error("Firmalar okunamadı: " + firmaHata.message);

  const firmalar = firmaRows ?? [];
  // Kutu → o kutuyu kullanan BÜTÜN firmalar. Tek firma varsa yedek eşleştirmede
  // kullanılır; birden fazlaysa (muhasebe@ikikat.com.tr'yi üç firma paylaşıyor)
  // kutudan firmaya gidilmez — tahmin yapmıyoruz.
  const kutular = new Map();   // user → { pass, firmaIdler: [] }
  for (const f of firmalar) {
    if (!f.smtp_user || !f.smtp_password) continue;
    const u = f.smtp_user.trim();
    if (!kutular.has(u)) kutular.set(u, { pass: f.smtp_password, firmaIdler: [] });
    kutular.get(u).firmaIdler.push(f.id);
  }
  if (kutular.size === 0) {
    // SESSİZ GEÇİLMEZ: kutu yoksa bu script hiçbir şey yapamaz, ama "temiz" de demez.
    throw new Error("Taranacak posta kutusu yok (firmalar.smtp_user boş). KETSİS bildirimleri izlenmiyor.");
  }

  // ÖĞRENİLMİŞ GÖNDERENLER: panelde "bu gerçekten vergi tebligatıydı" diye onaylanmış
  // (durum = kontrol_edildi) maillerin göndereni artık kesin sayılır.
  const { data: onayli } = await sb.from("ketsis_bildirim")
    .select("gonderen_adres").eq("durum", "kontrol_edildi").not("gonderen_adres", "is", null);
  const ogrenilmis = new Set((onayli ?? []).map((r) => String(r.gonderen_adres).toLowerCase()));
  if (ogrenilmis.size) log(`öğrenilmiş gönderen: ${[...ogrenilmis].join(", ")}`);

  const { data: durumlar } = await sb.from("ketsis_imap_durum").select("*");
  const durumMap = new Map((durumlar ?? []).map((d) => [d.kutu, d]));

  const yeniKayitlar = [];   // push için
  const hatalar = [];        // bu turdaki bütün hatalar (ekranda görünür)
  // KALICI hatalar — yalnız bunlar görev çöktü bildirimi doğurur. Gerekçe:
  // bu makinede iki mail görevi 2 DAKİKADA BİR dönüyor (sigorta tek, bildirge çift
  // dakikalarda) ve aynı posta kutusuna ikinci bir oturum açılınca sunucu bağlantıyı
  // düşürüyor (ECONNRESET). Tek seferlik kopmaya "görev çöktü" demek, bildirimi
  // değersizleştirir — ikinci turda da aynı kutu patlıyorsa gerçek arızadır.
  const kaliciHatalar = [];

  for (const [user, { pass, firmaIdler }] of kutular) {
    // Kutuyu tek firma kullanıyorsa VKN bulunamadığında yedek olur; paylaşımlıysa yedek yok.
    const tekFirmaId = firmaIdler.length === 1 ? firmaIdler[0] : null;
    const onceki = durumMap.get(user)?.son_tarih;
    const since = GUN ? new Date(Date.now() - GUN * 86400000)
      : onceki ? new Date(Date.parse(onceki) - 86400000)       // 1 gün geri: sınırdakiler kaçmasın
      : new Date(Date.now() - 30 * 86400000);
    let enSonTarih = onceki ? new Date(onceki) : since;
    let bulunan = 0, yazilan = 0;

    const durumYaz = async (hata = null) => {
      if (DENEME) return;
      await sb.from("ketsis_imap_durum").upsert({
        kutu: user,
        son_tarih: enSonTarih.toISOString(),
        son_calisma: new Date().toISOString(),
        son_sonuc: `${bulunan} aday mail, ${yazilan} yeni kayıt`,
        son_hata: hata,
      }, { onConflict: "kutu" });
    };

    const c = new ImapFlow({
      host: (env.KETSIS_IMAP_HOST || `mail.${user.split("@")[1]}`),
      port: Number(env.KETSIS_IMAP_PORT || 993),
      secure: Number(env.KETSIS_IMAP_PORT || 993) === 993,
      auth: { user, pass }, logger: false,
      // Paylaşımlı hosting sertifikası alan adıyla eşleşmeyebiliyor (bildirge okuyucuda
      // da aynı gevşetme var).
      tls: { rejectUnauthorized: false },
    });
    // ImapFlow bağlantı hatalarını OLAY olarak yayıyor; dinlenmezse süreç çöküyor.
    c.on("error", (e) => log(`${user}: bağlantı hatası — ${e.message}`));

    try {
      // Bağlanmayı bir kez daha dene: çakışma anlıktır, 20 saniye sonra kutu boşalıyor.
      try {
        await c.connect();
      } catch (e) {
        log(`${user}: bağlanamadı (${e.message}) — 20 saniye sonra tekrar`);
        await new Promise((r) => setTimeout(r, 20000));
        await c.connect();
      }
      // KLASÖR KLASÖR TARA. Yalnız INBOX yetmiyor:
      //   · Junk        → spam'e düşmüş bir tebligat bildirimi tam da kaçırılan şeydir.
      //   · INBOX_OLD   → eski mailler buraya taşınmış (ikikat kutusunda 66 mail).
      //   · Silinenler  → yalnız --tumu ile. Birinin silmiş olması tebligatın gelmediği
      //                   anlamına gelmez; ama rutin turda eski silinmişleri her seferinde
      //                   "yeni" diye göstermek de doğru değil, o yüzden isteğe bağlı.
      // Olmayan klasör sessizce atlanır (sunucular farklı adlar kullanıyor).
      const mevcutKlasorler = new Set((await c.list()).map((b) => b.path));
      const taranacak = KLASORLER.filter((k) => mevcutKlasorler.has(k));
      log(`${user}: taranacak klasörler → ${taranacak.join(", ")}`);

      const klasoruTara = async (klasor) => {
        await c.mailboxOpen(klasor, { readOnly: true });
        const uidler = await c.search(TUM_TARIH ? { all: true } : { since }, { uid: true });
        if (!uidler?.length) { log(`${user}/${klasor}: mesaj yok`); return; }

        // İNDİRMEDEN ÖNCE ELEME: önce zarf (gönderen + konu) çekilir, gövde yalnız
        // ihtimali olan mailler için indirilir. Kutuda günde yüzlerce mail var.
        const adaylar = [];
        for await (const m of c.fetch(uidler.join(","), { uid: true, envelope: true }, { uid: true })) {
          const adres = (m.envelope?.from?.[0]?.address ?? "").toLowerCase();
          const konu = m.envelope?.subject ?? "";
          // Gövdeyi indirmeye değer mi: resmî/öğrenilmiş gönderen, kamu alanı ya da
          // konuda tebligat izi. (Gövdedeki iz ancak indirince görülür; bu üç kapı
          // "indirilecek mail" seçimidir, sınıflandırma aşağıda gövdeyle yapılır.)
          if (uetsMi(adres)) continue;   // PTT UETS bildirimi → UETS tablosunun işi
          if (resmiMi(adres) || ogrenilmis.has(adres) || kamuMu(adres) || TEBLIGAT_IZI.test(sadele(konu))) {
            adaylar.push(m.uid);
          }
        }
        log(`${user}/${klasor}: ${uidler.length} mesaj · ${adaylar.length} incelenecek`);
        if (!adaylar.length) return;

        // Hepsi önce indirilir, işleme sonra: arada bekleyince sunucu bağlantıyı
        // düşürüyor (sigorta okuyucusunda ECONNRESET yaşandı).
        const mesajlar = [];
        for await (const m of c.fetch(adaylar.join(","), { uid: true, source: true }, { uid: true })) {
          mesajlar.push({ uid: m.uid, source: m.source });
        }

        for (const m of mesajlar) {
          let p;
          try { p = await simpleParser(m.source); } catch (e) { log(`  uid ${m.uid}: ayrıştırılamadı — ${e.message}`); continue; }
          if (p.date && p.date > enSonTarih) enSonTarih = p.date;

          const adres = (p.from?.value?.[0]?.address ?? "").toLowerCase();
          const konu = p.subject ?? "";
          const govde = (p.text ?? "").replace(/\s+/g, " ").trim();
        // ESKİ MAİLLERDE KODLAMA BOZUK: 2017 tarihli GİB iletilerinde gövde "ï¿½" dolu
        // geliyor (gönderen charset'i yanlış bildirmiş, özgün baytlar mailde de kayıp —
        // kurtarılamıyor). Metin yine saklanır ama ÖNÜNE not düşülür; yoksa ekranda
        // "panel bozmuş" diye okunur. Sınıflandırma zaten konudan yapılıyor, konu temiz.
        const bozukSayisi = (govde.match(/�/g) ?? []).length;
        const kodlamaBozuk = govde.length > 0 && bozukSayisi > govde.length / 20;
          const guven = siniflandir(adres, sadele(`${konu} ${govde}`), ogrenilmis);
          if (!guven) continue;
          bulunan++;

          const vkn = vknBul(`${konu} ${govde}`);
          // FİRMA: maskeli de olsa VKN'den. Bulunamazsa, kutuyu tek firma kullanıyorsa ondan.
          // İkisi de yoksa BOŞ kalır ve ekranda "firma belirsiz" görünür — yanlış firma
          // yazmaktansa soru işareti.
          const vknFirma = firmaEslesVkn(vkn, firmalar);

          const kayit = {
            kutu: user,
            klasor,
            tekil: p.messageId ? String(p.messageId).slice(0, 400) : `uid:${m.uid}`,
            mail_uid: m.uid,
            mail_tarihi: (p.date ?? new Date()).toISOString(),
            gonderen: p.from?.value?.[0]?.name || adres || null,
            gonderen_adres: adres || null,
            konu: konu.slice(0, 500) || null,
            ozet: (kodlamaBozuk ? "[eski mail: kodlaması bozuk, özgün metin kurtarılamıyor] " : "") + govde.slice(0, 600) || null,
            firma_id: vknFirma?.id ?? tekFirmaId ?? null,
            vkn: vkn,
            belge_no: belgeNoBul(`${konu} ${govde}`),
            guven,
          };

          if (DENEME) {
            log(`  [deneme] ${guven.toUpperCase()} · ${adres} · ${konu.slice(0, 70)}`);
            log(`           belge no: ${kayit.belge_no ?? "—"} · vkn ${vkn ?? "—"} → firma: ${vknFirma?.kisa_adi ?? vknFirma?.firma_adi ?? (tekFirmaId ? "(kutunun tek firmasi)" : "BELIRSIZ")}`);
            log(`           özet: ${govde.slice(0, 200)}`);
            continue;
          }

          // AYNI TEBLİGAT, İKİ MAİL: GİB aynı belge için ikinci bir bilgilendirme iletisi
          // yolluyor (doğrulandı 06.11.2026 — MC09179846 ve MC09462508 kutuda ikişer kez).
          // Message-ID farklı olduğu için (kutu, tekil) indeksi bunu yakalamaz; belge
          // numarası yakalar. İkinci satır açmak "iki tebligat var" demek olur.
          if (kayit.belge_no) {
            const { data: mevcut, error: mevcutHata } = await sb.from("ketsis_bildirim")
              .select("id").eq("belge_no", kayit.belge_no).limit(1);
            if (mevcutHata) {
              kaliciHatalar.push(`${user}/${klasor} / belge ${kayit.belge_no}: ${mevcutHata.message}`);
              continue;
            }
            if ((mevcut ?? []).length) { log(`  = zaten var (belge ${kayit.belge_no})`); continue; }
          }

          // Tekilleştirme veritabanında (kutu, tekil) tekil indeksiyle. Çakışmada
          // DOKUNULMAZ: kullanıcı o satırı "kontrol edildi" yapmış olabilir, ezmeyelim.
          const { error, data } = await sb.from("ketsis_bildirim")
            .upsert(kayit, { onConflict: "kutu,tekil", ignoreDuplicates: true })
            .select("id");
          if (error) {
            // Hata YUTULMAZ: yazılamayan bildirim, görülmeyen tebligat demek.
            kaliciHatalar.push(`${user}/${klasor} / uid ${m.uid}: ${error.message}`);
            log(`  YAZILAMADI uid ${m.uid}: ${error.message}`);
            continue;
          }
          if ((data ?? []).length > 0) {
            yazilan++;
            yeniKayitlar.push({ ...kayit, id: data[0].id });
            log(`  + ${guven} · ${adres} · ${konu.slice(0, 70)}`);
          }
        }
      };

      for (const klasor of taranacak) {
        // Bir klasörün hatası diğerini engellemesin; hepsi kutunun hata listesine düşer.
        try { await klasoruTara(klasor); }
        catch (e) {
          log(`${user}/${klasor}: HATA — ${e.message}`);
          hatalar.push(`${user}/${klasor}: ${e.message}`);
        }
      }
      try { await c.logout(); } catch { /* işimiz bitti */ }

      // Kutunun durum satırına bu turda görülen hatalar yazılır (ekranda kırmızı
      // satır olarak görünür). Hata yoksa alan temizlenir — eski hata ekranda kalmasın.
      const kutuHatalari = [...hatalar, ...kaliciHatalar].filter((h) => h.startsWith(user));
      await durumYaz(kutuHatalari.length ? kutuHatalari.join(" | ").slice(0, 500) : null);
    } catch (e) {
      log(`${user}: HATA — ${e.message}`);
      hatalar.push(`${user}: ${e.message}`);
      // İKİNCİ KEZ Mİ? Önceki turda da bu kutu hata vermişse geçici kopma değil, arıza.
      if (durumMap.get(user)?.son_hata) {
        kaliciHatalar.push(`${user}: ${e.message} (üst üste ikinci tur)`);
        log(`${user}: bu kutu önceki turda da patlamış → kalıcı arıza sayılıyor`);
      }
      try { await durumYaz(e.message.slice(0, 500)); } catch { /* durum yazılamadıysa aşağıda fırlatılıyor */ }
    }
  }

  // ───────────────── push: yeni bildirim varsa telefona ─────────────────
  if (yeniKayitlar.length && !DENEME) {
    const kesin = yeniKayitlar.filter((k) => k.guven === "kesin").length;
    const aday = yeniKayitlar.length - kesin;
    const baslik = kesin
      ? "⚖️ Vergi dairesi tebligatı"
      : "⚖️ Vergi tebligatı olabilir";
    const parcalar = [];
    if (kesin) parcalar.push(`${kesin} tebligat bildirimi geldi`);
    if (aday) parcalar.push(`${aday} şüpheli mail doğrulanmalı`);
    const govde = `${parcalar.join(", ")}. Belge yalnız Dijital Vergi Dairesi'nde görülür — süre VUK 107/A'ya göre işliyor.`;
    try {
      const n = await pushGonder(sb, env, {
        baslik, govde,
        url: "/dashboard/yazismalar/e-tebligat",
        etiket: "ketsis-bildirim",
        kategori: "e-tebligat",
      });
      log(`push: ${n} cihaza gönderildi`);
    } catch (e) {
      // Push gidemezse de kayıt duruyor ve ekranda görünüyor; yine de sessiz geçilmez.
      log(`push gönderilemedi: ${e.message}`);
      kaliciHatalar.push(`push: ${e.message}`);
    }
  }

  log(`bitti · ${yeniKayitlar.length} yeni kayıt`);
  // GÖREV ÇÖKTÜ BİLDİRİMİ yalnız KALICI hatalarda: veritabanına yazılamaması, push'un
  // gitmemesi ya da aynı kutunun üst üste ikinci turda patlaması. Tek seferlik IMAP
  // kopması (iki dakikalık mail görevleriyle çakışma) bildirim doğurmaz — ama kaybolmaz
  // da: ekrandaki "son taramada hata" satırında ve bu kayıtta görünür.
  if (hatalar.length && !kaliciHatalar.length) {
    log(`UYARI (geçici sayıldı): ${hatalar.join(" | ")}`);
  }
  if (kaliciHatalar.length) {
    throw new Error(`KETSİS mail taramasında ${kaliciHatalar.length} kalıcı hata: ${kaliciHatalar.join(" | ")}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
