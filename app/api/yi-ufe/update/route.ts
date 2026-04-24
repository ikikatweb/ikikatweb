// Yi-ÜFE tek kayıt güncelleme API route — service role key ile RLS bypass
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
    const { yil, ay, endeks } = await request.json();

    if (!yil || !ay || endeks == null) {
      return NextResponse.json({ error: "yil, ay ve endeks zorunludur" }, { status: 400 });
    }

    // 2020 ve sonrası verilere manuel müdahale yasak — otomatik scrape ile güncelleniyor
    if (yil >= 2020) {
      return NextResponse.json({
        error: "2020 ve sonrası Yi-ÜFE verilerine manuel müdahale edilemez. Veri Tanımlamalar > Yi-ÜFE otomatik çekme ile TÜİK'ten alınır.",
      }, { status: 403 });
    }

    // Endeks değeri mantıklı olmalı (saçma 1 gibi değerler engellensin)
    if (typeof endeks !== "number" || endeks <= 0 || !Number.isFinite(endeks)) {
      return NextResponse.json({ error: "Geçersiz endeks değeri" }, { status: 400 });
    }

    // Mevcut kayıt var mı?
    const { data: mevcut } = await supabase
      .from("yi_ufe")
      .select("id")
      .eq("yil", yil)
      .eq("ay", ay)
      .maybeSingle();

    if (mevcut) {
      const { error } = await supabase
        .from("yi_ufe")
        .update({ endeks })
        .eq("id", mevcut.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase
        .from("yi_ufe")
        .insert({ yil, ay, endeks });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ basarili: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Hata" }, { status: 500 });
  }
}
