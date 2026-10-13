// Yüklenen belgeyi (iş deneyim belgesi / geçici kabul tutanağı) okur ve içindeki
// alanları döndürür. Karşılaştırmayı ve yazmayı İSTEMCİ yapar — bu uç nokta hiçbir
// şeyi kaydetmez, yalnız okur.
//
// Neden sunucuda: ANTHROPIC_API_KEY tarayıcıya çıkmamalı.
//
// Her alanla birlikte belgedeki KAYNAK SATIR da döner. Buna ihtiyaç var: taranmış
// belgelerde model tablo satırlarını karıştırabiliyor (bir belgede "7. madde"yi süre
// uzatımı sanıp ortaklık oranı satırındaki değeri okumuştu). Kullanıcı önerilen değeri
// kaynak satırla birlikte görüp onaylıyor; hiçbir şey kendiliğinden yazılmıyor.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

/** Belgeden okunan alanlar — hepsi santiyeler tablosundaki karşılığıyla aynı adda. */
export type BelgeAlanlari = {
  is_adi: string | null;
  ekap_belge_no: string | null;
  ihale_kayit_no: string | null;
  sozlesme_tarihi: string | null;
  sozlesme_bedeli: number | null;
  sozlesme_fiyatlariyla_gerceklesen: number | null;
  ortaklik_orani: number | null;
  isyeri_teslim_tarihi: string | null;
  is_bitim_tarihi: string | null;
  gecici_kabul_itibar_tarihi: string | null;
  gecici_kabul_tarihi: string | null;
  kesin_kabul_tarihi: string | null;
};

const SISTEM = `Sen resmî inşaat belgelerini okuyan bir asistansın. Kurallar:
- SADECE belgede YAZAN değeri döndür. Hesaplama yapma, çıkarım yapma, uydurma.
- Bir alan belgede yoksa ya da boş bırakılmışsa null döndür. Boş bırakmak hatadan iyidir.
- Her alan için o değeri okuduğun SATIRI aynen alıntıla. ALINTI, satırın BAŞLIĞINI
  (örn. "8. İlk sözleşme bedeli") ve değerini BİRLİKTE içermeli. Belge iki sütunlu bir
  tabloysa sol sütundaki başlıkla sağ sütundaki değeri tek satır hâlinde birleştir.
  Yalnız değeri yazma — başlıksız alıntı kabul edilmez ve o alan atılır.
  Alıntılayamıyorsan değer null olmalı.
- Tarihler YYYY-MM-DD. Tutarlar nokta ondalıklı sayı (23.750,00 TL → 23750.00).
- Madde numaralarına güvenme, SATIR BAŞLIĞINI oku.`;

function istem(firmaAdi: string | null): string {
  return `Bu belgeden aşağıdaki alanları çıkar. Yalnız JSON döndür, başka metin yazma:
{
 "alanlar": {
   "is_adi": string|null,
   "ekap_belge_no": string|null,
   "ihale_kayit_no": string|null,
   "sozlesme_tarihi": "YYYY-MM-DD"|null,
   "sozlesme_bedeli": number|null,
   "sozlesme_fiyatlariyla_gerceklesen": number|null,
   "ortaklik_orani": number|null,
   "isyeri_teslim_tarihi": "YYYY-MM-DD"|null,
   "is_bitim_tarihi": "YYYY-MM-DD"|null,
   "gecici_kabul_itibar_tarihi": "YYYY-MM-DD"|null,
   "gecici_kabul_tarihi": "YYYY-MM-DD"|null,
   "kesin_kabul_tarihi": "YYYY-MM-DD"|null
 },
 "alinti": { "<alan adı>": "belgedeki satır, aynen" }
}

Alanların karşılıkları:
- ekap_belge_no: belgenin ÜSTÜNDEKİ "Sayı" satırı — belgenin kendi numarası
  (ör. "2013/181799-855823-1-4" ya da "25501-Y-KK-34-1"). İhale kayıt numarası DEĞİL.
- sozlesme_bedeli: "İlk sözleşme bedeli".
- sozlesme_fiyatlariyla_gerceklesen: "Gerçekleştirilen iş tutarı" (ya da "Belge tutarı").
- ortaklik_orani: iş ortaklığıysa ${firmaAdi ? `"${firmaAdi}" firmasının` : "BİZİM firmamızın"} payı.
  DİĞER ortağın payını ALMA — belgede iki oran yazar, bizimkini seç. Alıntıda bizim firma
  adımız ve onun oranı birlikte geçmeli. Emin değilsen null.
- gecici_kabul_itibar_tarihi: "İşin geçici kabul/tasfiye veya iskan tarihi" ya da "İşin kabul tarihi".
- gecici_kabul_tarihi: YALNIZ tasdik/onay bölümünde ("TASDİK OLUNUR" gibi) elle veya
  basılı YAZILMIŞ tam tarih. Gün veya ay boş bırakılmışsa null. Belgenin üstündeki
  evrak tarihini BURAYA YAZMA.`;
}

/**
 * ALINTI DENETİMİ. Model doğru değeri okuyup YANLIŞ SATIRA bağlayabiliyor: bir geçici
 * kabul tutanağında "7. Süre Uzatımı: 153 Gün" satırını iş süresi sanmıştı, "9. İşin
 * Bitirildiği Tarih"i de geçici kabul tarihi. Değerler belgede gerçekten vardı, satır
 * yanlıştı — bu yüzden alıntı sadece gösterilmiyor, DENETLENİYOR: alıntılanan satırın
 * başlığı alana uymuyorsa öneri hiç çıkmaz.
 */
const SATIR_IZI: Record<keyof BelgeAlanlari, { olmali: RegExp; olmamali?: RegExp }> = {
  // Türkçe büyük İ (U+0130) /i/i ile EŞLEŞMEZ — belgelerde başlıklar "İşin Adı",
  // "İhale Kayıt No" diye geçiyor, bu yüzden sınıflara İ ayrıca yazılıyor.
  is_adi:                            { olmali: /[iİ][şs]in ad/i },
  ekap_belge_no:                     { olmali: /say[ıi]|belge no/i, olmamali: /ihale kay|tutar/i },
  ihale_kayit_no:                    { olmali: /[iİ]hale kay[ıi]t|[iİ]KN/i },
  sozlesme_tarihi:                   { olmali: /s[öo]zle[şs]me\s*tarih/i },
  sozlesme_bedeli:                   { olmali: /s[öo]zle[şs]me bedel/i, olmamali: /toplam/i },
  sozlesme_fiyatlariyla_gerceklesen: { olmali: /ger[çc]ekle[şs]|belge tutar/i },
  ortaklik_orani:                    { olmali: /ortak/i },
  isyeri_teslim_tarihi:              { olmali: /teslim/i },
  // "Süre Uzatımlı İş Bitim Tarihi" ayrı bir alan (sure_uzatimli_tarih); sözleşmeye
  // göre bitim tarihinin yerine yazılmamalı.
  is_bitim_tarihi:                   { olmali: /bitim/i, olmamali: /uzat/i },
  gecici_kabul_itibar_tarihi:        { olmali: /kabul|iskan/i, olmamali: /tasdik|kesin kabul/i },
  gecici_kabul_tarihi:               { olmali: /tasdik|onay/i },
  kesin_kabul_tarihi:                { olmali: /kesin kabul/i },
};

/** Türkçe harfleri sadeleştirip büyütür — "İ"nin /i/i ile eşleşmemesi sorununu da çözer. */
function trNorm(x: string): string {
  return x.toLocaleUpperCase("tr")
    .replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C");
}
/** Noktalama atılarak karşılaştırır: belgede "KAD-TEM", anahtarda "KADTEM" yazıyor. */
const sadeles = (x: string) => trNorm(x).replace(/[^A-Z0-9]/g, "");
const trIcerir = (metin: string, parca: string) => sadeles(metin).includes(sadeles(parca));

/** Firma adından ayırt edici ilk kelime ("Kad-Tem Müh. …" → "KADTEM"). */
function firmaAnahtari(ad: string | null): string | null {
  if (!ad) return null;
  const ilk = trNorm(ad).replace(/[^A-Z0-9 ]/g, "").split(/\s+/).find((p) => p.length >= 4);
  return ilk ?? null;
}

function alintiylaDogrula(
  alanlar: Partial<BelgeAlanlari>,
  alinti: Record<string, string>,
  firmaIzi: string | null,
): { alanlar: Partial<BelgeAlanlari>; elenen: { alan: string; sebep: string }[] } {
  const temiz: Record<string, unknown> = {};
  const elenen: { alan: string; sebep: string }[] = [];
  for (const [alan, deger] of Object.entries(alanlar)) {
    if (deger == null || deger === "") continue;
    const iz = SATIR_IZI[alan as keyof BelgeAlanlari];
    const satir = alinti[alan];
    if (!iz) { temiz[alan] = deger; continue; }
    if (!satir) { elenen.push({ alan, sebep: "kaynak satır verilmedi" }); continue; }
    // Ortaklık oranında hangi ORTAĞIN payı olduğu kritik: belgede iki oran yazıyor ve
    // model bir kez karşı tarafınkini (Kadıoğlu %51) döndürdü. Bizim firmanın adı
    // alıntıda geçmiyorsa öneri atılır.
    if (alan === "ortaklik_orani" && firmaIzi && !trIcerir(satir, firmaIzi)) {
      elenen.push({ alan, sebep: `hangi ortağın payı belirsiz: "${satir.slice(0, 60)}"` });
      continue;
    }
    if (!iz.olmali.test(trNorm(satir)) && !iz.olmali.test(satir)) {
      elenen.push({ alan, sebep: `satır uymuyor: "${satir.slice(0, 60)}"` }); continue;
    }
    if (iz.olmamali?.test(satir)) { elenen.push({ alan, sebep: `yanlış satır: "${satir.slice(0, 60)}"` }); continue; }
    temiz[alan] = deger;
  }
  return { alanlar: temiz as Partial<BelgeAlanlari>, elenen };
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } },
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

  const anahtar = process.env.ANTHROPIC_API_KEY;
  if (!anahtar) return NextResponse.json({ error: "ANTHROPIC_API_KEY tanımlı değil" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url : null;
  const firmaAdi = typeof body.firma_adi === "string" ? body.firma_adi : null;
  if (!url) return NextResponse.json({ error: "url gerekli" }, { status: 400 });

  // Yalnız kendi depomuzdaki belgeler okunur — dışarıdan verilen adresle istek yaptırılmasın.
  if (!url.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/`)) {
    return NextResponse.json({ error: "Geçersiz belge adresi" }, { status: 400 });
  }

  try {
    const r = await fetch(url);
    if (!r.ok) return NextResponse.json({ error: `Belge indirilemedi (${r.status})` }, { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    // 30 MB üstü belgeyi modele göndermeyiz; tarama çok yüksek çözünürlükte olabiliyor.
    if (buf.length > 30 * 1024 * 1024) {
      return NextResponse.json({ error: "Belge çok büyük (30 MB üstü)" }, { status: 413 });
    }

    const client = new Anthropic({ apiKey: anahtar });
    const cevap = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: SISTEM,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
        { type: "text", text: istem(firmaAdi) },
      ]}],
    });

    const metin = cevap.content.find((c) => c.type === "text")?.text ?? "";
    const m = metin.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Belge okunamadı" }, { status: 422 });
    const cozulen = JSON.parse(m[0]) as { alanlar?: Partial<BelgeAlanlari>; alinti?: Record<string, string> };
    const { alanlar, elenen } = alintiylaDogrula(cozulen.alanlar ?? {}, cozulen.alinti ?? {}, firmaAnahtari(firmaAdi));

    return NextResponse.json({
      alanlar,
      alinti: cozulen.alinti ?? {},
      elenen,
      jeton: { giris: cevap.usage.input_tokens, cikis: cevap.usage.output_tokens },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Belge okunamadı" }, { status: 500 });
  }
}
