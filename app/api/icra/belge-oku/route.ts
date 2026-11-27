// ELLE YÜKLENEN İCRA TEBLİGATINI OKUR — UETS'ten gelenle AYNI çözümleyiciyle.
//
// ══ NİYE VAR (27.11.2026) ══
// İcra formundaki "Gözat" dosyayı yalnızca depoya atıyor, PDF'i hiç açmıyordu.
// Çözümleyici (scripts/icra-belge-oku.mjs) yalnız UETS'ten düşen tebligatlarda
// çalışıyordu. Sonuç: elle yüklenen dosyada cevap_suresi_gun boş kalıyor ve panel
// "varsayılan 7 gün" gösteriyordu. Dosya 2026/35449'da (ASIM AYKUT) yakalandı:
// belge yüklenmişti ama süre okunmamıştı. Gerçek süre de 7 çıktı — ama bu ŞANSTI;
// başka bir daire 10 ya da 15 gün yazsaydı ekran yine 7 der, kimse fark etmezdi.
//
// ══ SESSİZ GEÇMEZ (AGENTS.md) ══
// Belge inmezse ya da PDF'ten metin çıkmazsa sonuç `okundu:false` döner ve sebebi
// yazar; çağıran bunu KULLANICIYA SÖYLEMEK ZORUNDA. Alanı sessizce boş bırakıp
// varsayıma düşmek, yanlış bir "son cevap günü"ne güvenmek demek.
//
// ══ TARANMIŞ BELGE ══
// Fiziki posta ile gelen tebligatlar çoğu zaman TARAYICIDAN geçmiş görüntüdür:
// PDF'in içinde metin yoktur, tek bir resim vardır. pdfjs böyle bir dosyadan sıfır
// karakter çıkarır. Boru hattında OCR YOK, o yüzden bu durum "hata" değil ama
// sessiz de değil: ayrı bir sebep koduyla döner, kullanıcı alanları elle girer.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { storageIndir } from "@/lib/api/storage-indir";
import { pdfMetni, belgeCozumle } from "@/scripts/icra-belge-oku.mjs";

export const runtime = "nodejs";

/** Metin bu uzunluğun altındaysa PDF "metinsiz" sayılır (taranmış görüntü). */
const EN_AZ_METIN = 80;

export async function POST(request: Request) {
  // GÜVENLİK: /api middleware kapsamı dışında — kapı burada (lib/api/guvenlik).
  const kullanici = await oturum();
  if (!kullanici) return yetkisiz();

  let yol: string;
  try {
    const govde = (await request.json()) as { yol?: string };
    yol = String(govde.yol ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 });
  }
  if (!yol) return NextResponse.json({ error: "yol zorunlu" }, { status: 400 });

  // DOSYA SERVICE ROLE İLE İNER: kovalar özel, düz fetch 400 döner (AGENTS.md).
  const bayt = await storageIndir(yol);
  if (!bayt) {
    console.error(`[icra/belge-oku] belge indirilemedi: ${yol}`);
    return NextResponse.json({
      okundu: false,
      sebep: "Belge depodan indirilemedi — alanlar elle girilmeli.",
      kod: "inmedi",
    }, { status: 200 });
  }

  let metin: string;
  try {
    metin = await pdfMetni(bayt);
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    console.error(`[icra/belge-oku] PDF açılamadı: ${yol}`, mesaj);
    return NextResponse.json({
      okundu: false,
      sebep: `PDF açılamadı (${mesaj}) — alanlar elle girilmeli.`,
      kod: "acilmadi",
    }, { status: 200 });
  }

  if (metin.length < EN_AZ_METIN) {
    return NextResponse.json({
      okundu: false,
      sebep: "Belge taranmış görüntü: PDF'in içinde metin yok, okunamadı. "
        + "Cevap süresini ve alanları elle girin.",
      kod: "taranmis",
    }, { status: 200 });
  }

  // Kendi vergi numaralarımız: belgede BORÇLU biz miysek (ödeme emri) çözümleyici
  // bunu rol doğrulamasında kullanıyor.
  let vknler: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && anahtar) {
    const sb = createClient(url, anahtar, { auth: { persistSession: false } });
    const { data } = await sb.from("firmalar").select("vergi_no").not("vergi_no", "is", null);
    vknler = (data ?? []).map((f) => String(f.vergi_no).replace(/\D/g, "")).filter(Boolean);
  }

  const cozum = belgeCozumle(metin, vknler);
  return NextResponse.json({ okundu: true, cozum }, { status: 200 });
}
