// EVRAK METNİ ↔ SEÇİLİ ŞANTİYE UYUMU
//
// Dilekçe gövdesinde iş adı zaten tam yazılıyor:
//   "Taahhüdümüz altında yapımı tamamlanan Tokat İl Tarım ve Orman Müdürlüğü Lojman
//    Binası Bakım Onarım Ve Tadilat İşi işimiz ..."
// Ama evrak bambaşka bir şantiyeye bağlanabiliyor ve bu HİÇBİR YERDE göze çarpmıyor:
// basılan dilekçede şantiye adı yazmaz. Oysa prim uyarısı, geçici kabul takibi, bordro
// özeti — hepsi santiye_id'ye asılı. 02-03.11.2026'da iki evrak yanlış şantiyeye
// bağlandığı için geçici kabul dilekçesindeki eksik prim uyarısı hiç çıkmadı.
//
// Burası metinden iş adını EŞLEŞTİRİR; karar vermez. Kullanan taraf (giden evrak formu)
// uyarıyı gösterir, kaydı kullanıcı onaylar.

/** Türkçe harfleri sadeleştirip büyütür. toLowerCase KULLANILMAZ: "İ" → "i̇" olur. */
function trNorm(x: string): string {
  return String(x ?? "").toLocaleUpperCase("tr")
    .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/Â/g, "A").replace(/Î/g, "I").replace(/Û/g, "U");
}

/** HTML etiketlerini atar — gövde editörden HTML geliyor. */
function htmlSiz(x: string): string {
  return String(x ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#\d+;/g, " ");
}

// KISALTMALAR — aynı iş iki türlü yazılıyor:
//   "Tokat Zile Ovası 2. Kısım Arazi Toplulaştırma ve Tarla İçi Geliştirme Hizmetleri"
//   "Tokat Zile Ovası 2. Kısım A.T. ve T.İ.G.H."
// Kısaltma noktalı yazıldığı için kelimelere bölününce tek harfler kalıyor ve hiçbir şey
// eşleşmiyordu. Şantiye adlarında da her iki biçim var ("At Ve Tigh Projesi", "A.T Ve
// T.İ.G.H"), yani sorun iki yönlü. Burada ikisi de AYNI anahtara çevrilir.
// Sıra önemli: "AT VE TIGH" kalıbı, tek başına TIGH kuralından ÖNCE çalışmalı.
const KISALTMALAR: [RegExp, string][] = [
  [/\bAT\s+VE\s+TIGH\b/g, "ARAZITOPLULASTIRMA VE TARLAICIGELISTIRME"],
  // Noktalı "A.T." — noktasız "AT" tek başına ALINMAZ, Türkçede ayrı bir kelime.
  [/\bA\s*\.\s*T\s*\.?/g, "ARAZITOPLULASTIRMA"],
  [/\bT\s*\.\s*I\s*\.\s*G\s*\.\s*H\s*\.?/g, "TARLAICIGELISTIRME"],
  [/\bTIGH\b/g, "TARLAICIGELISTIRME"],
  [/\bARAZI\s+TOPLULASTIR(MA|MASI|ILMASI|ILMASINA)\b/g, "ARAZITOPLULASTIRMA"],
  [/\bTARLA\s+ICI\s+GELISTIRME\b/g, "TARLAICIGELISTIRME"],
];

/** Kısaltmayı ve uzun adı aynı anahtara indirger. */
function kisaltmalariAc(n: string): string {
  let x = n;
  for (const [re, yerine] of KISALTMALAR) x = x.replace(re, yerine);
  return x;
}

// Hemen her işin adında geçen kelimeler AYIRT ETMEZ; atılır. Yoksa "Bakım Onarım
// Yapım İşi" ortaklığı iki alakasız şantiyeyi birbirine benzetiyor.
const DUR = new Set([
  "VE", "ILE", "ICIN", "ISI", "ISIM", "ISIMIZ", "ISIMIZE", "ISININ", "ISLERI", "ISLERININ",
  "YAPIM", "YAPIMI", "YAPIMINA", "YAPILMASI", "YAPILAN", "BINA", "BINASI", "BINASININ",
  "ADET", "NOLU", "TAAHHUDUMUZ", "ALTINDA", "TAMAMLANAN", "TAMAMLANMASI", "DEVAM", "EDILEN",
  "ONARIM", "ONARIMI", "BAKIM", "TADILAT", "TADILATI", "INSAAT", "INSAATI", "YAPI",
  "MUDURLUGU", "MUDURLUGUNE", "MUDURLUGUNUN", "ILCE", "ILI", "ILCESI", "SUBESI",
  "LTD", "STI", "SAN", "TIC", "YILI", "GENEL", "HIZMET",
]);

/** Anlamlı kelimeler: 3 harften kısa ve herkeste geçen kelimeler elenir. */
function kelimeler(x: string): string[] {
  return kelimelerNormdan(kisaltmalariAc(trNorm(x)));
}

/** Zaten sadeleştirilmiş metinden kelimeler — aynı metni iki kez normalleştirmemek için
 *  (kısım numaraları da aynı sadeleştirilmiş metinden okunuyor). */
function kelimelerNormdan(n: string): string[] {
  return n.split(/[^A-Z0-9]+/).filter((k) => k.length >= 3 && !DUR.has(k));
}

export type SantiyeAdi = { id: string; is_adi: string };

/** Kaç şantiyede geçtiğine göre kelime ağırlığı — "KAMPUS" gibi nadir kelime,
 *  "TOKAT" gibi her işte geçen kelimeden daha çok şey söyler. */
function agirlikTablosu(santiyeler: SantiyeAdi[]) {
  const df = new Map<string, number>();
  const tokens = new Map<string, string[]>();
  for (const s of santiyeler) {
    const t = [...new Set(kelimeler(s.is_adi))];
    tokens.set(s.id, t);
    for (const k of t) df.set(k, (df.get(k) ?? 0) + 1);
  }
  return { tokens, agirlik: (k: string) => 1 / Math.log2(1 + (df.get(k) ?? 1)) };
}

/** Şantiye adının kaçta kaçı metinde geçiyor (ağırlıklı). 0-1. */
function skor(metinKelimeleri: Set<string>, sTokens: string[], agirlik: (k: string) => number): number {
  if (sTokens.length === 0) return 0;
  let bulunan = 0, toplam = 0;
  for (const k of sTokens) {
    const w = agirlik(k);
    toplam += w;
    if (metinKelimeleri.has(k)) bulunan += w;
  }
  return toplam ? bulunan / toplam : 0;
}

// KISIM NUMARASI AYRI İHALEDİR. "Tokat Zile Ovası 1. Kısım" ile "2. Kısım" farklı
// işler, farklı sözleşmeler. Adları tek bir rakam dışında birebir aynı olduğu için
// kelime benzerliği ikisini ayıramıyor (tek haneli kelimeler zaten eleniyor) ve
// eşleştirici kararsız kalıp susuyordu. Bu yüzden kısım numarası BENZERLİK DEĞİL,
// VETO olarak çalışır: metinde kısım numarası geçiyorsa, başka numaralı şantiyeler
// aday olmaktan çıkar.
//
// Metinde birden çok kısım anılıyorsa ("1. kısımda olduğu gibi 2. kısımda da...")
// hiçbiri elenmez — küme olarak bakılır, yanlış alarm çıkmasın.
const KISIM_KALIBI = /\b([0-9]+[A-Z]?|[IVX]+)\s*\.?\s*KIS(IM|MI|MINA|MININ|IMDA|IMDAKI)\b/g;

/** Roma rakamını Arap'a çevirir ("II" → "2"); zaten rakamsa olduğu gibi döner.
 *  Şantiye adlarında ikisi de var: "Iı. Kısım (Temecük)" ve "2. Kısım". */
function kisimSayisi(ham: string): string {
  if (/^[0-9]/.test(ham)) return ham;
  const d: Record<string, number> = { I: 1, V: 5, X: 10 };
  let t = 0;
  for (let i = 0; i < ham.length; i++) {
    const v = d[ham[i]] ?? 0, son = d[ham[i + 1]] ?? 0;
    t += v < son ? -v : v;
  }
  return t > 0 ? String(t) : ham;
}

/** Sadeleştirilmiş metinde anılan bütün kısım numaraları. */
function kisimlar(n: string): Set<string> {
  const k = new Set<string>();
  for (const m of n.matchAll(KISIM_KALIBI)) k.add(kisimSayisi(m[1]));
  return k;
}

// Eşikler 88 giden evrakın tamamı üzerinde ölçüldü (03.11.2026): 82 evrakta metinden
// iş adı aranabiliyor, bu eşiklerle 2'sinde uyarı çıkıyor ve İKİSİ DE gerçek hata.
// Yanlış alarm yok. Eşikleri düşürmeden önce aynı ölçümü tekrarlayın.
const EN_AZ_SKOR = 0.6;      // metindeki iş, şantiye adını bu oranda karşılamalı
const EN_AZ_FARK = 0.35;     // seçili şantiyeden bu kadar iyi olmalı

export type EslesmeSonucu = {
  /** Metinde adı geçen şantiye — seçiliden belirgin şekilde daha iyi uyuyor. */
  metindeki: SantiyeAdi;
  metindekiSkor: number;
  seciliSkor: number;
  /** Aynı puanda BAŞKA iş(ler) de var: metin hangisi olduğunu söylemiyor (ör. kısım
   *  numarası yazılmamış). Uyarı yine doğrudur — seçili iş kesinlikle yanlış — ama
   *  "şunu seç" demek yanıltır; arayüz tek tıkla düzeltmeyi gizler. */
  belirsiz: boolean;
};

/**
 * Metindeki iş adı, SEÇİLİ şantiyeden başka bir şantiyeyi mi gösteriyor?
 *
 * null döner:
 *   - metinde iş adı aranacak kadar kelime yoksa (kısa yazı, "ekte sunulmuştur" vb.)
 *   - en iyi eşleşme zaten seçili şantiyeyse
 *   - fark eşiklerin altındaysa (kararsız kalındıysa SUSAR — yanlış alarm, uyarıyı
 *     değersizleştirip kullanıcıya refleksle geçirtir)
 */
export function santiyeUyumsuzlugu(
  konu: string | null | undefined,
  metin: string | null | undefined,
  seciliSantiyeId: string | null | undefined,
  santiyeler: SantiyeAdi[],
): EslesmeSonucu | null {
  if (!seciliSantiyeId || santiyeler.length === 0) return null;
  const metinNorm = kisaltmalariAc(trNorm(htmlSiz(String(metin ?? "")) + " " + String(konu ?? "")));
  const metinKelimeleri = new Set(kelimelerNormdan(metinNorm));
  if (metinKelimeleri.size < 4) return null;   // iş adı yazılmamış

  // Metinde kısım numarası geçiyorsa, BAŞKA numaralı şantiyeler aday olamaz (veto).
  const metinKisimlari = kisimlar(metinNorm);
  const kisimUyar = (adi: string): boolean => {
    if (metinKisimlari.size === 0) return true;          // metinde kısım yok → ayırt etmez
    const k = kisimlar(kisaltmalariAc(trNorm(adi)));
    if (k.size === 0) return true;                        // işin adında kısım yok → ayırt etmez
    for (const x of k) if (metinKisimlari.has(x)) return true;
    return false;                                         // numaralar tutmuyor → eleme
  };

  const { tokens, agirlik } = agirlikTablosu(santiyeler);
  const secili = santiyeler.find((s) => s.id === seciliSantiyeId);
  // Seçili şantiyenin kısmı metindekiyle tutmuyorsa puanı SIFIR: ad birebir aynı olsa
  // bile başka bir ihaledir.
  const seciliSkor = secili && !kisimUyar(secili.is_adi)
    ? 0
    : skor(metinKelimeleri, tokens.get(seciliSantiyeId) ?? [], agirlik);

  let enIyi: SantiyeAdi | null = null, enIyiSkor = 0;
  for (const s of santiyeler) {
    if (!kisimUyar(s.is_adi)) continue;
    const sk = skor(metinKelimeleri, tokens.get(s.id) ?? [], agirlik);
    if (sk > enIyiSkor) { enIyiSkor = sk; enIyi = s; }
  }
  if (!enIyi || enIyi.id === seciliSantiyeId) return null;
  if (enIyiSkor < EN_AZ_SKOR || enIyiSkor - seciliSkor < EN_AZ_FARK) return null;
  // Başa baş giden başka iş var mı? ("1. Kısım" / "2. Kısım" ikilisinde metin kısmı
  // yazmıyorsa ikisi de aynı puanı alır.)
  const esit = santiyeler.some((s) =>
    s.id !== enIyi!.id && kisimUyar(s.is_adi)
    && skor(metinKelimeleri, tokens.get(s.id) ?? [], agirlik) >= enIyiSkor - 0.02);
  return { metindeki: enIyi, metindekiSkor: enIyiSkor, seciliSkor, belirsiz: esit };
}
