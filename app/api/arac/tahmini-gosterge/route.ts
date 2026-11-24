// TAHMİNİ GÖSTERGE — arayüz kapısı. Hesabın kendisi lib/arac/tahmini-gosterge.ts'te
// (aynı hesabı yaklaşan bakım bildirimi de kullanıyor; iki yerde iki ayrı sayı olmasın).
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { tahminiGostergeler } from "@/lib/arac/tahmini-gosterge";

export const dynamic = "force-dynamic";

async function girisliMi(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const cookieStore = await cookies();
  const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await auth.auth.getUser();
  return !!user;
}

export async function GET() {
  if (!(await girisliMi())) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  try {
    return NextResponse.json(await tahminiGostergeler(sb));
  } catch (e) {
    // Sessiz geçmez: boş sonuç "tahmin yok" demek olurdu, oysa hesap yapılamadı.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Hesaplanamadı" }, { status: 502 });
  }
}
