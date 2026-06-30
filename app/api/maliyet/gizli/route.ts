// Sezon Maliyeti "Silinenler" (gizli şantiyeler) — PAYLAŞIMLI liste. Yalnız YÖNETİCİ erişebilir.
//   GET  → { ids: string[] }                      (gizli şantiye id'leri)
//   POST { santiyeId, gizli: boolean }            (gizli=true → ekle/gizle, false → geri al)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Çağıran YÖNETİCİ mi? (oturum + rol=yonetici). Değilse null.
async function getYonetici(): Promise<{ id: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return null;
  const cookieStore = await cookies();
  const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  const sb = createClient(url, svc);
  const { data } = await sb.from("kullanicilar").select("id, rol").eq("auth_id", user.id).single();
  return data?.rol === "yonetici" ? { id: data.id as string } : null;
}

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET() {
  const y = await getYonetici();
  if (!y) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  const { data, error } = await service().from("maliyet_gizli_santiye").select("santiye_id");
  if (error) {
    if (/does not exist|maliyet_gizli_santiye/i.test(error.message)) return NextResponse.json({ error: "maliyet_gizli_santiye tablosu yok. SQL'i çalıştırın." }, { status: 500 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ids: (data ?? []).map((r) => r.santiye_id as string) });
}

export async function POST(req: Request) {
  const y = await getYonetici();
  if (!y) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  let body: { santiyeId?: string; gizli?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  const { santiyeId, gizli } = body;
  if (!santiyeId) return NextResponse.json({ error: "santiyeId gerekli" }, { status: 400 });
  const sb = service();
  const { error } = gizli
    ? await sb.from("maliyet_gizli_santiye").upsert({ santiye_id: santiyeId, gizleyen: y.id }, { onConflict: "santiye_id" })
    : await sb.from("maliyet_gizli_santiye").delete().eq("santiye_id", santiyeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
