// Yazışma ekleri (attachment) yardımcıları.
//
// "ekler" alanı satır satır (\n) saklanır. Her satır YENİ formatta:  "ad<TAB>url"
//   - ad: kullanıcının ELLE yazdığı ek adı (boş olabilir)
//   - url: dosyanın URL'si
// ESKİ format (yalnız URL, TAB yok) ile geriye uyumludur: o durumda ad URL'den türetilir.
// TAB (\t) ayraç olarak seçildi çünkü tek satırlık ad girişinde ve URL'de bulunmaz.

export type EkItem = { ad: string; url: string };

/** URL'den dosya adı türetir (eski kayıtlar / yedek için). */
export function ekUrldenAd(url: string): string {
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.split("/").pop() ?? "");
    return name.replace(/^\d+-/, "") || "Ek";
  } catch {
    return "Ek";
  }
}

/** Tek bir "ekler" satırını {ad, url} olarak ayrıştırır. */
export function parseEk(satir: string): EkItem {
  // Sadece olası satır sonu (\r) temizlenir — baştaki TAB (boş ad göstergesi) KORUNUR.
  const line = (satir ?? "").replace(/\r$/, "");
  const tabIdx = line.indexOf("\t");
  if (tabIdx >= 0) {
    return { ad: line.slice(0, tabIdx).trim(), url: line.slice(tabIdx + 1).trim() };
  }
  const s = line.trim();
  if (/^https?:\/\//i.test(s)) {
    // Eski format: yalnız URL → ad dosya adından (görüntüleme için yedek)
    return { ad: "", url: s };
  }
  // Eski serbest metin açıklaması (URL değil)
  return { ad: s, url: "" };
}

/** {ad, url} → tek satır ("ad<TAB>url"). */
export function buildEk(ad: string, url: string): string {
  return `${(ad ?? "").trim()}\t${(url ?? "").trim()}`;
}

/** Tüm "ekler" alanını {ad, url} dizisine çevirir (boşları atar). */
export function parseEkler(ekler: string | null | undefined): EkItem[] {
  if (!ekler) return [];
  return ekler.split("\n").map(parseEk).filter((e) => e.url || e.ad);
}

/** {ad, url} dizisini "ekler" string'ine çevirir. */
export function buildEkler(items: EkItem[]): string {
  return items.filter((e) => e.url || e.ad).map((e) => buildEk(e.ad, e.url)).join("\n");
}

/** Görüntülenecek ek adı: elle yazılan ad varsa o; yoksa "Ek N" (dosya adı KULLANILMAZ). */
export function ekGosterimAdi(item: EkItem, index: number): string {
  return item.ad.trim() || `Ek ${index + 1}`;
}
