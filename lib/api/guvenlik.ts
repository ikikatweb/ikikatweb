// API ROTA GÜVENLİĞİ — tek kapı.
//
// middleware.ts yalnız /dashboard ve /login'i kapsıyor (matcher). /api/* middleware'in
// DIŞINDA kaldığı için her rota kendi kapısını kurmak zorunda; 24 rotada hiç kapı yoktu:
// kimliği olmayan biri şirketin SMTP'siyle mail attırabiliyor, Storage'a dosya yükleyip
// mevcut dosyanın üzerine yazabiliyor, bildirge kayıtlarını kapatabiliyordu.
//
// Neden middleware matcher'ına /api eklenmedi: bazı rotalar PC'deki görev
// zamanlayıcıdan (oturumsuz, görev anahtarıyla) çağrılıyor ve middleware onları da
// keserdi. Kapı rota bazında kurulur; görev anahtarı kabul eden rotalar bunu açıkça
// belirtir (gorevAnahtariGecerli).

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export type OturumKullanici = {
  id: string;
  auth_id: string;
  rol: "yonetici" | "santiye_admin" | "kisitli";
  ad_soyad: string;
  aktif: boolean;
};

/** Çerezdeki oturumdan kullanıcı kaydını çözer. Oturum yoksa / pasifse null. */
export async function oturum(): Promise<OturumKullanici | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const servis = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !servis) return null;
  try {
    const cookieStore = await cookies();
    const auth = createServerClient(url, anon, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
    });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return null;
    const sb = createClient(url, servis);
    const { data } = await sb
      .from("kullanicilar")
      .select("id, auth_id, rol, ad_soyad, aktif")
      .eq("auth_id", user.id)
      .single();
    const k = data as OturumKullanici | null;
    // PASİF KULLANICI oturumu açık kalmış olabilir → yetkisiz say.
    if (!k || k.aktif === false) return null;
    return k;
  } catch {
    return null;
  }
}

export function yetkisiz(mesaj = "Oturum bulunamadı"): NextResponse {
  return NextResponse.json({ error: mesaj }, { status: 401 });
}

/**
 * PC'deki görev zamanlayıcıdan gelen oturumsuz çağrılar için anahtar kapısı.
 * Anahtar `x-gorev-anahtari` başlığında ya da `?anahtar=` ile gelir; CRON_SECRET tanımlı
 * değilse kapı KAPALI sayılır (yanlışlıkla herkese açılmasın).
 */
export function gorevAnahtariGecerli(request: Request): boolean {
  const beklenen = process.env.CRON_SECRET;
  if (!beklenen) return false;
  const bas = request.headers.get("x-gorev-anahtari")
    ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? new URL(request.url).searchParams.get("anahtar");
  return !!bas && bas === beklenen;
}

/** Oturum YA DA görev anahtarı — ikisinden biri yeterli olan rotalar için. */
export async function oturumYaDaGorev(request: Request): Promise<boolean> {
  if (gorevAnahtariGecerli(request)) return true;
  return (await oturum()) !== null;
}
