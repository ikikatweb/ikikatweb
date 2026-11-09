// İCRA TEBLİGATI BELGESİNİ OKUR — PDF'ten dosya no, taraflar ve tutar.
//
// NİYE VAR: icra yazıları elle icra sayfasına işleniyordu. Kullanıcı "gelir gelmez
// işlensin" dedi (09.11.2026); tebligat düşünce taslak satır açılıyor, bu modül de
// belgeyi okuyup alacaklı/borçlu/tutar alanlarını dolduruyor.
//
// ÜÇ BELGE TÜRÜ VAR ve biri diğerlerinden TEMELDE FARKLI. 09.11.2026'da kutudaki
// 11 gerçek belge incelendi:
//
//   1) BİRİNCİ HACİZ İHBARNAMESİ (İİK 89/1, "Örnek No: 20**")
//      Biz ÜÇÜNCÜ ŞAHSIZ: borçlunun bizde parası/malı var mı diye soruluyor.
//      Numaralı başlıklar: "1. Üçüncü şahsın…", "2. Alacaklının…", "3. Borçlunun…",
//      "5. Alacak tutarı…"
//
//   2) MAAŞ HACZİ MÜZEKKERESİ / HACİZ KARAR YAZISI
//      Biz ÜÇÜNCÜ ŞAHSIZ (işveren), borçlu ÇALIŞANIMIZ. Etiketli biçim:
//      "ALACAKLI :", "VEKİLİ :", "BORÇLU :", "BORÇ MİKTARI :"
//
//   3) İLAMSIZ TAKİPLERDE ÖDEME EMRİ ("Örnek No: 7*")
//      BİZ BORÇLUYUZ. Bu bir haciz ihbarnamesi DEĞİL — şirketten para isteniyor.
//      İcra defteri "üçüncü şahıs" modeline göre kurulu; buraya rutin bir satır
//      yazmak, şirkete açılmış takibi maaş haczi gibi göstermek olurdu.
//      Bu yüzden ÖDEME EMRİ DEFTERE YAZILMAZ, ayrıca uyarılır.
//
// TAHMİN YOK: okunamayan alan null döner. Yanlış bir borçlu adı ya da tutar,
// boş alandan çok daha pahalıdır — insan boşluğu görür, yanlışı görmez.
import fs from "fs";

/** PDF'ten düz metin. pdfjs-dist kullanılıyor: Türkçe harfleri doğru çıkarıyor. */
export async function pdfMetni(kaynak) {
  // NİYE pdfjs: "pdftotext" harici bir program ve varsayılan kodlamasında Türkçe
  // harfler kayboluyor ("MÜHENDİSLİK" → "M?HENDSLK"). -enc UTF-8 ile düzeliyor ama
  // zamanlanmış görevin PATH'inde olmayabilir. pdfjs zaten projenin bağımlılığı.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const veri = Buffer.isBuffer(kaynak) ? new Uint8Array(kaynak)
    : new Uint8Array(fs.readFileSync(kaynak));
  const belge = await pdfjs.getDocument({ data: veri, useSystemFonts: true }).promise;
  let metin = "";
  for (let i = 1; i <= belge.numPages; i++) {
    const sayfa = await belge.getPage(i);
    metin += (await sayfa.getTextContent()).items.map((x) => x.str).join(" ") + "\n";
  }
  return metin.replace(/\s+/g, " ").trim();
}

const buyuk = (s) => String(s ?? "").toLocaleUpperCase("tr");

/** "23.000.000,00" → 23000000 · "295,00" → 295. Okunamazsa null. */
function tutarCevir(ham) {
  if (!ham) return null;
  const n = Number(String(ham).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "07/10/2026" → "2026-10-07". */
function tarihCevir(ham) {
  const m = String(ham ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Ad + vergi/TC numarası: "ERDEM KILIÇ PETROL … LTD. ŞTİ., 3360874229 Vergi Nolu," */
function tarafAyir(parca) {
  if (!parca) return { ad: null, no: null };
  const m = parca.match(/^\s*(?:\d+[-.)]\s*)?(.+?)\s*,\s*(\d{10,11})\s*(?:Vergi|TC)\s*Nolu/i);
  if (m) return { ad: m[1].trim(), no: m[2] };
  // Numarasız olabilir (ör. "ŞEKERBANK TÜRK ANONİM ŞİRKETİ vekili Av. …")
  const ad = parca.split(/\s+vekili\s+/i)[0].replace(/[,\s]+$/, "").trim();
  return { ad: ad || null, no: null };
}

/**
 * Belgeyi okur. Dönen: { tur, rolumuz, dosya_esas_no, belge_tarihi, alacakli_adi,
 * alacakli_vergi_no, borclu_adi, borclu_tc_no, borc_miktari, uyarilar[] }
 */
export function belgeCozumle(metin, bizimVknler = []) {
  const m = metin ?? "";
  const B = buyuk(m);
  const uyarilar = [];

  const tur = B.includes("BİRİNCİ HACİZ İHBARNAMESİ") ? "haciz_ihbarnamesi"
    : B.includes("İLAMSIZ TAKİPLERDE ÖDEME EMRİ") ? "odeme_emri"
    : (B.includes("MAAŞ HACZ") || B.includes("HACİZ MÜZEKKERE") || /ALACAKLI\s*:/.test(B)) ? "maas_haczi"
    : "bilinmiyor";

  const sonuc = {
    tur,
    rolumuz: tur === "odeme_emri" ? "borclu" : tur === "bilinmiyor" ? "bilinmiyor" : "ucuncu_sahis",
    dosya_esas_no: m.match(/(\d{4}\/\d+)\s*ESAS/i)?.[1] ?? null,
    belge_tarihi: tarihCevir(m.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1]),
    alacakli_adi: null, alacakli_vergi_no: null,
    borclu_adi: null, borclu_tc_no: null,
    borc_miktari: null,
    uyarilar,
  };

  if (tur === "haciz_ihbarnamesi") {
    // Numaralı başlıklar arasındaki metin alınır.
    // BAŞLIK NUMARASI OLMAYABİLİR (09.11.2026'da #106'da görüldü): bazı dairelerde
    // "3." öneki yok, doğrudan "Borçlunun ve varsa…" diye geçiyor. Numarayı zorunlu
    // tutan kalıp alacaklıyı sessizce okuyamıyordu.
    const alacakli = m.match(/Alacaklının ve varsa[\s\S]{0,100}?adresi\s*:?\s*([\s\S]{5,700}?)(?:\s*\d?\.?\s*Borçlunun|$)/i)?.[1];
    // PENCERE GENİŞ (09.11.2026'da yakalandı): bir dosyada BİRDEN ÇOK borçlu olabiliyor
    // ("1- … 2- … 3- …") ve liste uzunsa "4." başlığı 300 karakterin dışında kalıyordu;
    // borçlu sessizce okunamıyordu. Bitiş yoksa metnin sonuna kadar alınır, ilk taraf
    // ayrıştırılır (tarafAyir baştaki "1-" işaretini zaten atıyor).
    const borclu = m.match(/Borçlunun ve varsa[\s\S]{0,120}?adresi\s*:?\s*([\s\S]{5,1500}?)(?:\s*\d\.\s|$)/i)?.[1];
    const tutar = m.match(/5\.\s*Alacak tutarı[^:]*:\s*([\d.]+,\d{2})/i)?.[1]
      ?? m.match(/([\d.]+,\d{2})\s*TL\s*ihtiyati haciz/i)?.[1];
    Object.assign(sonuc, {
      alacakli_adi: tarafAyir(alacakli).ad, alacakli_vergi_no: tarafAyir(alacakli).no,
      borclu_adi: tarafAyir(borclu).ad, borclu_tc_no: tarafAyir(borclu).no,
      borc_miktari: tutarCevir(tutar),
    });
  } else if (tur === "maas_haczi") {
    const alacakli = m.match(/ALACAKLI\s*:?\s*(.{3,160}?)\s*(?:VEKİL|BORÇLU)/i)?.[1];
    // BİTİŞ ETİKETİ DEĞİŞKEN (09.11.2026, #101): bazı yazılarda "BORÇ MİKTARI" hiç
    // yok, borçludan sonra doğrudan "Müdürlüğümüz dosya borçlusunun…" diye devam
    // ediyor. Bitişi zorunlu tutan kalıp borçluyu sessizce okuyamıyordu. Pencere
    // alınıp ilk taraf ayrıştırılıyor; tarafAyir zaten ilk eşleşmede duruyor.
    const borclu = m.match(/BORÇLU\s*:?\s*([\s\S]{3,300}?)(?:BORÇ\s*MİKTARI|Yukarıda|Müdürlüğümüz|$)/i)?.[1];
    let tutar = m.match(/BORÇ\s*MİKTARI\s*:?\s*([\d.]+,\d{2})/i)?.[1];
    if (!tutar) {
      // ETİKETSİZ TUTAR: yalnız belgede TEK BİR para değeri varsa alınır. Birden
      // çoksa hangisinin borç olduğu belli değildir ve TAHMİN EDİLMEZ — yanlış tutar,
      // boş tutardan beterdir.
      const hepsi = [...new Set((m.match(/[\d.]+,\d{2}(?=\s*TL)/g) ?? []))];
      if (hepsi.length === 1) tutar = hepsi[0];
    }
    Object.assign(sonuc, {
      alacakli_adi: tarafAyir(alacakli).ad, alacakli_vergi_no: tarafAyir(alacakli).no,
      borclu_adi: tarafAyir(borclu).ad, borclu_tc_no: tarafAyir(borclu).no,
      borc_miktari: tutarCevir(tutar),
    });
  } else if (tur === "odeme_emri") {
    const alacakli = m.match(/1-\s*Alacaklı[\s\S]{0,260}?adresi\s*:?\s*(.{5,200}?)(?:\s*vekili|\s*2-\s*Borçlu)/i)?.[1];
    const borclu = m.match(/2-\s*Borçlu[\s\S]{0,280}?(?:numarası|adresi)\s*:?\s*(.{5,200}?)(?:\s*3-|\s*Takip)/i)?.[1];
    Object.assign(sonuc, {
      alacakli_adi: tarafAyir(alacakli).ad, alacakli_vergi_no: tarafAyir(alacakli).no,
      borclu_adi: tarafAyir(borclu).ad, borclu_tc_no: tarafAyir(borclu).no,
      borc_miktari: tutarCevir(m.match(/([\d.]+,\d{2})\s*(?:TL|Türk Lirası)/i)?.[1]),
    });
  }

  // ROL DOĞRULAMASI — türden çıkarılan rol, belgedeki VKN ile tutuyor mu?
  // Tutmazsa SUSULMAZ: yanlış tarafa yazılmış bir kayıt, olmayan bir alacak demek.
  const bizBorcluyuz = bizimVknler.some((v) => v && sonuc.borclu_tc_no === v);
  if (bizBorcluyuz && sonuc.rolumuz !== "borclu") {
    sonuc.rolumuz = "borclu";
    uyarilar.push("Belgede BORÇLU bizim firmamız görünüyor; tür tespitiyle çelişiyor — elle bakılmalı.");
  }
  if (sonuc.rolumuz === "borclu") {
    uyarilar.push("ÖDEME EMRİ / ŞİRKETE TAKİP: bu bir üçüncü şahıs haciz yazısı değil, borçlu biziz. İcra defterine yazılmadı.");
  }
  if (tur === "bilinmiyor") uyarilar.push("Belge türü tanınmadı — alanlar okunamadı, elle işlenmeli.");
  for (const [alan, etiket] of [["dosya_esas_no", "dosya esas no"], ["alacakli_adi", "alacaklı"],
    ["borclu_adi", "borçlu"], ["borc_miktari", "borç miktarı"]]) {
    if (sonuc[alan] == null && tur !== "bilinmiyor") uyarilar.push(`${etiket} okunamadı`);
  }
  return sonuc;
}

/** Elle deneme: node scripts/icra-belge-oku.mjs <pdf> [vkn…] */
if (process.argv[1] && process.argv[1].endsWith("icra-belge-oku.mjs") && process.argv[2]) {
  const metin = await pdfMetni(process.argv[2]);
  console.log(JSON.stringify(belgeCozumle(metin, process.argv.slice(3)), null, 1));
}
