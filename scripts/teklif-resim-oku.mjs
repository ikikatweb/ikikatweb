// TEKLİF RESMİNİ OKU — acentenin gönderdiği karşılaştırma tablosunu rakamlara çevirir.
//
// Neden gerek var: acentelerin bir kısmı teklifleri PDF ya da düz yazı olarak değil, kendi
// karşılaştırma ekranlarının EKRAN GÖRÜNTÜSÜ olarak gönderiyor. Bir resimde 13-14 sigorta
// şirketinin fiyatı olabiliyor; bunlar okunmadığında teklif ekranında acente başına tek satır
// kalıyor ve "hangi firma ne vermiş" görülemiyor.
//
// Klasik OCR (Tesseract) denenmedi çünkü bu tablolarda asıl zorluk yazıyı tanımak değil,
// HANGİ RAKAMIN HANGİ SATIRA ait olduğunu bilmek; satır kayması yanlış firmaya yanlış fiyat
// yazar ve bu, hiç veri olmamasından kötüdür. Görsel anlayan bir model bu eşleştirmeyi yapıyor.
//
// MODEL SEÇİMİ ÖLÇÜLDÜ: aynı tablo üç modele okutuldu, üçü de 14 firmanın 14'ünü
// (tutar + onay işareti dahil) doğru çıkardı. Haiku hem en az jetonu harcadı (1.897 giriş)
// hem en ucuz olanı, o yüzden o kullanılıyor. Tablo okumak basit bir iş; pahalı modelin
// buradaki katkısı ölçülemedi.
import Anthropic from "@anthropic-ai/sdk";

/** Resimden okunan bir satır. */
// { firma: "Neova Sigorta", tutar: 10330.46, onay: "onayli" | "bilgi" | "uyari" | null }

const SISTEM = `Sen bir sigorta acentesinin gönderdiği teklif karşılaştırma tablosunu okuyorsun.
Görseldeki HER satırı, yani her sigorta şirketini ve onun fiyatını eksiksiz çıkar.

Kurallar:
- Tutarlar Türk lirası ve Türk biçiminde yazılıdır: "11.832,44" = on bir bin sekiz yüz otuz iki lira kırk dört kuruş. JSON'a 11832.44 olarak yaz.
- Firma adını tabloda yazdığı gibi ver ("Koru Sigorta", "TürkNippon Sigorta" gibi).
- Onay sütunundaki işaret varsa aktar: yeşil tik = "onayli", mavi i = "bilgi", kırmızı ünlem = "uyari". Yoksa null.
- Tabloda kaç satır varsa hepsini döndür, atlama, uydurma.
- Plaka ve poliçe bitiş tarihi görünüyorsa onları da ver.

YALNIZCA şu biçimde JSON döndür, başka hiçbir şey yazma:
{"plaka":"60 ADG 721","bitisTarihi":"2026-09-23","satirlar":[{"firma":"Neova Sigorta","tutar":10330.46,"onay":"onayli"}]}`;

/**
 * @param {Buffer} icerik resim verisi
 * @param {string} mimeTipi image/png, image/jpeg ...
 * @param {string|null} apiAnahtari yoksa ortamdan okunur
 * @returns {Promise<{plaka:string|null, bitisTarihi:string|null, satirlar:{firma:string,tutar:number,onay:string|null}[]}>}
 */
export async function teklifResminiOku(icerik, mimeTipi, apiAnahtari = null) {
  const anahtar = apiAnahtari ?? process.env.ANTHROPIC_API_KEY;
  if (!anahtar) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const client = new Anthropic({ apiKey: anahtar });

  const yanit = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: SISTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeTipi, data: icerik.toString("base64") } },
        { type: "text", text: "Bu tablodaki tüm sigorta şirketi tekliflerini çıkar." },
      ],
    }],
  });

  // Güvenlik sınıflandırıcısı reddederse content boş gelebilir — okumadan önce bak.
  if (yanit.stop_reason === "refusal") throw new Error("Model isteği reddetti");

  const metin = yanit.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  // Model bazen JSON'u açıklama cümlesiyle sarabiliyor; ilk süslü parantezden sonuncuya kadarını al.
  const bas = metin.indexOf("{"), bit = metin.lastIndexOf("}");
  if (bas < 0 || bit <= bas) throw new Error("JSON bulunamadı: " + metin.slice(0, 120));
  const veri = JSON.parse(metin.slice(bas, bit + 1));

  const satirlar = (veri.satirlar ?? [])
    .filter((s) => s && typeof s.firma === "string" && Number.isFinite(Number(s.tutar)) && Number(s.tutar) > 0)
    .map((s) => ({ firma: String(s.firma).trim(), tutar: Number(s.tutar), onay: s.onay ?? null }));

  return { plaka: veri.plaka ?? null, bitisTarihi: veri.bitisTarihi ?? null, satirlar, jeton: yanit.usage };
}
