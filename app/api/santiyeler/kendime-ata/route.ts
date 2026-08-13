// Yeni iş oluşturan KISITLI / ŞANTİYE ADMİNİ kullanıcıyı, oluşturduğu işe otomatik atar
// (kendi santiye_ids'ine ekler) — böylece oluşturduğu işi görebilir.
// GÜVENLİK: kullanıcı SADECE KENDİ satırına, SADECE ekleme yapar (auth_id ile kendi kaydı bulunur).
// Yönetici zaten tüm işleri görür → atlanır.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
  });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

  let santiyeId: string | undefined;
  try { santiyeId = (await req.json())?.santiye_id; } catch { /* gövde yok */ }
  if (!santiyeId) return NextResponse.json({ error: "santiye_id gerekli" }, { status: 400 });

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: me, error: meErr } = await admin
    .from("kullanicilar")
    .select("id, rol, santiye_ids")
    .eq("auth_id", user.id)
    .single();
  if (meErr || !me) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  // Yönetici tüm işleri zaten görür → atamaya gerek yok.
  if (me.rol === "yonetici") return NextResponse.json({ ok: true, skipped: true });

  const mevcut: string[] = Array.isArray(me.santiye_ids) ? (me.santiye_ids as string[]) : [];
  if (mevcut.includes(santiyeId)) return NextResponse.json({ ok: true });

  const { error } = await admin
    .from("kullanicilar")
    .update({ santiye_ids: [...mevcut, santiyeId] })
    .eq("id", me.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
