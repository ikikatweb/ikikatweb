// Dosya yükleme API route - Service role key ile Storage'a yükler (policy bypass)
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const bucket = formData.get("bucket") as string;
    const path = formData.get("path") as string;

    if (!file || !bucket || !path) {
      return NextResponse.json({ error: "file, bucket ve path gerekli" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Storage'dan dosya silme — service role ile (RLS bypass)
// Body: { bucket: string, path: string }
export async function DELETE(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await request.json();
    const bucket = body?.bucket as string | undefined;
    const path = body?.path as string | undefined;

    if (!bucket || !path) {
      return NextResponse.json({ error: "bucket ve path gerekli" }, { status: 400 });
    }

    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
