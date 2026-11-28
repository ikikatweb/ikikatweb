// AKIŞ HALİNDE ZIP YAZICI — sıkıştırmasız ("store" yöntemi).
//
// Neden kendi yazıcımız (28.11.2026): dosya yedeği JSZip ile alınıyordu ve JSZip bütün
// dosyaları önce belleğe topluyor, sonra tek parça ZIP üretiyordu. 1.508 dosya / 765 MB
// ile bu hem belleği doldurur hem de tek cevabı sona kadar bekletir; üretimde ölçtüm,
// 300,3 saniyede 504 FUNCTION_INVOCATION_TIMEOUT veriyordu — yedek hiç alınamıyordu.
//
// Buradaki yazıcı her dosyayı indirir indirmez ZIP'e yazıp bırakır: bellekte aynı anda
// yalnız o dosya durur, indirme de ilk saniyede başlar.
//
// SIKIŞTIRMA YOK, bilerek: depodaki dosyalar PDF, JPEG, PNG ve MP4 — hepsi zaten
// sıkıştırılmış. DEFLATE bunlarda neredeyse hiç yer kazandırmaz ama 765 MB'ı sıkıştırmak
// süre bütçesinin önemli kısmını yer. "Store" ile ZIP, dosyaların toplamı kadar olur.
//
// Biçim: APPNOTE 6.3.x, ZIP64 YOK. Arşiv 4 GB'ı ya da 65.535 dosyayı aşarsa bu biçim
// yetmez; yazıcı o durumda hata fırlatır (bozuk ZIP üretip sessiz kalmaktan iyidir).

const ZIP64_SINIR = 0xffffffff;        // 4 GB − 1
const DOSYA_SINIRI = 0xffff;           // 65.535 kayıt

// ── CRC32 ───────────────────────────────────────────────────────────────────────
const CRC_TABLOSU = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(veri: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < veri.length; i++) c = CRC_TABLOSU[(c ^ veri[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Küçük yazma yardımcıları (ZIP her alanı little-endian tutar) ────────────────
function u16(d: DataView, o: number, v: number) { d.setUint16(o, v, true); }
function u32(d: DataView, o: number, v: number) { d.setUint32(o, v >>> 0, true); }

/** Tarihi ZIP'in beklediği eski DOS biçimine çevirir. */
function dosTarih(t: Date): { saat: number; tarih: number } {
  const yil = Math.max(1980, t.getFullYear());
  return {
    saat: (t.getHours() << 11) | (t.getMinutes() << 5) | Math.floor(t.getSeconds() / 2),
    tarih: ((yil - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate(),
  };
}

type Kayit = {
  ad: Uint8Array;
  crc: number;
  boyut: number;
  offset: number;
  saat: number;
  tarih: number;
};

export class ZipAkis {
  private kayitlar: Kayit[] = [];
  private offset = 0;
  private bitti = false;

  /** @param yaz üretilen her parçayı tüketiciye verir (ör. ReadableStream kuyruğu) */
  constructor(private readonly yaz: (parca: Uint8Array) => void) {}

  get dosyaSayisi(): number { return this.kayitlar.length; }
  get yazilanBayt(): number { return this.offset; }

  /** Bir dosyayı ZIP'e yazar. İçerik burada bırakılır; çağıran tamponu tutmak zorunda değil. */
  dosyaEkle(ad: string, icerik: Uint8Array, zaman = new Date()): void {
    if (this.bitti) throw new Error("ZIP kapatıldı, dosya eklenemez.");
    if (this.kayitlar.length >= DOSYA_SINIRI) {
      throw new Error(`ZIP dosya sınırı aşıldı (${DOSYA_SINIRI}) — ZIP64 gerekir.`);
    }
    const adBayt = new TextEncoder().encode(ad.replace(/\\/g, "/"));
    const crc = crc32(icerik);
    const { saat, tarih } = dosTarih(zaman);

    const basligim = new Uint8Array(30 + adBayt.length);
    const d = new DataView(basligim.buffer);
    u32(d, 0, 0x04034b50);          // yerel dosya başlığı imzası
    u16(d, 4, 20);                  // gereken sürüm (2.0)
    u16(d, 6, 0x0800);              // bayrak: dosya adı UTF-8
    u16(d, 8, 0);                   // yöntem: 0 = store
    u16(d, 10, saat);
    u16(d, 12, tarih);
    u32(d, 14, crc);
    u32(d, 18, icerik.length);      // sıkıştırılmış boyut (= asıl, store)
    u32(d, 22, icerik.length);      // asıl boyut
    u16(d, 26, adBayt.length);
    u16(d, 28, 0);                  // ek alan yok
    basligim.set(adBayt, 30);

    this.kayitlar.push({ ad: adBayt, crc, boyut: icerik.length, offset: this.offset, saat, tarih });
    this.yaz(basligim);
    this.yaz(icerik);
    this.offset += basligim.length + icerik.length;
    if (this.offset > ZIP64_SINIR) {
      throw new Error("ZIP 4 GB'ı aştı — ZIP64 gerekir, arşivi kova kova alın.");
    }
  }

  /** Merkezi dizini ve kapanış kaydını yazar. Bundan sonra dosya eklenemez. */
  bitir(): void {
    if (this.bitti) return;
    this.bitti = true;
    const dizinBaslangic = this.offset;

    for (const k of this.kayitlar) {
      const b = new Uint8Array(46 + k.ad.length);
      const d = new DataView(b.buffer);
      u32(d, 0, 0x02014b50);        // merkezi dizin başlığı imzası
      u16(d, 4, 20);                // yazan sürüm
      u16(d, 6, 20);                // gereken sürüm
      u16(d, 8, 0x0800);            // bayrak: UTF-8
      u16(d, 10, 0);                // yöntem: store
      u16(d, 12, k.saat);
      u16(d, 14, k.tarih);
      u32(d, 16, k.crc);
      u32(d, 20, k.boyut);
      u32(d, 24, k.boyut);
      u16(d, 28, k.ad.length);
      u16(d, 30, 0);                // ek alan
      u16(d, 32, 0);                // yorum
      u16(d, 34, 0);                // başladığı disk
      u16(d, 36, 0);                // iç özellikler
      u32(d, 38, 0);                // dış özellikler
      u32(d, 42, k.offset);         // yerel başlığın yeri
      b.set(k.ad, 46);
      this.yaz(b);
      this.offset += b.length;
    }

    const son = new Uint8Array(22);
    const d = new DataView(son.buffer);
    u32(d, 0, 0x06054b50);                          // kapanış kaydı imzası
    u16(d, 4, 0);                                   // disk no
    u16(d, 6, 0);                                   // dizinin olduğu disk
    u16(d, 8, this.kayitlar.length);                // bu diskteki kayıt
    u16(d, 10, this.kayitlar.length);               // toplam kayıt
    u32(d, 12, this.offset - dizinBaslangic);       // dizin boyutu
    u32(d, 16, dizinBaslangic);                     // dizinin yeri
    u16(d, 20, 0);                                  // arşiv yorumu yok
    this.yaz(son);
    this.offset += son.length;
  }
}
