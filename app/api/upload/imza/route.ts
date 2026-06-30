// İmzalı yükleme URL'i — büyük dosyaları (≤50 MB) tarayıcıdan DOĞRUDAN Supabase Storage'a yüklemek için.
// Vercel'in ~4.5 MB istek gövdesi limitini baypas eder. Akış: client token alır → uploadToSignedUrl ile
// dosyayı atar → dönen publicUrl kaydedilir. Bucket yoksa public + 50 MB limitle oluşturulur.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const supabase = createClient(url, svc);
  let body: { bucket?: string; path?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  const { bucket, path } = body;
  if (!bucket || !path) return NextResponse.json({ error: "bucket ve path gerekli" }, { status: 400 });

  let imza = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (imza.error) {
    const m = imza.error.message.toLowerCase();
    if (m.includes("not found") || m.includes("does not exist")) {
      // Public bucket (publicUrl döndürebilmek için) + 50 MB limit.
      const { error: createErr } = await supabase.storage.createBucket(bucket, { public: true, fileSizeLimit: 52428800 });
      if (createErr) return NextResponse.json({ error: `Bucket "${bucket}" oluşturulamadı: ${createErr.message}` }, { status: 500 });
      imza = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    }
  }
  if (imza.error || !imza.data) return NextResponse.json({ error: imza.error?.message ?? "İmzalı URL üretilemedi" }, { status: 500 });

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
  return NextResponse.json({ token: imza.data.token, path: imza.data.path, publicUrl });
}
