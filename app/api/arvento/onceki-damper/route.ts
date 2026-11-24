// SERME İÇİN GEÇMİŞ DAMPER NOKTALARI.
//   GET ?bas=YYYY-MM-DD → { noktalar: [[lat, lng, "YYYY-MM-DD HH:MM:SS"], ...] }
//
// NEDEN SUNUCUDA: Tarayıcı bu veriyi doğrudan çekiyordu ve 1000'er satırlık BEŞ turda
// arac_arvento_rapor'un damper_olaylar sütununu baştan sona indiriyordu. Ölçüm (24.11.2026):
// ham veri 2,14 MB; oysa serme hesabının kullandığı kısım (lat, lng, zaman) 372 KB.
// Aradaki fark olayların "adres" ve "harita" alanları — ekranda hiç kullanılmıyor.
// Süzme sunucuda yapılınca telefona 2,14 MB yerine ~370 KB iniyor; veritabanı şeması
// değişmediği için PostgREST şema yenilemesi de gerekmiyor.
//
// Dizi biçimi ({lat,lng,dt} nesnesi yerine [lat,lng,dt]) alan adlarını her nokta için
// tekrarlamaz — aynı veri ~%30 daha küçük.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const PARCA = 1000;

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function girisliMi(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const cookieStore = await cookies();
  const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await auth.auth.getUser();
  return !!user;
}

type DamperOlay = { lat?: number | null; lng?: number | null; saat?: string | null };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bas = searchParams.get("bas");
  if (!bas || !/^\d{4}-\d{2}-\d{2}$/.test(bas)) {
    return NextResponse.json({ error: "bas (YYYY-MM-DD) gerekli" }, { status: 400 });
  }
  if (!(await girisliMi())) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });

  const sb = service();
  const noktalar: [number, number, string][] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from("arac_arvento_rapor")
      .select("rapor_tarihi, damper_olaylar")
      .lt("rapor_tarihi", bas)
      .not("damper_olaylar", "is", null)      // boş satır nokta üretmez
      .range(offset, offset + PARCA - 1);
    // Sessiz geçme: eksik veri serme km'sini SESSİZCE büyütür (geçmiş damper görünmeyince
    // o yol "ilk kez seriliyor" sayılır). Hata açıkça dönsün, çağıran bilsin.
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    const satirlar = (data ?? []) as { rapor_tarihi: string; damper_olaylar?: DamperOlay[] | null }[];
    for (const r of satirlar) {
      for (const d of r.damper_olaylar ?? []) {
        if (d?.lat == null || d?.lng == null) continue;
        noktalar.push([d.lat, d.lng, `${r.rapor_tarihi} ${d.saat ?? "00:00:00"}`]);
      }
    }
    if (satirlar.length < PARCA) break;
    offset += PARCA;
    if (offset > 300000) break;
  }

  return NextResponse.json({ noktalar });
}
