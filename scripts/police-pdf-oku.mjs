// POLİÇE PDF'İNİ OKU — kesilmiş poliçenin alanlarını çıkarır.
//
// Acente poliçeyi kestiğinde PDF'i maille gönderiyor. Bu PDF'te kayıt için gereken her şey
// yazılı: poliçe no, başlama/bitiş tarihi, brüt prim, sigorta şirketi, plaka. Elle girilmesi
// hem zaman alıyor hem de rakam/tarih yanlış yazılabiliyor.
//
// NEDEN YAPAY ZEKÂ: her sigorta şirketinin poliçe düzeni farklı. Sompo "Toplam Brüt Prim"
// yazarken bir başkası "Ödenecek Tutar" yazıyor, tarih sütunları tek satıra sıkışıyor.
// Desen yazmak her yeni şirkette kırılıyordu; metni anlayan bir model bu farkları kaldırıyor.
// Görsel değil METİN gönderiliyor (PDF'ten çıkarılmış), bu yüzden ucuz: ~2.000 jeton.
// Model: Haiku 4.5 — teklif resimlerinde üç model de aynı doğrulukta çıktı, düz metinden
// alan çıkarmak daha da kolay bir iş.
//
// GÜVENLİK: model yalnız OKUR. Eksik alan varsa kayıt açılmaz, insan eliyle girilir —
// yarım poliçe kaydı hiç kayıt olmamasından kötüdür.
import Anthropic from "@anthropic-ai/sdk";

const SISTEM = `Sen kesilmiş bir araç sigorta poliçesinin PDF metnini okuyorsun.
Poliçe kaydı için gereken alanları çıkar.

Kurallar:
- tip: "trafik" (Zorunlu Mali Sorumluluk / Trafik) ya da "kasko" (Kara Araçları / Kasko).
- sigortaFirmasi: poliçeyi kesen sigorta şirketi ("Sompo Japan Sigorta", "Neova Sigorta" gibi).
  Acente adını DEĞİL, sigorta şirketini ver.
- policeNo: poliçe numarası (yenileme no, ek no, müşteri no, acente no DEĞİL).
- baslangicTarihi / bitisTarihi: YYYY-MM-DD biçiminde.
- brutPrim: ödenecek toplam tutar ("Toplam Brüt Prim" / "Ödenecek Tutar"). Net prim değil.
  Türk biçimindeki "12.522,00" da İngiliz biçimindeki "12,522.00" da on iki bin beş yüz
  yirmi iki lira demektir; ikisini de 12522.00 olarak yaz.
- plaka: poliçedeki araç plakası, olduğu gibi.
- Bir alanı metinde bulamazsan null yaz. UYDURMA.

YALNIZCA şu biçimde JSON döndür, başka hiçbir şey yazma:
{"tip":"trafik","sigortaFirmasi":"Sompo Japan Sigorta","policeNo":"311000637641213","baslangicTarihi":"2026-09-22","bitisTarihi":"2027-09-22","brutPrim":12522.00,"plaka":"60 AES023"}`;

/**
 * @param {string} metin PDF'ten çıkarılmış düz metin
 * @param {string|null} apiAnahtari yoksa ortamdan okunur
 * @returns {Promise<{tip:string|null, sigortaFirmasi:string|null, policeNo:string|null,
 *   baslangicTarihi:string|null, bitisTarihi:string|null, brutPrim:number|null, plaka:string|null, jeton:object}>}
 */
export async function policePdfOku(metin, apiAnahtari = null) {
  const anahtar = apiAnahtari ?? process.env.ANTHROPIC_API_KEY;
  if (!anahtar) throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  const client = new Anthropic({ apiKey: anahtar });

  // İlk 6000 karakter yeter: künye, risk bilgileri ve prim tablosu poliçenin başındadır,
  // sonrası genel şartlar metnidir (sayfalarca) ve okunacak bir alan içermez.
  const yanit = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    system: SISTEM,
    messages: [{ role: "user", content: `Bu poliçe metninden alanları çıkar:\n\n${metin.slice(0, 6000)}` }],
  });

  if (yanit.stop_reason === "refusal") throw new Error("Model isteği reddetti");
  const cikti = yanit.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const bas = cikti.indexOf("{"), bit = cikti.lastIndexOf("}");
  if (bas < 0 || bit <= bas) throw new Error("JSON bulunamadı: " + cikti.slice(0, 120));
  const v = JSON.parse(cikti.slice(bas, bit + 1));

  const tarih = (t) => (typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null);
  return {
    tip: v.tip === "kasko" || v.tip === "trafik" ? v.tip : null,
    sigortaFirmasi: v.sigortaFirmasi ? String(v.sigortaFirmasi).trim() : null,
    policeNo: v.policeNo ? String(v.policeNo).trim() : null,
    baslangicTarihi: tarih(v.baslangicTarihi),
    bitisTarihi: tarih(v.bitisTarihi),
    brutPrim: Number.isFinite(Number(v.brutPrim)) && Number(v.brutPrim) > 0 ? Number(v.brutPrim) : null,
    plaka: v.plaka ? String(v.plaka).trim() : null,
    jeton: yanit.usage,
  };
}
