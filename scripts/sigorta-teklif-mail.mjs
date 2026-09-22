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
// KESİLMİŞ POLİÇE gelirse (teklif değil, poliçenin kendisi) arac_police kaydı AÇILIR:
// PDF depoya yüklenir, aracın sigorta bitiş tarihi güncellenir, o dönemin teklifleri
// poliçeye bağlanır. Böylece "Poliçe Ekle" ekranını elle doldurmaya gerek kalmaz.
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
import { teklifResminiOku } from "./teklif-resim-oku.mjs";
import { policePdfOku } from "./police-pdf-oku.mjs";
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
 * Mailin okunabilir metni: imza/altıntı kuyruğu atılır, boş satırlar sadeleştirilir.
 * Teklif ekranında "maili oku" ile gösterilecek; çok uzun olmasının anlamı yok.
 */
function mailGovdesi(govde) {
  const kesik = String(govde ?? "").split(/\n-{2,}\s*\n|\n_{4,}\s*\n|\nOn .* wrote:|\n\d{1,2}[.\/]\d{1,2}[.\/]\d{4}.*yazdı:/)[0];
  const temiz = kesik.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return temiz ? temiz.slice(0, 4000) : null;
}

/**
 * Kesilmiş poliçeyi sisteme kaydet: arac_police satırı + PDF + araç bitiş tarihi.
 *
 * ACENTE POLİÇEDE YAZMAZ — poliçede yalnız acente NUMARASI var, adı yok. Bu yüzden acente
 * maili GÖNDERENDEN alınır; tekliflerde de aynı kaynak kullanılıyor.
 *
 * EKSİK ALANLA KAYIT AÇILMAZ: poliçe no, bitiş tarihi ve plaka şart. Yarım bir poliçe
 * kaydı, hiç kayıt olmamasından kötüdür — elle girilmesi için log'a yazılır.
 */
async function policeyiKaydet(metin, ek, arac, acente, p, { plakalar, firmalar }) {
  const dosyaAdi = ek.filename ?? "police.pdf";
  if (!env.ANTHROPIC_API_KEY) { log(`  [poliçe] ${dosyaAdi} — okuma anahtarı yok, elle girilmeli`); return false; }

  let v;
  try {
    v = await policePdfOku(metin, env.ANTHROPIC_API_KEY);
  } catch (e) { log(`  [poliçe] ${dosyaAdi} — okunamadı: ${e.message}`); return false; }

  // Plaka: poliçeden okunan öncelikli, tutmazsa mailden bulunan araç kullanılır.
  const pdfArac = v.plaka ? plakaBul(v.plaka, plakalar) : null;
  const hedefArac = pdfArac ?? arac;
  const tip = v.tip ?? tipBul(`${p.subject ?? ""} ${metin.slice(0, 300)}`);

  const eksik = [];
  if (!hedefArac) eksik.push("plaka");
  if (!v.policeNo) eksik.push("poliçe no");
  if (!v.bitisTarihi) eksik.push("bitiş tarihi");
  if (eksik.length) { log(`  [poliçe] ${dosyaAdi} — ${eksik.join(", ")} okunamadı, elle girilmeli`); return false; }

  // Aynı poliçe ikinci kez gelirse (acente maili yineler) tekrar kaydedilmesin.
  const { data: mevcut } = await sb.from("arac_police").select("id")
    .eq("arac_id", hedefArac.id).eq("police_tipi", tip).eq("police_no", v.policeNo).limit(1);
  if (mevcut?.length) { log(`  [poliçe] ${hedefArac.plaka} ${tip} ${v.policeNo} — zaten kayıtlı`); return false; }

  const firma = v.sigortaFirmasi ? (firmaBul(v.sigortaFirmasi, firmalar) ?? v.sigortaFirmasi) : null;

  // POLİÇELEŞTİRME İSTEDİĞİMİZ TEKLİFTEN Mİ KESİLMİŞ?
  // Teklifler ekranından "Poliçeleştir" denince o teklife police_talep_tarihi yazılıyor.
  // Gelen poliçe başka firmadan ya da başka rakama kesilmişse kayıt YİNE açılır (poliçe
  // gerçek, kayda girmemesi daha kötü) ama sebebi yazılır ve ekranda kırmızı görünür.
  let uyari = null;
  const { data: istenenler } = await sb.from("sigorta_teklif")
    .select("sigorta_firmasi, teklif_tutari, police_talep_tarihi")
    .eq("arac_id", hedefArac.id).eq("police_tipi", tip)
    .not("police_talep_tarihi", "is", null)
    .order("police_talep_tarihi", { ascending: false }).limit(1);
  const istenen = istenenler?.[0];
  if (istenen) {
    const farklar = [];
    const sadeles = (x) => String(x ?? "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
    if (firma && istenen.sigorta_firmasi && sadeles(firma) !== sadeles(istenen.sigorta_firmasi)) {
      farklar.push(`firma: ${istenen.sigorta_firmasi} istenmişti, ${firma} kesilmiş`);
    }
    // 1 TL'nin altındaki fark yuvarlamadır, uyarı sayılmaz.
    if (v.brutPrim != null && istenen.teklif_tutari > 0 && Math.abs(v.brutPrim - istenen.teklif_tutari) >= 1) {
      const yaz = (n) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      farklar.push(`tutar: ${yaz(istenen.teklif_tutari)} TL istenmişti, ${yaz(v.brutPrim)} TL kesilmiş`);
    }
    if (farklar.length) uyari = farklar.join(" · ");
  }

  const kayit = {
    arac_id: hedefArac.id,
    police_tipi: tip,
    tutar: v.brutPrim,
    sigorta_firmasi: firma,
    acente: acente.ad,                                   // poliçede yok → maili gönderen acente
    islem_tarihi: (p.date ?? new Date()).toISOString().slice(0, 10),
    baslangic_tarihi: v.baslangicTarihi,
    bitis_tarihi: v.bitisTarihi,
    police_no: v.policeNo,
    police_url: null,
    created_by: null,                                    // insan değil, mail okuyucu açtı
    otomatik_uyari: uyari,
  };
  if (DENEME) {
    log(`  [deneme/poliçe] ${hedefArac.plaka} ${tip} ${firma} ${v.brutPrim} TL · ${v.baslangicTarihi}→${v.bitisTarihi} · ${v.policeNo} · ${acente.ad}`);
    if (uyari) log(`     UYUŞMUYOR → ${uyari}`);
    return false;
  }

  const { data: yeni, error } = await sb.from("arac_police").insert(kayit).select("id").single();
  if (error) { log(`  [poliçe] ${hedefArac.plaka} YAZILAMADI: ${error.message}`); return false; }

  // PDF depoya: ekrandaki "Poliçe PDF" alanının indirdiği yolun aynısı (police/<id>/police.pdf).
  const yol = `police/${yeni.id}/police.pdf`;
  const { error: yErr } = await sb.storage.from("araclar").upload(yol, ek.content, {
    contentType: ek.contentType ?? "application/pdf", upsert: true,
  });
  if (yErr) log(`  [poliçe] PDF yüklenemedi: ${yErr.message}`);
  else {
    const url = sb.storage.from("araclar").getPublicUrl(yol).data.publicUrl;
    await sb.from("arac_police").update({ police_url: url }).eq("id", yeni.id);
  }

  // Ekrandan kaydedilince ne oluyorsa aynısı: araç bitiş tarihi, teklif isteği temizliği,
  // tekliflerin poliçeye bağlanması, "vazgeçildi" işaretinin kalkması.
  await sb.from("araclar")
    .update({ [tip === "kasko" ? "kasko_bitis" : "trafik_sigorta_bitis"]: v.bitisTarihi })
    .eq("id", hedefArac.id);
  await sb.from("teklif_gonderim").delete().eq("arac_id", hedefArac.id).eq("police_tipi", tip);
  await sb.from("sigorta_teklif").update({ police_id: yeni.id })
    .eq("arac_id", hedefArac.id).eq("police_tipi", tip).is("police_id", null);
  await sb.from("sigorta_vazgec").delete().eq("arac_id", hedefArac.id).eq("police_tipi", tip);

  log(`  ★ POLİÇE ${hedefArac.plaka} ${tip} · ${firma ?? "?"} · ${(v.brutPrim ?? 0).toLocaleString("tr-TR")} TL · ${v.baslangicTarihi}→${v.bitisTarihi} · ${acente.ad}`);
  if (uyari) log(`     ! UYUŞMUYOR → ${uyari}`);

  await bildirimGonder(hedefArac, tip, {
    baslik: uyari
      ? `${hedefArac.plaka} — poliçe geldi, DİKKAT`
      : `${hedefArac.plaka} ${tip === "kasko" ? "Kasko" : "Trafik"} poliçesi kaydedildi`,
    govde: uyari
      ? uyari
      : `${firma ?? "?"} · ${(v.brutPrim ?? 0).toLocaleString("tr-TR")} ₺ · ${v.bitisTarihi} tarihine kadar`,
    etiket: `police-${hedefArac.id}-${tip}`,
  });
  return true;
}

/**
 * Bildirimi gönder: TEKLİFİ İSTEYEN kullanıcı + yöneticiler.
 *
 * İsteyen kişi teklif_gonderim.isteyen_id'de duruyor (teklif istenirken yazılıyor).
 * Eski kayıtlarda boş olabilir — o zaman yalnız yöneticilere gider, bildirim hiç
 * gitmemesindense eksik gitmesi yeğdir.
 */
async function bildirimGonder(arac, tip, icerik) {
  try {
    const { data: g } = await sb.from("teklif_gonderim")
      .select("isteyen_id").eq("arac_id", arac.id).eq("police_tipi", tip)
      .not("isteyen_id", "is", null)
      .order("created_at", { ascending: false }).limit(1);
    const isteyen = g?.[0]?.isteyen_id ? [g[0].isteyen_id] : [];
    const n = await pushGonder(sb, env, { ...icerik, url: "/dashboard" }, isteyen);
    if (n > 0) log(`     bildirim → ${n} cihaz`);
  } catch (e) {
    log(`     bildirim gönderilemedi: ${e.message}`);   // bildirim hatası veriyi etkilemesin
  }
}

/**
 * Bu maili bir daha işleme — okuma masrafı boşa gitmesin.
 *
 * İLK işaret kalır: bir mailde hem poliçe eki hem rakamsız gövde olabiliyor; poliçe
 * işlendikten sonra gövde "rakam yok" deyip ilk kaydın üstüne yazıyordu ve kayıtta
 * mailin ne olduğu yanlış görünüyordu.
 */
async function mailiIsaretle(kimlik, sonuc) {
  if (DENEME) return;
  await sb.from("sigorta_mail_islenen")
    .upsert({ kimlik, sonuc }, { onConflict: "kimlik", ignoreDuplicates: true });
}

/** Teklif resmini depoya yükle, herkese açık adresini döndür (yüklenemezse null). */
async function resmiYukle(ek, aracId, uid) {
  if (DENEME) return null;
  const uzanti = (ek.filename?.split(".").pop() ?? "png").replace(/[^\w]/g, "");
  const yol = `sigorta-teklif/${aracId}/${uid}.${uzanti}`;
  const { error } = await sb.storage.from("araclar").upload(yol, ek.content, {
    contentType: ek.contentType ?? "image/png", upsert: true,
  });
  if (error) { log(`  resim yüklenemedi: ${error.message}`); return null; }
  return sb.storage.from("araclar").getPublicUrl(yol).data.publicUrl;
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
  // Yalnız gereken iki kategori: tablonun tamamı 38 KB, bu ikisi 1 KB'nin altında.
  // Script sık çalıştığı için (dakikalar) fark doğrudan aylık egress'e yansıyor.
  const { data: tanimlar } = await sb.from("tanimlamalar")
    .select("kategori, deger, kisa_ad, aktif")
    .in("kategori", ["sigorta_acente", "sigorta_firmasi"]);
  const acenteler = [];
  for (const t of tanimlar ?? []) {
    if (t.kategori !== "sigorta_acente" || !t.kisa_ad) continue;
    try {
      const j = typeof t.kisa_ad === "string" ? JSON.parse(t.kisa_ad) : t.kisa_ad;
      if (j?.e) acenteler.push({ ad: t.deger, email: String(j.e).toLowerCase().trim() });
    } catch { /* kisa_ad JSON değil → atla */ }
  }
  const firmalar = (tanimlar ?? []).filter((t) => t.kategori === "sigorta_firmasi").map((t) => t.deger);

  // ARAÇ ve POLİÇE listeleri TEMBEL yüklenir: yeni mail yoksa hiç okunmaz.
  // Script 15 dakikada bir (daha sık da olabilir) çalışıyor ve çoğu çalışmada yeni mail
  // olmuyor. 119 araç + 300 poliçe satırını her seferinde indirmek boşuna egress.
  let plakalar = null, policeler = null;
  async function referansYukle() {
    if (plakalar) return;
    const { data: aracRows } = await sb.from("araclar").select("id, plaka");
    plakalar = (aracRows ?? []).map((a) => ({ id: a.id, plaka: a.plaka, norm: plakaNorm(a.plaka) }));
    // Kesilmiş poliçeler: teklif o döneme aitse yeni poliçeye değil, O poliçeye bağlanır.
    const { data: policeRows } = await sb.from("arac_police").select("id, arac_id, police_tipi, islem_tarihi, bitis_tarihi");
    policeler = policeRows ?? [];
  }

  const { data: firmaRows } = await sb.from("firmalar").select("smtp_user, smtp_password").not("smtp_user", "is", null);
  const hesaplar = new Map();
  for (const f of firmaRows ?? []) if (f.smtp_user && f.smtp_password) hesaplar.set(f.smtp_user, f.smtp_password);

  log(`${acenteler.length} acente, ${firmalar.length} sigorta firması, ${hesaplar.size} posta kutusu`);
  if (acenteler.length === 0) { log("Acente e-postası tanımlı değil — çıkılıyor."); return; }

  const { data: durumlar } = await sb.from("sigorta_mail_durum").select("*");
  const durumMap = new Map((durumlar ?? []).map((d) => [d.hesap, d]));

  // İŞLENMİŞ MAİLLER — bunlara bir daha dokunulmaz.
  // Script her çalışmada 1 gün geriye bakıyor (sınırdaki mailler kaçmasın diye) ve
  // 15 dakikada bir çalışıyor. Bu kayıt olmadan, resim eki olan bir mail o pencerede
  // kaldığı sürece ~96 kez yapay zekâya okutuluyordu; okuma ücretli, sonuç hep aynı.
  // Tabloyu tümüyle okumak zamanla büyür; yalnız bu çalışmada karşılaşılan kimlikler
  // sorulur (aşağıda, uid listesi elde edildikten sonra).
  async function islenmisleriGetir(kimlikler) {
    if (!kimlikler.length) return new Set();
    const bulunan = new Set();
    for (let i = 0; i < kimlikler.length; i += 200) {
      const { data } = await sb.from("sigorta_mail_islenen")
        .select("kimlik").in("kimlik", kimlikler.slice(i, i + 200));
      for (const x of data ?? []) bulunan.add(x.kimlik);
    }
    return bulunan;
  }

  let toplamYeni = 0, toplamBekleyen = 0;
  let toplamPolice = 0;   // mailden otomatik açılan poliçe kaydı

  for (const [user, pass] of hesaplar) {
   // Bir hesapta çıkan hata diğerini engellemesin; tek tek yalıtılır.
   try {
    const oncekiTarih = durumMap.get(user)?.son_tarih;
    const since = GUN ? new Date(Date.now() - GUN * 86400000)
      : oncekiTarih ? new Date(Date.parse(oncekiTarih) - 86400000)   // 1 gün geri: sınırdakiler kaçmasın
      : new Date(Date.now() - 30 * 86400000);
    let enSonTarih = oncekiTarih ? new Date(oncekiTarih) : since;

    const c = new ImapFlow({
      host: `mail.${user.split("@")[1]}`, port: 993, secure: true,
      auth: { user, pass }, logger: false, tls: { rejectUnauthorized: false },
    });
    // ImapFlow bağlantı hatalarını OLAY olarak yayıyor; dinlenmezse Node süreci çökertiyor.
    // (Zamanlanmış görev ile elle çalıştırma çakışınca ECONNRESET alındı ve script öldü.)
    c.on("error", (e) => log(`${user}: bağlantı hatası — ${e.message}`));
    try {
      await c.connect();
    } catch (e) { log(`${user}: bağlanılamadı — ${e.message}`); continue; }

    try {
      await c.mailboxOpen("INBOX");
      const uidler = await c.search({ since }, { uid: true });
      if (!uidler?.length) { log(`${user}: yeni mesaj yok`); continue; }

      // İNDİRMEDEN ÖNCE İKİ ELEME. Pencerede 29 mail varken hepsinin GÖVDESİ indiriliyordu;
      // oysa çoğu banka bildirimi, acente maili bile değil. Asıl yük buydu.
      //   1) ZARF (gönderen/tarih) çekilir — gövdeye göre çok küçük bir istek.
      //   2) Acente olmayanlar ve daha önce işlenmiş olanlar elenir.
      // Geriye kalan avuç dolusu mailin gövdesi indirilir.
      const zarflar = new Map();
      for await (const m of c.fetch(uidler.join(","), { uid: true, envelope: true }, { uid: true })) {
        const adres = (m.envelope?.from?.[0]?.address ?? "").toLowerCase();
        zarflar.set(m.uid, adres);
      }
      const acenteUid = uidler.filter((u) => acenteler.some((a) => a.email === zarflar.get(u)));
      const islenmis = await islenmisleriGetir(acenteUid.map((u) => `${user}/INBOX/${u}`));
      const yeniUid = acenteUid.filter((u) => !islenmis.has(`${user}/INBOX/${u}`));
      log(`${user}: ${uidler.length} mesaj · ${acenteUid.length} acenteden · ${yeniUid.length} yeni`);
      if (!yeniUid.length) continue;
      await referansYukle();

      // Mesajlar ÖNCE baştan sona indirilir, işleme SONRA yapılır.
      // Sebep: resim okuma (yapay zekâ çağrısı) ~15 saniye sürüyor; o sürede IMAP
      // bağlantısı boşta kalınca sunucu bağlantıyı düşürüyor (ECONNRESET) ve kalan
      // mailler hiç okunmuyordu. İndirme hızlı, arada bekleme olmuyor.
      const mesajlar = [];
      for await (const m of c.fetch(yeniUid.join(","), { uid: true, source: true }, { uid: true })) {
        mesajlar.push({ uid: m.uid, source: m.source });
      }
      try { await c.logout(); } catch { /* işimiz bitti, kapanmaması önemli değil */ }

      for (const m of mesajlar) {
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

        if (!arac) { log(`  [atlandı] ${konu.slice(0, 50)} — plaka bulunamadı`); await mailiIsaretle(kimlikKok, "plaka yok"); continue; }

        const bulunanlar = [];   // {firma, tutar, kaynak, kanit, onay, ek}

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
            if (policeMi) {
              if (await policeyiKaydet(metin, ek, arac, acente, p, { plakalar, firmalar })) toplamPolice++;
              await mailiIsaretle(kimlikKok, "poliçe");
              continue;
            }
            if (tutar > 0) bulunanlar.push({ firma, tutar, kaynak: "pdf", kanit: ek.filename ?? "ek.pdf" });
          } catch (e) { log(`  PDF okunamadı (${ek.filename}): ${e.message}`); }
        }

        // 2) Mail gövdesi
        for (const g of govdedenTeklifler(govde, firmalar)) {
          // Aynı firma PDF'ten de geldiyse tekrar ekleme
          if (bulunanlar.some((b) => b.firma === g.firma)) continue;
          bulunanlar.push({ firma: g.firma, tutar: g.tutar, kaynak: "mail", kanit: g.kanit });
        }

        // 3) Resim ekleri — acentenin karşılaştırma tablosunun ekran görüntüsü.
        //    İmza logoları elenir (bkz. teklifResmiMi).
        const resimler = (p.attachments ?? []).filter(teklifResmiMi);

        // Resimdeki TABLONUN TAMAMINI oku. Bir resimde 13-14 şirketin fiyatı olabiliyor;
        // mail metninde ise acente yalnız kendi önerdiğini yazıyor. Okuma başarılıysa metinden
        // çıkan tek satırın YERİNE tablo kullanılır — aynı teklif iki kez yazılmasın.
        if (resimler.length > 0 && env.ANTHROPIC_API_KEY) {
          for (const ek of resimler) {
            try {
              const sonuc = await teklifResminiOku(ek.content, ek.contentType ?? "image/png", env.ANTHROPIC_API_KEY);
              if (sonuc.satirlar.length > 0) {
                // Tablo okunsa da ASLI saklanır: teklif satırındaki "resmi aç" bağlantısı buna gider,
                // okunan rakamdan şüphe edilirse kaynağa bakılabilsin.
                const ekUrl = await resmiYukle(ek, arac.id, m.uid);
                bulunanlar.length = 0;
                for (const r of sonuc.satirlar) {
                  bulunanlar.push({
                    firma: firmaBul(r.firma, firmalar) ?? r.firma,   // tanımlı yazıma eşle, yoksa olduğu gibi
                    tutar: r.tutar, kaynak: "resim", onay: r.onay ?? null, ek: ekUrl,
                    kanit: "Acentenin karşılaştırma tablosundan okundu",
                  });
                }
                log(`  resim okundu: ${sonuc.satirlar.length} firma (${ek.filename ?? "resim"})`);
              }
            } catch (e) { log(`  resim okunamadı (${ek.filename}): ${e.message}`); }
          }
        }

        // Firması belirlenemeyen tutarları gönderenin şirketiyle tamamla.
        const gonderenFirma = gonderendenFirma(gonderen, govde, firmalar);
        for (const b of bulunanlar) if (!b.firma) b.firma = gonderenFirma;

        if (bulunanlar.length === 0 && resimler.length === 0) {
          log(`  [boş] ${konu.slice(0, 50)} — rakam bulunamadı`);
          await mailiIsaretle(kimlikKok, "rakam yok");
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
        let yeniSayi = 0;      // bu mailden KAÇ teklif gerçekten yazıldı (mükerrerler hariç)
        for (const b of bulunanlar) {
          sira++;
          const kayit = {
            arac_id: arac.id, police_tipi: tip, acente_adi: acente.ad,
            sigorta_firmasi: b.firma, teklif_tutari: b.tutar,
            teklif_tarihi: (p.date ?? new Date()).toISOString().slice(0, 10),
            notlar: b.kanit, kaynak: b.kaynak, mail_kimlik: `${kimlikKok}#${sira}`,
            onay_durumu: b.onay ?? null, ek_url: b.ek ?? null,
            police_id: donemPolice?.id ?? null,
            mail_konu: konu.slice(0, 200), mail_tarih: (p.date ?? new Date()).toISOString(),
            // Acente şartı metinde yazıyor ("2 taksit vade farksız tanzim edilebilir" gibi);
            // rakam kadar önemli olduğu için mailin kendisi de saklanır.
            mail_govde: mailGovdesi(govde),
          };
          if (DENEME) { log(`  [deneme] ${arac.plaka} ${tip} ${acente.ad} → ${b.firma ?? "?"} ${b.tutar.toLocaleString("tr-TR")} TL (${b.kaynak})`); continue; }
          const { error } = await sb.from("sigorta_teklif").insert(kayit);
          if (error) {
            if (/duplicate|unique/i.test(error.message)) {
              // Kayıt zaten var ama sonradan eklenen alanlar (onay işareti, mailin metni,
              // resmin adresi) boş olabilir — rakama dokunmadan bunları tamamla.
              await sb.from("sigorta_teklif").update({
                onay_durumu: kayit.onay_durumu, mail_govde: kayit.mail_govde,
                ...(kayit.ek_url ? { ek_url: kayit.ek_url } : {}),
              }).eq("mail_kimlik", kayit.mail_kimlik);
              continue;
            }
            log(`  YAZILAMADI: ${error.message}`);
          } else { toplamYeni++; yeniSayi++; log(`  + ${arac.plaka} ${tip} ${acente.ad} → ${b.firma ?? "?"} ${b.tutar.toLocaleString("tr-TR")} TL (${b.kaynak})`); }
        }

        await mailiIsaretle(kimlikKok, `${bulunanlar.length} teklif`);

        // BİLDİRİM — mail başına TEK tane. Bir acente 14 firmalık tablo gönderdiğinde
        // 14 ayrı bildirim telefonu kilitlerdi; özet yeterli, ayrıntı ekranda.
        if (yeniSayi > 0 && !DENEME) {
          const tutarlar = bulunanlar.map((b) => b.tutar).filter((t) => t > 0);
          const enUcuz = tutarlar.length ? Math.min(...tutarlar) : null;
          await bildirimGonder(hedefArac ?? arac, tip, {
            baslik: `${(hedefArac ?? arac).plaka} — ${yeniSayi} yeni teklif`,
            govde: `${acente.ad} ${yeniSayi} firma teklifi gönderdi`
              + (enUcuz ? ` · en uygun ${enUcuz.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺` : ""),
            etiket: `teklif-${(hedefArac ?? arac).id}-${tip}`,
          });
        }

        // Resim okunamadıysa (anahtar yok ya da hata): "elle bakılmalı" kaydı aç, eki sakla.
        if (resimler.length > 0 && bulunanlar.length === 0) {
          const ek = resimler[0];
          const ekUrl = await resmiYukle(ek, arac.id, m.uid);
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
   } catch (e) {
     log(`${user}: bu hesap atlandı — ${e.message}`);
   }
  }

  log(`BİTTİ — ${toplamYeni} teklif, ${toplamPolice} poliçe yazıldı, ${toplamBekleyen} mail elle girilmeyi bekliyor${DENEME ? " (deneme modu, hiçbir şey yazılmadı)" : ""}`);
}

main().catch((e) => { console.error("HATA:", e); process.exit(1); });
