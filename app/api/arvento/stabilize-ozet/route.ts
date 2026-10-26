// Stabilize harita özeti — TARAYICI bunu çağırır (ham GPS değil, küçük önbelleklenmiş özet).
// GET /api/arvento/stabilize-ozet?bas=YYYY-MM-DD&bitis=YYYY-MM-DD → { dampers: OzetDamper[] }
//
// KAPI: oturum YA DA görev anahtarı. ozetGetir service-role ile çalışıyor (RLS baypas), bu
// yüzden "ayrı auth gerekmez" denmişti — oysa rota internete açıktı ve araç/damper verisi
// kimliksiz okunabiliyordu. PC'deki senkron script'i oturumsuz çağırdığı için anahtar kabul edilir.
import { NextResponse } from "next/server";
import { ozetGetir } from "@/lib/arvento/stabilize-ozet-server";
import { oturumYaDaGorev, yetkisiz } from "@/lib/api/guvenlik";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!(await oturumYaDaGorev(req))) return yetkisiz();
  const { searchParams } = new URL(req.url);
  const bas = searchParams.get("bas") ?? "";
  const bitis = searchParams.get("bitis") ?? "";
  if (!bas || !bitis) {
    return NextResponse.json({ error: "bas ve bitis zorunlu (YYYY-MM-DD)" }, { status: 400 });
  }
  try {
    const force = searchParams.get("force") === "1"; // warming → bugünü TTL'e bakmadan tazeler
    const { dampers, girisler } = await ozetGetir(bas, bitis, force);
    return NextResponse.json({ dampers, girisler });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Stabilize özeti hatası: ${msg}` }, { status: 500 });
  }
}
