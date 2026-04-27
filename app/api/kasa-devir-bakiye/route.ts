// Kasa devir bakiye — tüm geçmiş nakit hareketlerini server-side aggregate eder.
// Client tarafında pagination ile tüm kayıtları çekmeye göre çok daha hızlı:
// - Service role ile RLS atlanır, tek sorguda tüm kayıtlar gelir
// - personel_id bazında nakit gelir/gider toplamı hesaplanır
// - JSON map olarak döner: { [personel_id]: bakiye }
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Oturum kontrolü
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });
  }

  const url = new URL(request.url);
  const bitis = url.searchParams.get("bitis");
  if (!bitis || !/^\d{4}-\d{2}-\d{2}$/.test(bitis)) {
    return NextResponse.json({ error: "bitis (YYYY-MM-DD) gerekli" }, { status: 400 });
  }

  // Service role ile tüm nakit hareketleri tek seferde çek (RLS bypass + büyük limit)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from("kasa_hareketi")
    .select("personel_id, tip, tutar")
    .eq("odeme_yontemi", "nakit")
    .lte("tarih", bitis)
    .limit(100000); // 100k satıra kadar tek istekle

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate
  const map: Record<string, number> = {};
  for (const h of (data ?? []) as { personel_id: string; tip: string; tutar: number }[]) {
    const prev = map[h.personel_id] ?? 0;
    map[h.personel_id] = prev + (h.tip === "gelir" ? h.tutar : -h.tutar);
  }

  return NextResponse.json(map);
}
