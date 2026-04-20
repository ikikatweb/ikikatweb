// Kullanıcı güncelleme ve silme API (sadece yönetici)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

async function getCaller() {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await supabase
    .from("kullanicilar")
    .select("id, auth_id, rol")
    .eq("auth_id", user.id)
    .single();

  return data;
}

// PUT - Kullanıcı güncelle
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const caller = await getCaller();
  if (!caller || caller.rol !== "yonetici") {
    return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 403 });
  }

  const body = await request.json();
  const { ad_soyad, rol, aktif, sifre, izinler, santiye_ids, geriye_donus_gun, dashboard_widgets } = body;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Kendini pasife alamaz veya kısıtlıya çeviremez
  if (caller.id === id) {
    if (aktif === false) {
      return NextResponse.json({ error: "Kendinizi pasife alamazsınız" }, { status: 400 });
    }
    if (rol === "kisitli") {
      return NextResponse.json({ error: "Kendi rolünüzü kısıtlıya çeviremezsiniz" }, { status: 400 });
    }
  }

  // Kullanıcıyı bul
  const { data: kullanici } = await supabase
    .from("kullanicilar")
    .select("auth_id")
    .eq("id", id)
    .single();

  if (!kullanici) {
    return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
  }

  // Şifre değişikliği varsa auth'u güncelle
  if (sifre && sifre.trim()) {
    const { error: authError } = await supabase.auth.admin.updateUserById(
      kullanici.auth_id,
      { password: sifre }
    );
    if (authError) {
      return NextResponse.json({ error: `Şifre güncellenemedi: ${authError.message}` }, { status: 500 });
    }
  }

  // Kullanıcı kaydını güncelle
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (ad_soyad !== undefined) updateData.ad_soyad = ad_soyad;
  if (rol !== undefined) updateData.rol = rol;
  if (aktif !== undefined) updateData.aktif = aktif;
  if (izinler !== undefined) updateData.izinler = izinler;
  if (santiye_ids !== undefined) updateData.santiye_ids = santiye_ids;
  if (geriye_donus_gun !== undefined) updateData.geriye_donus_gun = geriye_donus_gun;
  if (dashboard_widgets !== undefined) updateData.dashboard_widgets = dashboard_widgets;
  if (sifre && sifre.trim()) updateData.sifre_gorunur = sifre;

  const { data, error } = await supabase
    .from("kullanicilar")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE - Kullanıcı sil
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const caller = await getCaller();
  if (!caller || caller.rol !== "yonetici") {
    return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 403 });
  }

  // Kendini silemez
  if (caller.id === id) {
    return NextResponse.json({ error: "Kendinizi silemezsiniz" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth ID'yi al
  const { data: kullanici } = await supabase
    .from("kullanicilar")
    .select("auth_id")
    .eq("id", id)
    .single();

  if (!kullanici) {
    return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
  }

  // Tablodan sil
  await supabase.from("kullanicilar").delete().eq("id", id);

  // Auth kullanıcısını sil
  await supabase.auth.admin.deleteUser(kullanici.auth_id);

  return NextResponse.json({ ok: true });
}
