// YÜKLENEN LOGOYU DÜZENLE — beyaz zemini sil, hepsini aynı tuvale ve aynı görsel
// ağırlığa getir.
//
// NEDEN: logolar farklı kaynaklardan geliyor; biri 915x971 kare, biri 7551x4151 geniş,
// biri beyaz zeminli JPG. Ham hâlleriyle kenar çubuğunda sırayla dönünce biri kocaman
// biri minnacık görünüyor, beyaz zeminli olan da koyu arka planda beyaz bir kutu gibi
// duruyordu. Yükleme sırasında burada düzeltiliyor; kullanıcı boyutla uğraşmıyor.

/** Tuval: diğer logolarla aynı (public/logolar/*.png da 700x300). */
export const LOGO_TUVAL_GEN = 700;
export const LOGO_TUVAL_YUK = 300;
/** Hedef "mürekkep" miktarı — opak piksel sayısı. Koda gömülü eski logolar
 *  13.700–26.700 aralığındaydı; ortalaması (~22.000) hedef alındı.
 *
 *  DİKKAT: dikey logolarda boyutu çoğu zaman bu değil, aşağıdaki YÜKSEKLİK PAYI
 *  belirliyor — içerik tuvalin tamamını kaplamaya çalışıp paya takılıyor. Logo
 *  büyük/küçük isteniyorsa önce EN_COK_YUK'e bakın. */
const HEDEF_OPAK = 22000;
/** Tuvalin kenarlarında bırakılan pay. %92: eski logolar 214–300 piksel yüksekliğindeydi
 *  (ortalama ~265), yeni ölçü 276 ile onun hemen yanında duruyor. */
const EN_COK_GEN = Math.round(LOGO_TUVAL_GEN * 0.90);
const EN_COK_YUK = Math.round(LOGO_TUVAL_YUK * 0.92);

export type LogoDuzenSonucu = {
  dosya: File;
  /** Kullanıcıya gösterilecek özet: ne yapıldı. */
  ozet: string;
  /** Beyaz zemin silindi mi (silinecek beyaz yoksa false). */
  beyazSilindi: boolean;
};

function tuval(g: number, y: number) {
  const c = document.createElement("canvas");
  c.width = g; c.height = y;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2d bağlamı alınamadı");
  return { c, ctx };
}

/**
 * Logoyu kullanıma hazırlar: beyaz zemini saydamlaştırır, kenar boşluklarını kırpar,
 * görsel ağırlığı eşitler ve 700x300 saydam tuvale ortalar.
 *
 * Hata fırlatır — çağıran taraf SESSİZ GEÇMEMELİ: düzenlenmemiş logo yüklenirse
 * kenar çubuğunda beyaz kutu ya da dev bir görsel olarak durur.
 */
export async function logoDuzenle(dosya: File): Promise<LogoDuzenSonucu> {
  const bitmap = await createImageBitmap(dosya);
  try {
    const { ctx } = tuval(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const G = bitmap.width, Y = bitmap.height;
    const veri = ctx.getImageData(0, 0, G, Y);
    const p = veri.data;

    // 1) BEYAZ ZEMİNİ SİL — yalnız gerçekten BEYAZ ZEMİNLİ görsellerde.
    //
    //    Zemini zaten saydam olan logolarda beyaz silinmez: oradaki beyaz tasarımın
    //    parçasıdır (ör. karma logodaki beyaz elips) ve kareden dışarı taştığı için
    //    kenardan erişilebilir — taşırma yöntemi onu da yer, logo bozulurdu.
    //    Ayırt etme: dört köşe saydamsa zemin zaten saydamdır, dokunma.
    const beyaz = (i: number) => p[i] > 228 && p[i + 1] > 228 && p[i + 2] > 228;
    const koseler = [0, (G - 1) * 4, (Y - 1) * G * 4, ((Y - 1) * G + G - 1) * 4];
    const zeminSaydam = koseler.every((i) => p[i + 3] < 24);
    const gorulen = new Uint8Array(G * Y);
    const yigin: number[] = [];
    const ekle = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= G || y >= Y) return;
      const n = y * G + x;
      if (gorulen[n]) return;
      const i = n * 4;
      if (p[i + 3] > 8 && !beyaz(i)) return;    // renkli/yarı saydam piksele çarpınca dur
      gorulen[n] = 1; yigin.push(n);
    };
    let silinen = 0;
    if (!zeminSaydam) {
      for (let x = 0; x < G; x++) { ekle(x, 0); ekle(x, Y - 1); }
      for (let y = 0; y < Y; y++) { ekle(0, y); ekle(G - 1, y); }
    }
    while (yigin.length) {
      const n = yigin.pop()!;
      const x = n % G, y = (n - x) / G;
      if (p[n * 4 + 3] !== 0) { p[n * 4 + 3] = 0; silinen++; }
      ekle(x + 1, y); ekle(x - 1, y); ekle(x, y + 1); ekle(x, y - 1);
    }
    ctx.putImageData(veri, 0, 0);

    // 2) İÇERİĞİN SINIRLARI + "mürekkep" miktarı
    let x0 = G, x1 = -1, y0 = Y, y1 = -1, opak = 0;
    for (let y = 0; y < Y; y++) for (let x = 0; x < G; x++) {
      if (p[(y * G + x) * 4 + 3] < 40) continue;
      opak++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) throw new Error("görselde içerik bulunamadı (tamamı boş ya da beyaz)");
    const icG = x1 - x0 + 1, icY = y1 - y0 + 1;

    // 3) ÖLÇEK — önce mürekkep hedefine göre, sonra tuvale sığacak şekilde kısıtla
    let olcek = Math.sqrt(HEDEF_OPAK / opak);
    olcek = Math.min(olcek, EN_COK_GEN / icG, EN_COK_YUK / icY);
    const sonG = Math.max(1, Math.round(icG * olcek));
    const sonY = Math.max(1, Math.round(icY * olcek));

    // 4) 700x300 saydam tuvale ortala
    const { c: hedef, ctx: hctx } = tuval(LOGO_TUVAL_GEN, LOGO_TUVAL_YUK);
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = "high";
    const kaynakTuval = document.createElement("canvas");
    kaynakTuval.width = G; kaynakTuval.height = Y;
    kaynakTuval.getContext("2d")!.putImageData(veri, 0, 0);
    hctx.drawImage(
      kaynakTuval, x0, y0, icG, icY,
      Math.round((LOGO_TUVAL_GEN - sonG) / 2), Math.round((LOGO_TUVAL_YUK - sonY) / 2), sonG, sonY,
    );

    const blob = await new Promise<Blob | null>((cz) => hedef.toBlob(cz, "image/png"));
    if (!blob) throw new Error("logo PNG'ye çevrilemedi");

    const ad = dosya.name.replace(/\.[^.]+$/, "") || "logo";
    return {
      dosya: new File([blob], `${ad}.png`, { type: "image/png" }),
      beyazSilindi: silinen > 0,
      ozet: `${G}×${Y} → ${LOGO_TUVAL_GEN}×${LOGO_TUVAL_YUK} (logo ${sonG}×${sonY})`
        + (silinen > 0 ? ", beyaz zemin silindi" : ""),
    };
  } finally {
    bitmap.close();
  }
}
