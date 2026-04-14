// Evrak sayı numarası otomatik üretme API - Firma ve yıla göre sıralı numara
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { firma_id } = await request.json();
  const yil = new Date().getFullYear();

  // Mevcut sayacı bul veya oluştur
  const { data: sayac } = await supabase
    .from("evrak_sayac")
    .select("*")
    .eq("firma_id", firma_id)
    .eq("yil", yil)
    .single();

  let sonNumara = 1;
  if (sayac) {
    sonNumara = sayac.son_numara + 1;
    await supabase
      .from("evrak_sayac")
      .update({ son_numara: sonNumara })
      .eq("id", sayac.id);
  } else {
    await supabase
      .from("evrak_sayac")
      .insert({ firma_id, yil, son_numara: 1 });
  }

  const evrakSayiNo = `${yil}/${String(sonNumara).padStart(3, "0")}`;
  return NextResponse.json({ evrak_sayi_no: evrakSayiNo });
}
