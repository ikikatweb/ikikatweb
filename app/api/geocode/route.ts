// Adres → koordinat (OpenStreetMap Nominatim) — sunucu tarafı (CORS/UA sorunsuz).
// Kısaltmaları açar; bulunamazsa adresi kabalaştırıp (mahalle→ilçe→şehir) tekrar dener.
import { NextResponse } from "next/server";

const cache = new Map<string, { lat: number; lng: number } | null>();

function genislet(s: string): string {
  return s
    .replace(/\bMh\.?/gi, "Mahallesi")
    .replace(/\bMah\.?/gi, "Mahallesi")
    .replace(/\bMevkii?\b/gi, "")
    .replace(/\bSk\.?/gi, "Sokak")
    .replace(/\bCd\.?/gi, "Caddesi")
    .replace(/\bCad\.?/gi, "Caddesi")
    .replace(/\bBlv\.?/gi, "Bulvarı")
    .replace(/\bBul\.?/gi, "Bulvarı");
}

async function nominatim(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tr&q=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": "ikikatweb/1.0 (arac-takip)", Accept: "application/json" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) && d[0] ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) } : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q gerekli" }, { status: 400 });
  if (cache.has(q)) return NextResponse.json({ konum: cache.get(q) });

  const parcalar = genislet(q).split(",").map((s) => s.trim()).filter(Boolean);
  // En özelden kabaya: tüm adres → ilk parçayı at → ... → en az "İlçe, Şehir"
  let konum: { lat: number; lng: number } | null = null;
  for (let i = 0; i < Math.max(1, parcalar.length - 1); i++) {
    const aday = parcalar.slice(i).join(", ");
    konum = await nominatim(aday);
    if (konum) break;
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim nezaket gecikmesi
  }
  cache.set(q, konum);
  return NextResponse.json({ konum });
}
