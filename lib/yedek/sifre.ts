// YEDEK ŞİFRELEME — AES-256-GCM.
//
// Neden: yedekler C:\ikikatweb-yedek altında DÜZ JSON duruyordu (~1,1 GB). İçinde TC kimlik
// numaraları, ad-soyad, telefon, kasa slipleri, iş deneyim belgeleri var. Veritabanındaki RLS
// ve dosya geçidi ne kadar sıkı olursa olsun, o klasöre erişen ya da diski alan herkes her şeye
// sahip oluyordu — bütün korumaları baypas eden tek nokta orasıydı.
//
// Anahtar NEREDE: YEDEK_SIFRE_ANAHTARI ortam değişkeni (.env.local). Yedek klasörünün İÇİNDE
// DEĞİL — çalınan bir yedek diskinde anahtar bulunmaz. Anahtar kaybolursa yedekler açılmaz;
// ikinci bir kopyası parola yöneticisinde durmalı.
//
// DOSYA BİÇİMİ:
//   "IKYEDEK1" (8 bayt) | tuz (16) | iv (12) | şifreli veri (...) | doğrulama etiketi (16, SONDA)
// Etiket sonda çünkü GCM onu akış bitince üretir. Çözerken son 16 bayt etiket olarak okunur.
// Etiket sayesinde bozulmuş/oynanmış yedek SESSİZCE değil, HATA vererek ortaya çıkar.

import crypto from "crypto";
import fs from "fs";
import { pipeline } from "stream/promises";

const SIHIR = Buffer.from("IKYEDEK1", "utf8");
const TUZ_BOY = 16;
const IV_BOY = 12;
const ETIKET_BOY = 16;

export const SIFRELI_UZANTI = ".enc";

/** Şifreli dosya = ham boyut + 52 bayt (8 imza + 16 tuz + 12 iv + 16 etiket).
 *  Storage aynası "boyut eşitse tekrar indirme" kuralını bu sabitle sürdürür. */
export const SIFRE_EK_BAYT = SIHIR.length + TUZ_BOY + IV_BOY + ETIKET_BOY;

/** Anahtar tanımlı mı? Tanımsızsa yedek şifresiz yazılır (script yüksek sesle uyarır). */
export function anahtarVar(): boolean {
  return !!(process.env.YEDEK_SIFRE_ANAHTARI ?? "").trim();
}

function parola(): string {
  const p = (process.env.YEDEK_SIFRE_ANAHTARI ?? "").trim();
  if (!p) throw new Error("YEDEK_SIFRE_ANAHTARI tanımlı değil — şifreli yedek yazılamaz/çözülemez.");
  return p;
}

/** Parola + tuz → 32 baytlık anahtar. scrypt: kaba kuvvet denemesini pahalı kılar. */
function anahtarTuret(tuz: Buffer): Buffer {
  return crypto.scryptSync(parola(), tuz, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * Şifreli yazma kanalı açar. Veri `yaz()` ile parça parça verilir, `bitir()` dosyayı kapatır.
 * Akış halinde çalışır: 140 MB'lık yedek belleğe ALINMAZ.
 */
export function sifreliYazici(hedefYol: string) {
  const tuz = crypto.randomBytes(TUZ_BOY);
  const iv = crypto.randomBytes(IV_BOY);
  const sifre = crypto.createCipheriv("aes-256-gcm", anahtarTuret(tuz), iv);
  const dosya = fs.createWriteStream(hedefYol);
  dosya.write(Buffer.concat([SIHIR, tuz, iv]));

  // AKIŞ SIRASI KRİTİK: şifreleyiciyi dosyaya pipe edip `end()` geri çağrısında etiketi
  // yazmak YANLIŞ — o geri çağrı yazılabilir taraf bitince tetikleniyor, son şifreli
  // parçalar dosyaya HENÜZ yazılmamış olabiliyor ve etiket araya giriyordu (çözerken
  // "unable to authenticate data"). pipeline şifreleyicinin okunabilir tarafı bitip
  // TÜM veri dosyaya geçince çözülür; etiket ancak ondan sonra eklenir.
  const akisBitti = pipeline(sifre, dosya, { end: false });

  return {
    yaz: (metin: string | Buffer) =>
      new Promise<void>((coz, hata) => { sifre.write(metin, (e) => (e ? hata(e) : coz())); }),
    bitir: async () => {
      sifre.end();
      await akisBitti;
      await new Promise<void>((coz, hata) => {
        dosya.on("error", hata);
        dosya.end(sifre.getAuthTag(), () => coz());
      });
    },
  };
}

/** Tek seferde şifreli yazar (küçük/orta dosyalar: gün aynası, Storage dosyaları). */
export async function sifreliYaz(hedefYol: string, veri: Buffer | string): Promise<void> {
  const y = sifreliYazici(hedefYol);
  await y.yaz(veri);
  await y.bitir();
}

/** Şifreli dosyayı çözüp hedefe yazar. Etiket tutmazsa HATA verir (bozuk/oynanmış yedek). */
export async function sifreCoz(kaynakYol: string, hedefYol: string): Promise<void> {
  const boyut = fs.statSync(kaynakYol).size;
  const basBoy = SIHIR.length + TUZ_BOY + IV_BOY;
  if (boyut < basBoy + ETIKET_BOY) throw new Error("Dosya şifreli yedek değil (çok küçük).");

  const fd = fs.openSync(kaynakYol, "r");
  try {
    const bas = Buffer.alloc(basBoy);
    fs.readSync(fd, bas, 0, basBoy, 0);
    if (!bas.subarray(0, SIHIR.length).equals(SIHIR)) {
      throw new Error("Dosya şifreli yedek değil (imza uyuşmuyor).");
    }
    const tuz = bas.subarray(SIHIR.length, SIHIR.length + TUZ_BOY);
    const iv = bas.subarray(SIHIR.length + TUZ_BOY);

    const etiket = Buffer.alloc(ETIKET_BOY);
    fs.readSync(fd, etiket, 0, ETIKET_BOY, boyut - ETIKET_BOY);

    const coz = crypto.createDecipheriv("aes-256-gcm", anahtarTuret(tuz), iv);
    coz.setAuthTag(etiket);

    const govde = fs.createReadStream(kaynakYol, { start: basBoy, end: boyut - ETIKET_BOY - 1 });
    await pipeline(govde, coz, fs.createWriteStream(hedefYol));
  } finally {
    fs.closeSync(fd);
  }
}

/** Şifreli dosyayı belleğe çözer (doğrulama/karşılaştırma için — büyük dosyada kullanmayın). */
export async function sifreCozBellek(kaynakYol: string): Promise<Buffer> {
  const gecici = `${kaynakYol}.dogrulama-${process.pid}`;
  try {
    await sifreCoz(kaynakYol, gecici);
    return fs.readFileSync(gecici);
  } finally {
    try { fs.unlinkSync(gecici); } catch { /* yoksay */ }
  }
}
