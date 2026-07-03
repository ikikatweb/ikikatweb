// Sezon uzunluk metrik önbelleği (dashboard "Sezon Özeti").
//   GET  ?bitis=YYYY-MM-DD&imza=... → { deger:{reglajKm,sermeKm,sikistirmaKm,bugunSermeKm,makineSn}|null, taze:boolean }
//   POST { bitis, imza, reglajKm, sermeKm, sikistirmaKm, bugunSermeKm, makineSn }  (GİRİŞLİ) → upsert
// Değerler tarayıcıda hesaplanır (tek kaynak: sezonUzunlukMetrik); burada yalnız saklanır. taze=false ise
// istemci bayat değeri gösterip ARKA PLANDA yeniden hesaplayıp POST eder (SWR — kullanıcı skeleton görmez).
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const TTL_MS = 20 * 60 * 1000; // 20 dk: bugünün değeri gün içinde büyür; bu süreden eskiyse "bayat" → arka planda tazelenir

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
// Cache'i yalnız GİRİŞLİ kullanıcı yazabilsin (rol şartı yok — amaç cache'i sıcak tutmak; değerler türetilmiş metrik).
async function girisliMi(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const cookieStore = await cookies();
  const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
  const { data: { user } } = await auth.auth.getUser();
  return !!user;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bitis = searchParams.get("bitis");
  const imza = searchParams.get("imza");
  if (!bitis) return NextResponse.json({ error: "bitis gerekli" }, { status: 400 });
  const sb = service();
  const { data, error } = await sb.from("arvento_sezon_uzunluk")
    .select("reglaj_km, serme_km, sikistirma_km, bugun_serme_km, makine_sn, imza, hesaplanma")
    .eq("bitis", bitis).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ deger: null, taze: false });
  const deger = {
    reglajKm: Number(data.reglaj_km ?? 0),
    sermeKm: Number(data.serme_km ?? 0),
    sikistirmaKm: Number(data.sikistirma_km ?? 0),
    bugunSermeKm: Number(data.bugun_serme_km ?? 0),
    makineSn: Number(data.makine_sn ?? 0),
  };
  const yas = Date.now() - new Date(data.hesaplanma as string).getTime();
  const taze = (imza == null || data.imza === imza) && yas < TTL_MS; // imza değiştiyse ya da eskiyse → bayat
  return NextResponse.json({ deger, taze });
}

export async function POST(request: Request) {
  if (!(await girisliMi())) return NextResponse.json({ error: "Yetkisiz" }, { status: 403 });
  let b: { bitis?: string; imza?: string; reglajKm?: number; sermeKm?: number; sikistirmaKm?: number; bugunSermeKm?: number; makineSn?: number };
  try { b = await request.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  if (!b.bitis) return NextResponse.json({ error: "bitis gerekli" }, { status: 400 });
  const sb = service();
  const { error } = await sb.from("arvento_sezon_uzunluk").upsert({
    bitis: b.bitis,
    imza: b.imza ?? null,
    reglaj_km: b.reglajKm ?? 0,
    serme_km: b.sermeKm ?? 0,
    sikistirma_km: b.sikistirmaKm ?? 0,
    bugun_serme_km: b.bugunSermeKm ?? 0,
    makine_sn: b.makineSn ?? 0,
    hesaplanma: new Date().toISOString(),
  }, { onConflict: "bitis" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
