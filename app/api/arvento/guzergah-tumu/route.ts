// Sayfa seviyesi TÜM-ARAÇ guzergah çekimi — SERVICE ROLE ile TEK sorgu.
// GET /api/arvento/guzergah-tumu?bas=YYYY-MM-DD&bitis=YYYY-MM-DD → AracArventoGuzergah[]
//
// Neden: client'tan ANON+RLS ile geniş aralık gte/lte sorgusu statement-timeout veriyor → gün-gün (N istek)
// gidiliyordu (yavaş + tarayıcı bağlantı havuzunu tüketip sekmenin kendi verisini geciktiriyordu). Service
// role RLS'i atlar → indexli TEK range sorgusu (timeout yok) + tek HTTP isteği (gzip'li) → çok daha hızlı.
// VERİ DEĞİŞMEZ: aynı satırlar döner (ilkSonKontakMap/ocak türetmeleri aynı sonucu verir). Yalnız Tanımlamalar'da
// kayıtlı araçlara süzülür (client getGuzergahByRange ile aynı davranış).
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function plakaNorm(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bas = searchParams.get("bas") ?? "", bitis = searchParams.get("bitis") ?? "";
  if (!bas || !bitis) return NextResponse.json({ error: "bas ve bitis zorunlu" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Oturum kontrolü: raw GPS açık uca sızmasın — yalnız giriş yapmış kullanıcı çekebilir.
  try {
    const cookieStore = await cookies();
    const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  try {
    const sb = createClient(url, svcKey);
    // Tanımlı araç seti (kanonik plaka) — kayıtlı olmayan yabancı yazımları süz (client tanimliSuz ile aynı).
    const { data: aracRows } = await sb.from("araclar").select("plaka");
    const kanonik = new Map<string, string>();
    for (const a of (aracRows ?? []) as { plaka: string }[]) { const n = plakaNorm(a.plaka); if (n) kanonik.set(n, a.plaka); }

    // TEK aralık sorgusu (service role → RLS yok → timeout yok). 1000'lik sayfalama (yoğun gün güvenliği).
    const rows: Record<string, unknown>[] = [];
    const PARCA = 1000; let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("arac_arvento_guzergah").select("*")
        .gte("rapor_tarihi", bas).lte("rapor_tarihi", bitis)
        .order("rapor_tarihi").order("plaka").range(offset, offset + PARCA - 1);
      if (error) throw error;
      const d = (data ?? []) as Record<string, unknown>[];
      rows.push(...d);
      if (d.length < PARCA) break;
      offset += PARCA; if (offset > 100000) break;
    }
    // Tanımlı araç süzgeci + kanonik plaka (araclar boş/erişilemezse süzme — sayfa boşalmasın).
    const cikti = kanonik.size === 0 ? rows : rows.filter((r) => kanonik.has(plakaNorm(r.plaka))).map((r) => {
      const k = kanonik.get(plakaNorm(r.plaka));
      return k && k !== r.plaka ? { ...r, plaka: k } : r;
    });
    return NextResponse.json(cikti);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "guzergah çekilemedi" }, { status: 500 });
  }
}
