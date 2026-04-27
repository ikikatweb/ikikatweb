// Middleware - Oturum, aktif/pasif kontrolü ve rota bazlı izin kontrolü
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { pathToModuleKey, pathToAction, hasPermission } from "@/lib/permissions";

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser auth hatası verebilir (Invalid Refresh Token, Auth session missing).
  // Sessiz şekilde user=null kabul et — sonsuz redirect döngüsünü önle.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Sessizce devam et — user null olarak kalacak
  }

  // Oturum yoksa dashboard'a erişimi engelle
  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    // Bozuk Supabase auth çerezlerini sil (varsa)
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("sb-")) redirectResponse.cookies.delete(c.name);
    }
    return redirectResponse;
  }

  // Oturum varsa login'e girmeyi engelle
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Dashboard sayfalarında kullanıcı profil kontrolü
  if (user && request.nextUrl.pathname.startsWith("/dashboard") && supabaseServiceKey) {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: kullanici } = await supabaseAdmin
      .from("kullanicilar")
      .select("rol, aktif, izinler")
      .eq("auth_id", user.id)
      .single();

    // Kullanıcı profili bulunamazsa (tablo henüz oluşturulmamış olabilir) geç
    if (kullanici) {
      // Pasif kullanıcıyı engelle
      if (!kullanici.aktif) {
        await supabase.auth.signOut();
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
      }

      // Rota bazlı izin kontrolü (sadece /dashboard alt sayfaları)
      const pathname = request.nextUrl.pathname;
      if (pathname !== "/dashboard") {
        const moduleKey = pathToModuleKey(pathname);
        if (moduleKey) {
          const aksiyon = pathToAction(pathname);
          const izinVar = hasPermission(
            kullanici.rol,
            kullanici.izinler as Record<string, { goruntule?: boolean; ekle?: boolean; duzenle?: boolean; sil?: boolean }>,
            moduleKey,
            aksiyon
          );

          if (!izinVar) {
            const url = request.nextUrl.clone();
            url.pathname = "/dashboard";
            return NextResponse.redirect(url);
          }
        }
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
