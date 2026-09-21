// GELEN SİGORTA TEKLİFLERİNİ MAİLDEN OKU
//
// Teklif istediğimiz acenteler cevabı maille gönderiyor. Üç biçim geliyor:
//   • PDF ek       → sigorta şirketinin poliçe teklifi; rakam metinden birebir okunur.
//   • mail gövdesi → "en uygun Doğa sigortadan 11.895 tl" gibi cümleler.
//   • resim ek     → acentenin karşılaştırma tablosunun ekran görüntüsü. Makine okuyamaz;
//                    ek saklanır, kayıt "elle bakılmalı" diye işaretlenir.
//
// Okunanlar sigorta_teklif tablosuna yazılır → ana sayfadaki "Teklif Karşılaştır" ekranında
// elle girilenlerle yan yana görünür, en ucuz zaten orada vurgulanıyor.
//
// NEREDE ÇALIŞIR: Vercel paylaşımlı hosting'in IMAP'ına bağlanamıyor (Arvento mail senkronunda
// da aynı sorun var) → bu script ŞİRKET MAKİNESİNDE zamanlanmış görevle çalışır.
//
// Çalıştırma:
//   node scripts/sigorta-teklif-mail.mjs            → son duruma göre yeni mailler
//   node scripts/sigorta-teklif-mail.mjs --gun 90   → son 90 günü yeniden tara
//   node scripts/sigorta-teklif-mail.mjs --deneme   → hiçbir şey yazma, ne bulduğunu göster
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
const GUN = (() => { const i = arg.indexOf("--gun"); return i >= 0 ? Number(arg[i + 1]) || 30 : null; })();

const log = (...a) => console.log(new Date().toLocaleTimeString("tr-TR"), ...a);

// ───────────────────────── yardımcılar ─────────────────────────

const plakaNorm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Para ayrıştırma. İki biçim de geliyor:
 *   "12,522.00 TL"  → PDF (İngiliz biçimi)
 *   "11.895,00 TL"  → mail gövdesi (Türk biçimi)
 * Kural: iki ayraç da varsa SONUNCUSU ondalıktır; tek ayraç varsa ve sağında tam 3 hane
 * varsa binliktir, değilse ondalıktır.
 */
function paraCoz(ham) {
  let s = String(ham).replace(/[^\d.,]/g, "");
  if (!s) return NaN;
  const sonNokta = s.lastIndexOf("."), sonVirgul = s.lastIndexOf(",");
  if (sonNokta >= 0 && sonVirgul >= 0) {
    const ondalik = sonNokta > sonVirgul ? "." : ",";
    const binlik = ondalik === "." ? "," : ".";
    s = s.split(binlik).join("").replace(ondalik, ".");
  } else if (sonNokta >= 0 || sonVirgul >= 0) {
    const ayrac = sonNokta >= 0 ? "." : ",";
    const sag = s.length - s.lastIndexOf(ayrac) - 1;
    s = sag === 3 ? s.split(ayrac).join("") : s.replace(ayrac, ".");
  }
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

/** Metinde geçen ilk tanımlı plakayı bul (yazım farklarına dayanıklı). */
function plakaBul(metin, plakalar) {
  const n = plakaNorm(metin);
  let enIyi = null;
  for (const p of plakalar) {
    if (p.norm.length >= 6 && n.includes(p.norm)) {
      if (!enIyi || p.norm.length > enIyi.norm.length) enIyi = p;
    }
  }
  return enIyi;
}

/** Kasko mu trafik mi? Konu ve gövdeye bakar; ipucu yoksa trafik sayılır (talep çoğunlukla o). */
function tipBul(metin) {
  return /kasko/i.test(metin) ? "kasko" : "trafik";
}

/**
 * Metinde geçen tanımlı sigorta firmasını bul.
 *
 * KELİME SINIRI ŞART: ilk sürüm düz "içeriyor mu" bakıyordu ve Sompo poliçesindeki
 * "işletilmesinden DOĞAN zararları" ifadesini "Doğa Sigorta" sanıyordu. Artık eşleşme
 * ancak kelime başı/sonu tamsa sayılıyor.
 *
 * Her firma için birden çok anahtar denenir: tam ad, "sigorta"sız hâli ve ayırt edici
 * ilk kelime ("Sompo Japan Sigorta" → "sompo"; poliçede yalnız "SOMPO SİGORTA" yazıyor).
 * En UZUN eşleşme kazanır — "Türkiye Sigorta" ile "Türkiye Katılım Sigorta" karışmasın.
 */
function firmaAnahtarlari(f) {
  const tam = f.toLocaleLowerCase("tr").trim();
  const sigortasiz = tam.replace(/\s*sigorta(sı)?\s*$/u, "").trim();
  const ilk = sigortasiz.split(/\s+/)[0] ?? "";
  const set = new Set([tam, sigortasiz]);
  if (ilk.length >= 4) set.add(ilk);
  return [...set].filter((k) => k.length >= 3);
}
const HARF = "a-z0-9çğıöşü";
function kelimeVarMi(alt, anahtar) {
  const kacir = anahtar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^${HARF}])${kacir}([^${HARF}]|$)`, "i").test(alt);
}
function firmaBul(metin, firmalar) {
  const alt = metin.toLocaleLowerCase("tr");
  let enIyi = null;
  for (const f of firmalar) {
    for (const anahtar of firmaAnahtarlari(f)) {
      if (!kelimeVarMi(alt, anahtar)) continue;
      if (!enIyi || anahtar.length > enIyi.uzunluk) enIyi = { ad: f, uzunluk: anahtar.length };
    }
  }
  return enIyi?.ad ?? null;
}

/** PDF'ten düz metin (satır düzeni korunarak). */
async function pdfMetin(buf) {
  const pdf = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  let cikti = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const t = await (await pdf.getPage(i)).getTextContent();
    const satirlar = new Map();
    for (const it of t.items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!satirlar.has(y)) satirlar.set(y, []);
      satirlar.get(y).push({ x: it.transform[4], s: it.str });
    }
    for (const [, p] of [...satirlar.entries()].sort((a, b) => b[0] - a[0])) {
      cikti += p.sort((a, b) => a.x - b.x).map((q) => q.s).join(" ").replace(/\s+/g, " ").trim() + "\n";
    }
  }
  return cikti;
}

/**
 * PDF teklifinden tutar: "Toplam Brüt Prim" ödenecek rakamdır (net prim + vergiler).
 * Bulunamazsa sırayla diğer toplam alanlarına düşülür.
 */
function pdfTutar(metin) {
  const desenler = [
    /Toplam\s*Brüt\s*Prim\s*:?\s*([\d.,]+)/i,
    /Brüt\s*Prim\s*:?\s*([\d.,]+)/i,
    /Ödenecek\s*Tutar\s*:?\s*([\d.,]+)/i,
    /Toplam\s*Prim\s*:?\s*([\d.,]+)/i,
  ];
  for (const d of desenler) {
    const m = metin.match(d);
    if (m) { const v = paraCoz(m[1]); if (v > 0) return v; }
  }
  return NaN;
}

/**
 * Ek gerçekten TEKLİF RESMİ mi, yoksa mail imzasındaki logo mu?
 *
 * Anadolu Sigorta'nın mailinde 8 adet resim eki var: şirket logosu, sosyal medya ikonları,
 * kampanya afişi... Bunları "teklif resmi" sayınca her imzalı mail elle-girilecek listesine
 * düşüyordu. Ayırt edici iki işaret: BOYUT (teklif tabloları 500 KB+, logolar 1-40 KB) ve
 * DOSYA ADI (logo/icon/banner gibi kelimeler).
 */
const IMZA_ADI = /logo|icon|banner|signature|imza|gptw|footer|sosyal/i;
function teklifResmiMi(ek) {
  if (!/^image\//i.test(ek.contentType ?? "")) return false;
  if (IMZA_ADI.test(ek.filename ?? "")) return false;
  return (ek.size ?? 0) >= 80 * 1024;
}

/**
 * Gönderenin alan adından sigorta firmasını çıkar: egur@anadolusigorta.com.tr → Anadolu Sigorta.
 *
 * Burada kelime sınırı ARANMAZ — alan adları bitişik yazılır ("anadolusigorta"), sınır şartı
 * aramayı engelliyordu. Alan adı zaten çok ayırt edici olduğu için gevşek eşleşme güvenli.
 * İmza metni için sınırlı arama sürer (orada normal cümleler var, yanlış eşleşme riski gerçek).
 */
function gonderendenFirma(gonderen, govde, firmalar) {
  const alan = (gonderen.split("@")[1] ?? "").toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]/g, "");
  let enIyi = null;
  for (const f of firmalar) {
    for (const anahtar of firmaAnahtarlari(f)) {
      const bitisik = anahtar.replace(/\s+/g, "");
      if (bitisik.length >= 5 && alan.includes(bitisik) && (!enIyi || bitisik.length > enIyi.uzunluk)) {
        enIyi = { ad: f, uzunluk: bitisik.length };
      }
    }
  }
  return enIyi?.ad ?? firmaBul((govde ?? "").slice(-600), firmalar);
}

/**
 * Mail gövdesinden tutarlar: "Doğa sigortadan 11.895 tl" / "Neova şirketinden 10.330 tl".
 * Firma adı ile tutarın aynı cümlede olmasını arar; birden fazla varsa hepsini döndürür.
 */
function govdedenTeklifler(metin, firmalar) {
  const sonuc = [];
  // Alıntılanan eski mailleri ("Gönderen:" sonrası) kesip yalnız acentenin yazdığına bak.
  const kesik = (metin.split(/_{5,}|Gönderen:|From:|-----Original/i)[0] ?? metin).replace(/\s+/g, " ");
  // NOKTADAN BÖLME YOK: "11.895" sayısı ikiye ayrılıyordu. Tutarları tarayıp her birinin
  // ÖNCESİNDEKİ pencerede firma adı arıyoruz ("En uygun Doğa sigortadan 11.895 tl").
  const re = /([\d][\d.,]{2,})\s*(?:tl|try|₺)\b/gi;
  let m;
  while ((m = re.exec(kesik)) !== null) {
    const tutar = paraCoz(m[1]);
    if (!(tutar > 0)) continue;
    const oncesi = kesik.slice(Math.max(0, m.index - 90), m.index);
    const firma = firmaBul(oncesi, firmalar);
    const kanit = kesik.slice(Math.max(0, m.index - 90), m.index + m[0].length).trim().slice(-160);
    // Firma adı cümlede geçmiyor olabilir ("Merhaba, 17.230 TL kredi kartına 7 taksit") —
    // acentenin kendi şirketini yazmasına gerek yok. Böyle tutarlar da alınır, firması
    // sonra gönderen alan adından/imzadan tamamlanır; olmazsa ekranda elle seçilir.
    // Makul aralık şartı, imza/telefon gibi alakasız sayıları eler.
    if (!firma && !(tutar >= 500 && tutar <= 500000)) continue;
    sonuc.push({ firma, tutar, kanit });
  }
  return sonuc;
}

// ───────────────────────── ana akış ─────────────────────────

async function main() {
  // Tanımlar
  const { data: tanimlar } = await sb.from("tanimlamalar").select("kategori, deger, kisa_ad, aktif");
  const acenteler = [];
  for (const t of tanimlar ?? []) {
    if (t.kategori !== "sigorta_acente" || !t.kisa_ad) continue;
    try {
      const j = typeof t.kisa_ad === "string" ? JSON.parse(t.kisa_ad) : t.kisa_ad;
      if (j?.e) acenteler.push({ ad: t.deger, email: String(j.e).toLowerCase().trim() });
    } catch { /* kisa_ad JSON değil → atla */ }
  }
  const firmalar = (tanimlar ?? []).filter((t) => t.kategori === "sigorta_firmasi").map((t) => t.deger);
  const { data: aracRows } = await sb.from("araclar").select("id, plaka");
  const plakalar = (aracRows ?? []).map((a) => ({ id: a.id, plaka: a.plaka, norm: plakaNorm(a.plaka) }));

  // Kesilmiş poliçeler: teklif o döneme aitse yeni poliçeye değil, O poliçeye bağlanır.
  const { data: policeRows } = await sb.from("arac_police").select("id, arac_id, police_tipi, islem_tarihi, bitis_tarihi");
  const policeler = policeRows ?? [];

  const { data: firmaRows } = await sb.from("firmalar").select("smtp_user, smtp_password").not("smtp_user", "is", null);
  const hesaplar = new Map();
  for (const f of firmaRows ?? []) if (f.smtp_user && f.smtp_password) hesaplar.set(f.smtp_user, f.smtp_password);

  log(`${acenteler.length} acente, ${firmalar.length} sigorta firması, ${plakalar.length} araç, ${hesaplar.size} posta kutusu`);
  if (acenteler.length === 0) { log("Acente e-postası tanımlı değil — çıkılıyor."); return; }

  const { data: durumlar } = await sb.from("sigorta_mail_durum").select("*");
  const durumMap = new Map((durumlar ?? []).map((d) => [d.hesap, d]));

  let toplamYeni = 0, toplamBekleyen = 0;

  for (const [user, pass] of hesaplar) {
    const oncekiTarih = durumMap.get(user)?.son_tarih;
    const since = GUN ? new Date(Date.now() - GUN * 86400000)
      : oncekiTarih ? new Date(Date.parse(oncekiTarih) - 86400000)   // 1 gün geri: sınırdakiler kaçmasın
      : new Date(Date.now() - 30 * 86400000);
    let enSonTarih = oncekiTarih ? new Date(oncekiTarih) : since;

    const c = new ImapFlow({
      host: `mail.${user.split("@")[1]}`, port: 993, secure: true,
      auth: { user, pass }, logger: false, tls: { rejectUnauthorized: false },
    });
    try {
      await c.connect();
    } catch (e) { log(`${user}: bağlanılamadı — ${e.message}`); continue; }

    try {
      await c.mailboxOpen("INBOX");
      const uidler = await c.search({ since }, { uid: true });
      log(`${user}: ${since.toISOString().slice(0, 10)} sonrası ${uidler?.length ?? 0} mesaj`);
      if (!uidler?.length) continue;

      for await (const m of c.fetch(uidler.join(","), { uid: true, source: true }, { uid: true })) {
        const p = await simpleParser(m.source);
        const gonderen = (p.from?.value?.[0]?.address ?? "").toLowerCase();
        const acente = acenteler.find((a) => a.email === gonderen);
        if (!acente) continue;                                  // acente değil → ilgilenmiyoruz
        if (p.date && p.date > enSonTarih) enSonTarih = p.date;

        const konu = p.subject ?? "";
        const govde = p.text ?? "";
        const arac = plakaBul(`${konu} ${govde}`, plakalar);
        const tip = tipBul(`${konu} ${govde}`);
        const kimlikKok = `${user}/INBOX/${m.uid}`;

        if (!arac) { log(`  [atlandı] ${konu.slice(0, 50)} — plaka bulunamadı`); continue; }

        const bulunanlar = [];   // {firma, tutar, kaynak, kanit, ek}

        // 1) PDF ekleri
        for (const ek of p.attachments ?? []) {
          if (!/pdf/i.test(ek.contentType ?? "")) continue;
          try {
            const metin = await pdfMetin(ek.content);
            const tutar = pdfTutar(metin);
            const firma = firmaBul(metin.slice(0, 400), firmalar) ?? firmaBul(metin, firmalar);
            // Başlıkta "TEKLİFİ" yoksa bu kesilmiş poliçedir, teklif değil — not düşülür.
            // Başlıkta "TEKLİF" yoksa bu KESİLMİŞ POLİÇEdir, teklif değil. Karşılaştırma
            // ekranını kirletmesin diye teklif olarak yazılmaz (poliçe akışı ayrı yürüyor).
            const policeMi = !/TEKLİF/i.test(metin.slice(0, 200));
            if (policeMi) { log(`  [poliçe] ${ek.filename ?? "ek.pdf"} — teklif değil, atlandı`); continue; }
            if (tutar > 0) bulunanlar.push({ firma, tutar, kaynak: "pdf", kanit: ek.filename ?? "ek.pdf" });
          } catch (e) { log(`  PDF okunamadı (${ek.filename}): ${e.message}`); }
        }

        // 2) Mail gövdesi
        for (const g of govdedenTeklifler(govde, firmalar)) {
          // Aynı firma PDF'ten de geldiyse tekrar ekleme
          if (bulunanlar.some((b) => b.firma === g.firma)) continue;
          bulunanlar.push({ firma: g.firma, tutar: g.tutar, kaynak: "mail", kanit: g.kanit });
        }

        // 3) Resim ekleri — makine okuyamaz, elle bakılmak üzere işaretle.
        //    İmza logoları elenir (bkz. teklifResmiMi).
        const resimler = (p.attachments ?? []).filter(teklifResmiMi);

        // Firması belirlenemeyen tutarları gönderenin şirketiyle tamamla.
        const gonderenFirma = gonderendenFirma(gonderen, govde, firmalar);
        for (const b of bulunanlar) if (!b.firma) b.firma = gonderenFirma;

        if (bulunanlar.length === 0 && resimler.length === 0) {
          log(`  [boş] ${konu.slice(0, 50)} — rakam bulunamadı`);
          continue;
        }

        // Bu teklif hangi döneme ait? Mail geldikten SONRA o araç+tip için poliçe kesildiyse
        // teklif o poliçenin dönemine aittir; police_id verilerek geçmişe yazılır. Yoksa null
        // kalır ve "güncel dönem" teklifi olarak karşılaştırma ekranında görünür.
        // (Elle girilmiş aynı teklifler zaten poliçeye bağlı; bu olmadan aynı teklif bir de
        //  güncel dönemde çıkıp poliçesi çoktan kesilmiş aracı bekliyormuş gibi gösteriyordu.)
        const mailGun = (p.date ?? new Date()).toISOString().slice(0, 10);
        const donemPolice = policeler
          .filter((x) => x.arac_id === arac.id && x.police_tipi === tip && (x.islem_tarihi ?? "") >= mailGun)
          .sort((a, b) => String(a.islem_tarihi).localeCompare(String(b.islem_tarihi)))[0] ?? null;

        let sira = 0;
        for (const b of bulunanlar) {
          sira++;
          const kayit = {
            arac_id: arac.id, police_tipi: tip, acente_adi: acente.ad,
            sigorta_firmasi: b.firma, teklif_tutari: b.tutar,
            teklif_tarihi: (p.date ?? new Date()).toISOString().slice(0, 10),
            notlar: b.kanit, kaynak: b.kaynak, mail_kimlik: `${kimlikKok}#${sira}`,
            police_id: donemPolice?.id ?? null,
            mail_konu: konu.slice(0, 200), mail_tarih: (p.date ?? new Date()).toISOString(),
          };
          if (DENEME) { log(`  [deneme] ${arac.plaka} ${tip} ${acente.ad} → ${b.firma ?? "?"} ${b.tutar.toLocaleString("tr-TR")} TL (${b.kaynak})`); continue; }
          const { error } = await sb.from("sigorta_teklif").insert(kayit);
          if (error) {
            if (/duplicate|unique/i.test(error.message)) continue;   // daha önce işlenmiş
            log(`  YAZILAMADI: ${error.message}`);
          } else { toplamYeni++; log(`  + ${arac.plaka} ${tip} ${acente.ad} → ${b.firma ?? "?"} ${b.tutar.toLocaleString("tr-TR")} TL (${b.kaynak})`); }
        }

        // Resimli mail: rakam yoksa "elle bakılmalı" kaydı aç, eki sakla
        if (resimler.length > 0 && bulunanlar.length === 0) {
          const ek = resimler[0];
          let ekUrl = null;
          if (!DENEME) {
            const uzanti = (ek.filename?.split(".").pop() ?? "png").replace(/[^\w]/g, "");
            const yol = `sigorta-teklif/${arac.id}/${m.uid}.${uzanti}`;
            const { error: yErr } = await sb.storage.from("araclar").upload(yol, ek.content, {
              contentType: ek.contentType ?? "image/png", upsert: true,
            });
            if (yErr) log(`  resim yüklenemedi: ${yErr.message}`);
            else ekUrl = sb.storage.from("araclar").getPublicUrl(yol).data.publicUrl;
          }
          const kayit = {
            arac_id: arac.id, police_tipi: tip, acente_adi: acente.ad,
            sigorta_firmasi: null, teklif_tutari: 0,
            teklif_tarihi: (p.date ?? new Date()).toISOString().slice(0, 10),
            notlar: "Teklif resim olarak geldi — tutar elle girilmeli.",
            kaynak: "resim", elle_bekliyor: true, ek_url: ekUrl, police_id: donemPolice?.id ?? null,
            mail_kimlik: `${kimlikKok}#resim`, mail_konu: konu.slice(0, 200),
            mail_tarih: (p.date ?? new Date()).toISOString(),
          };
          if (DENEME) { log(`  [deneme] ${arac.plaka} ${tip} ${acente.ad} → RESİM (elle girilecek)`); continue; }
          const { error } = await sb.from("sigorta_teklif").insert(kayit);
          if (error) { if (!/duplicate|unique/i.test(error.message)) log(`  YAZILAMADI: ${error.message}`); }
          else { toplamBekleyen++; log(`  ~ ${arac.plaka} ${tip} ${acente.ad} → resim, elle girilecek`); }
        }
      }
    } finally {
      try { await c.logout(); } catch { /* bağlantı zaten kapanmış olabilir */ }
    }

    if (!DENEME) {
      await sb.from("sigorta_mail_durum").upsert({
        hesap: user, son_tarih: enSonTarih.toISOString(),
        son_calisma: new Date().toISOString(),
        son_sonuc: `${toplamYeni} teklif, ${toplamBekleyen} elle bekleyen`,
      }, { onConflict: "hesap" });
    }
  }

  log(`BİTTİ — ${toplamYeni} teklif yazıldı, ${toplamBekleyen} mail elle girilmeyi bekliyor${DENEME ? " (deneme modu, hiçbir şey yazılmadı)" : ""}`);
}

main().catch((e) => { console.error("HATA:", e); process.exit(1); });
