// SAYFA TANITIM VİDEOSU — "Sayfayı Tanı" penceresinin video adresini verir.
//
// Videolar ÖZEL `tanitim` kovasında durur (bkz. AGENTS.md: haberler dışındaki kovalar özel).
// Bu uç oturumu doğrular, kovada <slug>.<uzanti> dosyasını arar ve kısa ömürlü İMZALI adres
// döner. Tarayıcı videoyu doğrudan Supabase'den çeker → ileri/geri sarma (range) sorunsuz çalışır.
//
// SESSİZ HATA YOK: kova okunamazsa ya da imza alınamazsa 502 + neden döner; arayüz bunu
// kullanıcıya yazar. "Video yok" ile "video alınamadı" birbirine karıştırılmaz.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { TANITIM_KOVA, TANITIM_UZANTILAR, slugGecerli } from "@/lib/tanitim/sayfalar";

export const dynamic = "force-dynamic";

/** İmza ömrü: uzun videoyu durdurup devam ettirmeye yetsin diye 2 saat. */
const IMZA_SANIYE = 7200;

export async function GET(request: Request) {
  if (!(await oturum())) return yetkisiz();

  const slug = new URL(request.url).searchParams.get("sayfa") ?? "";
  if (!slugGecerli(slug)) {
    return NextResponse.json({ error: "Bilinmeyen sayfa" }, { status: 400 });
  }

  const proje = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const servis = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!proje || !servis) {
    return NextResponse.json({ error: "Sunucu ayarı eksik (Supabase anahtarları)" }, { status: 500 });
  }

  const sb = createClient(proje, servis, { auth: { persistSession: false } });

  const { data: dosyalar, error } = await sb.storage.from(TANITIM_KOVA).list("", { limit: 1000 });
  if (error) {
    // Kova hiç oluşturulmadıysa da buraya düşer. Nedeni aynen taşı.
    return NextResponse.json(
      { error: `Video deposu okunamadı: ${error.message}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const adlar = (dosyalar ?? []).map((d) => d.name);
  const dosya = adlar.find((n) => TANITIM_UZANTILAR.some((u) => n.toLowerCase() === `${slug}.${u}`));
  if (!dosya) {
    return NextResponse.json({ var: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data, error: imzaHatasi } = await sb.storage.from(TANITIM_KOVA).createSignedUrl(dosya, IMZA_SANIYE);
  if (imzaHatasi || !data?.signedUrl) {
    return NextResponse.json(
      { error: `Video adresi alınamadı: ${imzaHatasi?.message ?? "imzalı adres boş döndü"}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { var: true, url: data.signedUrl, dosya },
    { headers: { "Cache-Control": "no-store" } },
  );
}
