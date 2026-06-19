// Arvento anlık konum/durum — web servisinden (SOAP) çeker.
// GET /api/arvento/anlik → { araclar: [...], hamXml: "..." }
// hamXml geçici: gerçek yanıt yapısını görüp parser'ı kesinleştirmek için.
import { NextResponse } from "next/server";
import { cekAnlikDurum } from "@/lib/arvento/anlik";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
// Türkiye'ye en yakın Vercel bölgesi (Frankfurt) — Arvento'nun yabancı/uzak IP kısıtını azaltır
export const preferredRegion = "fra1";

export async function GET() {
  try {
    const r = await cekAnlikDurum();
    return NextResponse.json(r);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
