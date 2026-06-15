// Arvento raporu manuel içe aktarma API
//  - multipart/form-data: file=<.xlsx>  → dosyadan
//  - application/json:    { url: "..." } → indirme linkinden
import { NextResponse } from "next/server";
import { ingestArventoBuffer, ingestArventoUrl } from "@/lib/arvento/ingest";

export async function POST(request: Request) {
  try {
    const ctype = request.headers.get("content-type") ?? "";
    let sonuc;
    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "Dosya gerekli (file)" }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      sonuc = await ingestArventoBuffer(buf);
    } else {
      const body = await request.json().catch(() => ({}));
      const url = (body as { url?: string }).url;
      if (!url) return NextResponse.json({ error: "İndirme linki gerekli (url)" }, { status: 400 });
      sonuc = await ingestArventoUrl(url);
    }
    const parcalar: string[] = [];
    for (const c of sonuc.calismaGunler) parcalar.push(`${c.tarih} çalışma (${c.sayi} araç)`);
    if (sonuc.damperGunler.length > 0) {
      const toplamGun = sonuc.damperGunler.length;
      const toplamArac = sonuc.damperGunler.reduce((s, d) => s + d.sayi, 0);
      parcalar.push(`damper: ${toplamGun} gün / ${toplamArac} kayıt`);
    }
    return NextResponse.json({
      ok: true,
      calismaGunler: sonuc.calismaGunler,
      damperGunler: sonuc.damperGunler,
      mesaj: `İçe aktarıldı — ${parcalar.join(", ")}.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
