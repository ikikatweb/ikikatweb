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
  const {
    ad_soyad, rol, aktif, sifre, izinler, santiye_ids, firma_ids,
    geriye_donus_gun, dashboard_widgets, tum_mesajlari_gor, santiyesiz_veri_gor,
    puantaj_islem_gun, puantaj_goruntuleme_gun,
    yakit_islem_gun, yakit_goruntuleme_gun,
    kasa_islem_gun, kasa_goruntuleme_gun,
    santiye_defteri_islem_gun, santiye_defteri_goruntuleme_gun,
  } = body;

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
  if (firma_ids !== undefined) updateData.firma_ids = firma_ids;
  if (geriye_donus_gun !== undefined) updateData.geriye_donus_gun = geriye_donus_gun;
  if (puantaj_islem_gun !== undefined) updateData.puantaj_islem_gun = puantaj_islem_gun;
  if (puantaj_goruntuleme_gun !== undefined) updateData.puantaj_goruntuleme_gun = puantaj_goruntuleme_gun;
  if (yakit_islem_gun !== undefined) updateData.yakit_islem_gun = yakit_islem_gun;
  if (yakit_goruntuleme_gun !== undefined) updateData.yakit_goruntuleme_gun = yakit_goruntuleme_gun;
  if (kasa_islem_gun !== undefined) updateData.kasa_islem_gun = kasa_islem_gun;
  if (kasa_goruntuleme_gun !== undefined) updateData.kasa_goruntuleme_gun = kasa_goruntuleme_gun;
  if (santiye_defteri_islem_gun !== undefined) updateData.santiye_defteri_islem_gun = santiye_defteri_islem_gun;
  if (santiye_defteri_goruntuleme_gun !== undefined) updateData.santiye_defteri_goruntuleme_gun = santiye_defteri_goruntuleme_gun;
  if (dashboard_widgets !== undefined) updateData.dashboard_widgets = dashboard_widgets;
  if (tum_mesajlari_gor !== undefined) updateData.tum_mesajlari_gor = tum_mesajlari_gor;
  if (santiyesiz_veri_gor !== undefined) updateData.santiyesiz_veri_gor = santiyesiz_veri_gor;
  if (sifre && sifre.trim()) updateData.sifre_gorunur = sifre;

  const { data, error } = await supabase
    .from("kullanicilar")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (/column .*firma_ids.* does not exist/i.test(error.message)) {
      return NextResponse.json({
        error: "Veritabanında 'firma_ids' kolonu yok. Supabase SQL Editor'da şunu çalıştırın:\n\nALTER TABLE kullanicilar ADD COLUMN IF NOT EXISTS firma_ids UUID[] NULL;",
      }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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

  // İŞLEM KONTROLÜ: Kullanıcı sistemde herhangi bir işlem yaptıysa (yazışma, puantaj,
  // yakıt, kasa, mesaj, şantiye defteri vb.) SİLİNEMEZ — veri bütünlüğü korunur.
  // (Bunun yerine pasife alınmalı.) created_by / olusturan_id / yazan_id / gonderen_id
  // alanlarının hepsi kullanicilar.id'yi referanslar.
  const aktiviteTablolari: { tablo: string; kolon: string; etiket: string }[] = [
    { tablo: "gelen_evrak", kolon: "olusturan_id", etiket: "gelen evrak" },
    { tablo: "giden_evrak", kolon: "olusturan_id", etiket: "giden evrak" },
    { tablo: "banka_yazisma", kolon: "olusturan_id", etiket: "banka yazışması" },
    { tablo: "personel_puantaj", kolon: "created_by", etiket: "personel puantajı" },
    { tablo: "arac_puantaj", kolon: "created_by", etiket: "araç puantajı" },
    { tablo: "arac_yakit", kolon: "created_by", etiket: "yakıt kaydı" },
    { tablo: "yakit_alim", kolon: "created_by", etiket: "yakıt alımı" },
    { tablo: "yakit_virman", kolon: "created_by", etiket: "yakıt virmanı" },
    { tablo: "kasa_hareketi", kolon: "created_by", etiket: "kasa hareketi" },
    { tablo: "santiye_defteri", kolon: "created_by", etiket: "şantiye defteri" },
    { tablo: "santiye_defteri_kayit", kolon: "yazan_id", etiket: "şantiye defteri yazısı" },
    { tablo: "mesaj", kolon: "gonderen_id", etiket: "mesaj" },
    { tablo: "arac_bakim", kolon: "created_by", etiket: "araç bakım kaydı" },
    { tablo: "arac_kira_bedeli", kolon: "created_by", etiket: "kira bedeli kaydı" },
    { tablo: "ihale", kolon: "created_by", etiket: "ihale kaydı" },
  ];
  const aktiviteSonuc = await Promise.all(
    aktiviteTablolari.map(async ({ tablo, kolon, etiket }) => {
      const { count, error } = await supabase
        .from(tablo)
        .select("id", { count: "exact", head: true })
        .eq(kolon, id);
      if (error) return null; // tablo/kolon yoksa atla
      return (count ?? 0) > 0 ? `${etiket} (${count})` : null;
    })
  );
  const bulunanlar = aktiviteSonuc.filter((x): x is string => x !== null);
  if (bulunanlar.length > 0) {
    return NextResponse.json(
      {
        error: `Bu kullanıcı silinemez çünkü sistemde işlemleri bulunuyor: ${bulunanlar.join(", ")}. Kaydı korumak için kullanıcıyı silmek yerine PASİFE alın.`,
      },
      { status: 400 }
    );
  }

  // Tablodan sil
  await supabase.from("kullanicilar").delete().eq("id", id);

  // Auth kullanıcısını sil
  await supabase.auth.admin.deleteUser(kullanici.auth_id);

  return NextResponse.json({ ok: true });
}
