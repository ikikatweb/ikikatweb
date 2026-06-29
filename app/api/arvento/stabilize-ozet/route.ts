// Stabilize harita özeti — TARAYICI bunu çağırır (ham GPS değil, küçük önbelleklenmiş özet).
// GET /api/arvento/stabilize-ozet?bas=YYYY-MM-DD&bitis=YYYY-MM-DD → { dampers: OzetDamper[] }
//
// ozetGetir service-role kullanır (arvento_harita_ozet'e RLS baypas erişim) → ayrı auth gerekmez.
import { NextResponse } from "next/server";
import { ozetGetir } from "@/lib/arvento/stabilize-ozet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bas = searchParams.get("bas") ?? "";
  const bitis = searchParams.get("bitis") ?? "";
  if (!bas || !bitis) {
    return NextResponse.json({ error: "bas ve bitis zorunlu (YYYY-MM-DD)" }, { status: 400 });
  }
  try {
    const { dampers, girisler } = await ozetGetir(bas, bitis);
    return NextResponse.json({ dampers, girisler });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Stabilize özeti hatası: ${msg}` }, { status: 500 });
  }
}
