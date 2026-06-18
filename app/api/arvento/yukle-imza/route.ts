// Arvento Excel için imzalı yükleme URL'i üretir.
// Amaç: büyük .xlsx dosyalarını tarayıcıdan DOĞRUDAN Supabase Storage'a yüklemek,
// böylece Vercel serverless'in ~4.5MB istek gövdesi limitine takılmamak.
// Akış: tarayıcı bu route'tan token alır → uploadToSignedUrl ile dosyayı Storage'a atar
//       → /api/arvento'ya { bucket, path } gönderir → sunucu Storage'dan okuyup işler.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "arvento-gecici"; // geçici yükleme kovası (private)

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = (await request.json().catch(() => ({}))) as { dosyaAdi?: string };
    const ham = (body.dosyaAdi ?? "rapor.xlsx").toString();
    // Dosya adını güvenli hale getir (Türkçe/boşluk/özel karakter temizle)
    const guvenli = ham
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(-80) || "rapor.xlsx";
    const path = `yukleme/${Date.now()}-${guvenli}`;

    // İmzalı yükleme URL'i üret. Bucket yoksa oluşturup tekrar dene.
    let imza = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (imza.error) {
      const m = imza.error.message.toLowerCase();
      if (m.includes("not found") || m.includes("does not exist")) {
        const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
          public: false,
          fileSizeLimit: 52428800, // 50 MB
        });
        if (createErr) {
          return NextResponse.json(
            { error: `Bucket "${BUCKET}" oluşturulamadı: ${createErr.message}` },
            { status: 500 },
          );
        }
        imza = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      }
    }

    if (imza.error || !imza.data) {
      return NextResponse.json(
        { error: imza.error?.message ?? "İmzalı URL üretilemedi" },
        { status: 500 },
      );
    }

    return NextResponse.json({ bucket: BUCKET, path, token: imza.data.token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
