// Son giriş kaydı API — oturum açan kullanıcının kullanicilar.son_giris alanını
// "şimdi" olarak günceller. Uygulama her açıldığında (auth profili yüklenince) çağrılır,
// böylece "Son Giriş" kolonu sadece şifreyle yeniden giriş yapılınca değil, kullanıcı
// siteye her girdiğinde güncellenir.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  // Bildirim SADECE gerçek (şifreli) girişte gönderilir. Sekme öne gelince/odak alınca yapılan
  // otomatik ping'ler (gercek=false) son_giris'i günceller ama YÖNETİCİLERE bildirim ATMAZ
  // → KMS aktivatörü gibi odak-çalan olayların ürettiği "hayalet giriş" bildirimleri engellenir.
  let gercek = false;
  try { const b = await request.json(); gercek = b?.gercek === true; } catch { /* gövdesiz ping → gercek=false */ }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(url, anon, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });

  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const supabase = createClient(url, service);

  // "Yeni giriş" = yalnız gerçek şifreli giriş (login sayfasından). Otomatik ping'ler (odak/görünürlük)
  // bildirim üretmez. Böylece bildirim GERÇEKTEN siteye giriş yapılınca gider, hayalet tetiklerde değil.
  const yeniGiris = gercek;

  // son_giris kolonu yoksa hata döner — sessizce yut (migration çalıştırılana kadar
  // GET tarafı Auth'un last_sign_in_at değerine düşer).
  const { error } = await supabase
    .from("kullanicilar")
    .update({ son_giris: new Date().toISOString() })
    .eq("auth_id", user.id);

  if (error) return NextResponse.json({ ok: false, yeniGiris: false, error: error.message });
  return NextResponse.json({ ok: true, yeniGiris });
}
