// GÜNLÜK ASGARİ ÇALIŞMANIN VERİDEN HESABI — GET /api/araclar/gunluk-min
//
// Araç kartında elle bir değer girilmemişse eşik bu uçtan gelir: aracın geçmişte bir çalışma
// gününde yaptığı EN DÜŞÜK iş (km ya da saat). Elle girilen değer silindiğinde otomatik olarak
// buna dönülür, ve bu uç her çağrıldığında YENİDEN hesaplar — yani veri geldikçe kendiliğinden
// güncel kalır, saklanan bayat bir kopya yoktur.
//
// Neden sunucuda: hesap tüm yakıt + puantaj geçmişini tarıyor (on binlerce satır). Tarayıcıya
// indirmek yerine burada tarayıp araç başına tek sayı döndürüyoruz.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { hesaplaGunlukMin, yuvarlaGunlukMin, type Okuma } from "@/lib/utils/gunluk-min-hesap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Satir = { arac_id: string; tarih: string; saat: string | null; km_saat: number | null };
type PSatir = { arac_id: string; tarih: string; durum: string };

type SbIstemci = { from: (t: string) => { select: (s: string) => { range: (a: number, b: number) => Promise<{ data: unknown; error: { message: string } | null }> } } };

async function sayfali<T>(sb: SbIstemci, tablo: string, sec: string): Promise<T[]> {
  const PARCA = 1000;
  const tum: T[] = [];
  for (let offset = 0; ; offset += PARCA) {
    const { data, error } = await sb.from(tablo).select(sec).range(offset, offset + PARCA - 1);
    if (error) throw new Error(error.message);
    const p = (data ?? []) as T[];
    tum.push(...p);
    if (p.length < PARCA || offset > 400000) break;
  }
  return tum;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  try {
    const cookieStore = await cookies();
    const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  try {
    const sb = createClient(url, svc);
    const { data: aracRows, error: aErr } = await sb.from("araclar").select("id, sayac_tipi");
    if (aErr) throw aErr;
    const araclar = (aracRows ?? []) as { id: string; sayac_tipi: "km" | "saat" | null }[];

    const [yakit, puantaj] = await Promise.all([
      sayfali<Satir>(sb as unknown as SbIstemci, "arac_yakit", "arac_id, tarih, saat, km_saat"),
      sayfali<PSatir>(sb as unknown as SbIstemci, "arac_puantaj", "arac_id, tarih, durum"),
    ]);

    const yByA = new Map<string, Okuma[]>();
    for (const y of yakit) {
      if ((y.km_saat ?? 0) <= 0) continue;
      const l = yByA.get(y.arac_id); if (l) l.push(y); else yByA.set(y.arac_id, [y]);
    }
    const pByA = new Map<string, Map<string, string>>();
    for (const p of puantaj) {
      let m = pByA.get(p.arac_id); if (!m) { m = new Map(); pByA.set(p.arac_id, m); }
      m.set(p.tarih, p.durum);
    }

    const cikti: Record<string, { deger: number; basTarih: string; bitTarih: string; gun: number; aralik: number }> = {};
    for (const a of araclar) {
      const okumalar = yByA.get(a.id); const gunler = pByA.get(a.id);
      if (!okumalar || !gunler) continue;
      const s = hesaplaGunlukMin(okumalar, gunler);
      if (!s) continue;
      cikti[a.id] = {
        deger: yuvarlaGunlukMin(s.deger, a.sayac_tipi === "saat" ? "saat" : "km"),
        basTarih: s.basTarih, bitTarih: s.bitTarih, gun: s.gun, aralik: s.aralikSayisi,
      };
    }
    return NextResponse.json(cikti);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "hesaplanamadı" }, { status: 500 });
  }
}
