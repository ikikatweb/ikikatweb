// Günlük Arvento metrik cache'i (dashboard "Sezon Özeti").
//   GET  ?bas=YYYY-MM-DD&bitis=YYYY-MM-DD → { toplam:{reglajKm,kamyonSefer,sermeKm,sikistirmaKm,makineSn}, tarihler:string[] }
//   POST { tarih, reglajKm, kamyonSefer, sermeKm, sikistirmaKm, makineSn }  (YÖNETİCİ) → günü upsert
// Değerler tarayıcıda hesaplanır (tek kaynak: hesaplaGunlukMetrik); burada yalnız saklanır/toplanır.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
async function yoneticiMi(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return false;
  const cookieStore = await cookies();
  const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return false;
  const sb = createClient(url, svc);
  const { data } = await sb.from("kullanicilar").select("rol").eq("auth_id", user.id).single();
  return data?.rol === "yonetici";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bas = searchParams.get("bas"), bitis = searchParams.get("bitis");
  if (!bas || !bitis) return NextResponse.json({ error: "bas ve bitis gerekli" }, { status: 400 });
  const sb = service();
  const { data, error } = await sb.from("arvento_gunluk_metrik")
    .select("tarih, reglaj_km, kamyon_sefer, serme_km, sikistirma_km, makine_sn")
    .gte("tarih", bas).lte("tarih", bitis);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  const toplam = rows.reduce((a, r) => ({
    reglajKm: a.reglajKm + Number(r.reglaj_km ?? 0),
    kamyonSefer: a.kamyonSefer + Number(r.kamyon_sefer ?? 0),
    sermeKm: a.sermeKm + Number(r.serme_km ?? 0),
    sikistirmaKm: a.sikistirmaKm + Number(r.sikistirma_km ?? 0),
    makineSn: a.makineSn + Number(r.makine_sn ?? 0),
  }), { reglajKm: 0, kamyonSefer: 0, sermeKm: 0, sikistirmaKm: 0, makineSn: 0 });
  return NextResponse.json({ toplam, tarihler: rows.map((r) => r.tarih as string) });
}

export async function POST(request: Request) {
  if (!(await yoneticiMi())) return NextResponse.json({ error: "Yetkisiz" }, { status: 403 });
  let b: { tarih?: string; reglajKm?: number; kamyonSefer?: number; sermeKm?: number; sikistirmaKm?: number; makineSn?: number };
  try { b = await request.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  if (!b.tarih) return NextResponse.json({ error: "tarih gerekli" }, { status: 400 });
  const sb = service();
  const { error } = await sb.from("arvento_gunluk_metrik").upsert({
    tarih: b.tarih,
    reglaj_km: b.reglajKm ?? 0,
    kamyon_sefer: Math.round(b.kamyonSefer ?? 0),
    serme_km: b.sermeKm ?? 0,
    sikistirma_km: b.sikistirmaKm ?? 0,
    makine_sn: Math.round(b.makineSn ?? 0),
    olusturma: new Date().toISOString(),
  }, { onConflict: "tarih" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
