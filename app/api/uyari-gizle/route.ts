// UYARI GİZLEME — kullanıcı bir uyarıyı "Anlaşıldı" diyerek kalıcı kapatır.
//
// Kendi kaydına yazar: yönetici yetkisi aranmaz, çünkü kullanıcı yalnız KENDİ
// gizlediklerini değiştirir. Hedef satır oturumdan çözülür, gövdeden gelen bir
// kullanıcı id'si KABUL EDİLMEZ — yoksa bir kullanıcı başkasının uyarısını kapatabilirdi.
//
// Anahtar biçimi: "<uyari-tipi>:<kayit-id>" (ör. "gecici-kabul-prim:<evrakId>").
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const ANAHTAR_BICIM = /^[a-z0-9-]{3,40}:[A-Za-z0-9-]{1,64}$/;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
  });
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });

  const { anahtar, geriAl } = (await request.json()) as { anahtar?: string; geriAl?: boolean };
  if (!anahtar || !ANAHTAR_BICIM.test(anahtar)) {
    return NextResponse.json({ error: "Geçersiz uyarı anahtarı" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: kayit, error: okuErr } = await supabase
    .from("kullanicilar")
    .select("id, gizlenen_uyarilar")
    .eq("auth_id", user.id)
    .single();
  // Hata mesajı AYRIŞTIRILIR: sütun yoksa (SQL çalıştırılmadıysa) "Kullanıcı bulunamadı"
  // demek yanıltıyordu — asıl sebep gizlenir, kullanıcı yanlış yerde arar.
  if (okuErr) {
    const eksikSutun = /column .*gizlenen_uyarilar.* does not exist/i.test(okuErr.message);
    return NextResponse.json({
      error: eksikSutun
        ? "gizlenen_uyarilar sütunu yok — sql/kullanici_gizlenen_uyarilar.sql çalıştırılmalı."
        : okuErr.message,
    }, { status: eksikSutun ? 500 : 400 });
  }
  if (!kayit) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  const mevcut = ((kayit as { gizlenen_uyarilar: string[] | null }).gizlenen_uyarilar ?? []);
  const yeni = geriAl
    ? mevcut.filter((a) => a !== anahtar)
    : (mevcut.includes(anahtar) ? mevcut : [...mevcut, anahtar]);

  const { error: yazErr } = await supabase
    .from("kullanicilar")
    .update({ gizlenen_uyarilar: yeni })
    .eq("id", (kayit as { id: string }).id);
  if (yazErr) return NextResponse.json({ error: yazErr.message }, { status: 500 });

  return NextResponse.json({ gizlenen_uyarilar: yeni });
}
