// Giden evrak sayı no üretme API - FIRMA-YY/MUHATAP.SIRA formatı (örn: KAD-26/DSİ.001)
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { firma_id, muhatap_id } = await request.json();
  if (!firma_id) {
    return NextResponse.json({ error: "firma_id zorunlu" }, { status: 400 });
  }

  const yil = new Date().getFullYear();
  const yil2 = String(yil).slice(-2);

  // Firma kısa adını al
  const { data: firma } = await supabase
    .from("firmalar")
    .select("kisa_adi, firma_adi")
    .eq("id", firma_id)
    .single();

  if (!firma) {
    return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 });
  }

  const firmaKisa = (firma.kisa_adi || firma.firma_adi.split(/\s+/).map((w: string) => w[0]).join("")).toLocaleUpperCase("tr-TR");

  // Muhatap kısa adını al (varsa)
  let muhatapKisa = "GENEL";
  if (muhatap_id) {
    const { data: muhatap } = await supabase
      .from("tanimlamalar")
      .select("kisa_ad, deger")
      .eq("id", muhatap_id)
      .single();
    if (muhatap?.kisa_ad) {
      muhatapKisa = muhatap.kisa_ad.toLocaleUpperCase("tr-TR");
    }
  }

  // Tablodaki tüm evraklardan (aktif + silinen sekmesindeki) kullanılan numaraları bul
  // Kalıcı silinen evraklar tabloda olmadığı için otomatik hariç kalır
  const prefix = `${firmaKisa}-${yil2}/${muhatapKisa}.`;
  const { data: mevcutEvraklar } = await supabase
    .from("giden_evrak")
    .select("evrak_sayi_no")
    .like("evrak_sayi_no", `${prefix}%`);

  let enYuksek = 0;
  if (mevcutEvraklar) {
    for (const e of mevcutEvraklar) {
      const parcalar = (e.evrak_sayi_no as string).split(".");
      const num = parseInt(parcalar[parcalar.length - 1], 10);
      if (!isNaN(num) && num > enYuksek) enYuksek = num;
    }
  }
  // En yüksek numara + 1
  const sonNumara = enYuksek + 1;

  // Format: KAD-26/DSİ.001
  const evrakSayiNo = `${firmaKisa}-${yil2}/${muhatapKisa}.${String(sonNumara).padStart(3, "0")}`;
  return NextResponse.json({ evrak_sayi_no: evrakSayiNo });
}
