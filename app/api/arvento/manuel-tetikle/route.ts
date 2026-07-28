// Manuel rapor + damper tetikleme — UI "Raporu şimdi çek" butonu buraya POST atar.
// Mimari: web app (Vercel) senkron script'lerini (bu dizüstünde Görev Zamanlayıcı) doğrudan çalıştıramaz.
// Bunun yerine arvento_ayarlar.manuel_tetikle_istek'e bir istek damgası yazar; hem rapor hem damper script'i
// bir sonraki ateşlemede (1 dk) bu damgayı görüp son çekimlerinden sonraysa GATE'i atlayıp hemen çeker.
// Cooldown (420 sn / 7 dk): rapor bir çekim döngüsü ~6 dk sürdüğü için son rapor çekiminden en az 7 dk geçmeden
// yeni manuel tetiklemeye izin verilmez → sunucu tarafında doğrulanır (istemciye güvenilmez).
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const COOLDOWN_SN = 420; // 7 dk — buton en erken bu kadar sonra tekrar aktif olur (rapor çekimi ~6 dk sürer)
const SQL_UYARI =
  "Veritabanı kolonları eksik. Supabase SQL Editor'da şunu çalıştırın:\n\n" +
  "alter table arvento_ayarlar add column if not exists rapor_son_calisma timestamptz, " +
  "add column if not exists manuel_tetikle_istek timestamptz;";

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  try {
    // Oturum kontrolü — yalnız giriş yapmış kullanıcı tetikleyebilir.
    const cookieStore = await cookies();
    const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

    const sb = createClient(url, svcKey);
    const { data, error: okuHata } = await sb
      .from("arvento_ayarlar").select("rapor_son_calisma").eq("id", "global").maybeSingle();
    if (okuHata && /column .* does not exist/i.test(okuHata.message)) {
      return NextResponse.json({ error: SQL_UYARI }, { status: 500 });
    }

    const sonStr = (data as { rapor_son_calisma?: string | null } | null)?.rapor_son_calisma ?? null;
    const son = sonStr ? new Date(sonStr).getTime() : 0;
    const gecenSn = son ? (Date.now() - son) / 1000 : Infinity;
    if (gecenSn < COOLDOWN_SN) {
      return NextResponse.json(
        { error: "Henüz erken", kalanSn: Math.ceil(COOLDOWN_SN - gecenSn), raporSonCalisma: sonStr },
        { status: 429 },
      );
    }

    const { error } = await sb.from("arvento_ayarlar")
      .update({ manuel_tetikle_istek: new Date().toISOString() }).eq("id", "global");
    if (error) {
      if (/column .* does not exist/i.test(error.message)) return NextResponse.json({ error: SQL_UYARI }, { status: 500 });
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, raporSonCalisma: sonStr });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Tetiklenemedi" }, { status: 500 });
  }
}
