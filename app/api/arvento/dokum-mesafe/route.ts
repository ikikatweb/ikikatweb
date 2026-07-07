// Döküm sahası + ocak→saha yol mesafesi — TARAYICI çağırır (kamyon GPS'i özet modunda inmiyor, burada sunucuda hesaplanır).
// GET /api/arvento/dokum-mesafe?bas=YYYY-MM-DD&bitis=YYYY-MM-DD
//   → { saha: {lat,lng} | null, mesafeM, straightM, oran, dumpCount, gunSayisi }
// Mantık: aralıktaki GERÇEK damper (döküm) noktalarını (mükerrer/arıza hariç) kümele → en yoğun saha = ana
// döküm sahası; oran %'si gerçekler arasından. Sonra son
// birkaç günün kamyon rotasından, YÜKLEME NOKTASINDAN (ocak içinde durup yüklendiği yer, en düşük hız) ana
// sahaya kadar İZ ÜZERİNDEN (yol boyunca) mesafeyi ölç → medyan. Ocak/damper/güzergah service-role okunur.
import { NextResponse } from "next/server";
import { serviceClient, ozetGetir } from "@/lib/arvento/stabilize-ozet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const R = 6371000;
type P = { lat: number; lng: number };
function hav(a: P, b: P) { const t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lng - a.lng) * t; const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function sec(saat: string | null) { if (!saat) return -1; const m = String(saat).match(/(\d+):(\d+)(?::(\d+))?/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0)) : -1; }
function medyan(a: number[]) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bas = searchParams.get("bas") ?? "", bitis = searchParams.get("bitis") ?? "";
  if (!bas || !bitis) return NextResponse.json({ error: "bas ve bitis zorunlu" }, { status: 400 });
  try {
    const sb = serviceClient();
    // 1) Ocak (bitişe göre en son kayıt) + yarıçap
    const { data: ocakRow } = await sb.from("arvento_ocak").select("lat, lng, yaricap").lte("gecerli_tarih", bitis).order("gecerli_tarih", { ascending: false }).limit(1).maybeSingle();
    if (!ocakRow || ocakRow.lat == null) return NextResponse.json({ saha: null, mesafeM: 0, oran: 0, dumpCount: 0 });
    const ocak: P = { lat: ocakRow.lat as number, lng: ocakRow.lng as number };
    const { data: ayar } = await sb.from("arvento_ayarlar").select("ocak_yaricap").eq("id", "global").maybeSingle();
    const yaricap = (ocakRow.yaricap as number) ?? (ayar?.ocak_yaricap as number) ?? 150;

    // 2) GERÇEK döküm noktaları — sınıflanmış özetten (mükerrer/arıza HARİÇ). Oran, %kaçının ana sahada
    //    olduğunu YALNIZ gerçek damperler arasından hesaplar (yanlış tetikler payı şişirmesin).
    const { dampers } = await ozetGetir(bas, bitis);
    const dokumler: { lat: number; lng: number; plaka: string; tarih: string; s: number }[] = [];
    for (const d of dampers) {
      if (d.mukerrer || d.ariza) continue;                       // yalnız GERÇEK damper
      const lat = d.durakLat ?? d.rawLat, lng = d.durakLng ?? d.rawLng;
      if (lat == null || lng == null) continue;
      dokumler.push({ lat, lng, plaka: d.plaka, tarih: d.tarih, s: sec(d.saat) });
    }
    if (dokumler.length === 0) return NextResponse.json({ saha: null, mesafeM: 0, oran: 0, dumpCount: 0 });

    // 3) ~250 m ızgara → en kalabalık hücre + 500 m çevresi = ANA SAHA (centroid)
    const CELL = 0.0025; const bin = new Map<string, number>();
    for (const d of dokumler) { const k = `${Math.round(d.lat / CELL)}_${Math.round(d.lng / CELL)}`; bin.set(k, (bin.get(k) ?? 0) + 1); }
    const [tk] = [...bin.entries()].sort((a, b) => b[1] - a[1])[0];
    const [glat, glng] = tk.split("_").map(Number);
    const merkez0: P = { lat: glat * CELL, lng: glng * CELL };
    const ana = dokumler.filter((d) => hav(d, merkez0) < 500);
    const saha: P = { lat: ana.reduce((a, d) => a + d.lat, 0) / ana.length, lng: ana.reduce((a, d) => a + d.lng, 0) / ana.length };
    const straightM = hav(ocak, saha);

    // 4) Yol mesafesi: sahadaki dökümleri güne göre grupla; bitişten geriye en fazla 5 gün, ≥8 ölçüm olana dek
    const gunlerDesc = [...new Set(ana.map((d) => d.tarih))].sort((a, b) => (a < b ? 1 : -1));
    const legs: number[] = [];
    let islenen = 0;
    for (const gun of gunlerDesc) {
      if (legs.length >= 8 || islenen >= 5) break;
      const gunDokum = ana.filter((d) => d.tarih === gun);
      const plakalar = [...new Set(gunDokum.map((d) => d.plaka))];
      if (!plakalar.length) continue;
      islenen++;
      const { data: guz } = await sb.from("arac_arvento_guzergah").select("plaka, noktalar").eq("rapor_tarihi", gun).in("plaka", plakalar);
      const guzMap = new Map((guz ?? []).map((g: any) => [g.plaka, g.noktalar ?? []]));
      for (const plaka of plakalar) {
        const pts = (guzMap.get(plaka) ?? []).filter((p: any) => p.lat != null && p.lng != null).map((p: any) => ({ lat: p.lat, lng: p.lng, hiz: p.hiz ?? null, s: sec(p.saat) })).sort((a: any, b: any) => a.s - b.s);
        if (pts.length < 5) continue;
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + hav(pts[i - 1], pts[i]);
        const inside = pts.map((p: any) => hav(p, ocak) < yaricap);
        for (const d of gunDokum.filter((x) => x.plaka === plaka)) {
          let di = 0, best = Infinity; for (let i = 0; i < pts.length; i++) { const dd = Math.abs(pts[i].s - d.s); if (dd < best) { best = dd; di = i; } }
          let b = -1; for (let j = di; j >= 0; j--) { if (inside[j]) { b = j; break; } }
          if (b < 0) continue;
          let a = b; while (a - 1 >= 0 && inside[a - 1]) a--;
          let load = a, minH = Infinity;
          for (let j = a; j <= b; j++) { const h = pts[j].hiz; if (h != null && h < minH) { minH = h; load = j; } }
          if (minH === Infinity) load = Math.floor((a + b) / 2);
          if (di > load) { const m = cum[di] - cum[load]; if (m > 300) legs.push(m); }
        }
      }
    }
    const mesafeM = legs.length ? medyan(legs) : 0;
    return NextResponse.json({
      saha: { lat: saha.lat, lng: saha.lng },
      mesafeM: Math.round(mesafeM),
      straightM: Math.round(straightM),
      oran: Math.round((100 * ana.length) / dokumler.length),
      dumpCount: ana.length,
      toplamDokum: dokumler.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Döküm mesafe hatası: ${msg}` }, { status: 500 });
  }
}
