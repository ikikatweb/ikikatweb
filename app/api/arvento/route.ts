// Arvento raporu manuel içe aktarma API
//  - multipart/form-data: file=<.xlsx>        → dosyadan (küçük dosyalar)
//  - application/json:    { url: "..." }       → indirme linkinden
//  - application/json:    { bucket, path }     → Storage'a önceden yüklenmiş dosyadan
//                                                (büyük .xlsx için imzalı yükleme yolu)
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
      const body = (await request.json().catch(() => ({}))) as {
        url?: string;
        bucket?: string;
        path?: string;
      };
      if (body.bucket && body.path) {
        // Storage'dan oku (service role) → işle → geçici dosyayı sil
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
          return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, serviceKey);
        const { data, error } = await supabase.storage.from(body.bucket).download(body.path);
        if (error || !data) {
          return NextResponse.json(
            { error: `Yüklenen dosya okunamadı: ${error?.message ?? "bulunamadı"}` },
            { status: 400 },
          );
        }
        const buf = Buffer.from(await data.arrayBuffer());
        sonuc = await ingestArventoBuffer(buf);
        // Geçici dosyayı temizle (hata olsa da akışı bozma)
        await supabase.storage.from(body.bucket).remove([body.path]).catch(() => {});
      } else if (body.url) {
        sonuc = await ingestArventoUrl(body.url);
      } else {
        return NextResponse.json(
          { error: "İndirme linki (url) veya yükleme referansı (bucket, path) gerekli" },
          { status: 400 },
        );
      }
    }
    const parcalar: string[] = [];
    for (const c of sonuc.calismaGunler) parcalar.push(`${c.tarih} çalışma (${c.sayi} araç)`);
    if (sonuc.damperGunler.length > 0) {
      const toplamGun = sonuc.damperGunler.length;
      const toplamArac = sonuc.damperGunler.reduce((s, d) => s + d.sayi, 0);
      parcalar.push(`damper: ${toplamGun} gün / ${toplamArac} kayıt`);
    }
    if (sonuc.guzergahGunler && sonuc.guzergahGunler.length > 0) {
      const toplamGun = sonuc.guzergahGunler.length;
      const toplamArac = sonuc.guzergahGunler.reduce((s, d) => s + d.sayi, 0);
      parcalar.push(`güzergah: ${toplamGun} gün / ${toplamArac} araç`);
    }
    if (sonuc.kontakGunler && sonuc.kontakGunler.length > 0) {
      const toplamGun = sonuc.kontakGunler.length;
      const toplamArac = sonuc.kontakGunler.reduce((s, d) => s + d.sayi, 0);
      parcalar.push(`kontak saatleri: ${toplamGun} gün / ${toplamArac} araç`);
    }
    // (Stabilize özet önbelleği, ingestArventoBuffer içinde damper/güzergah değişen günler için otomatik
    //  geçersiz kılınır → burada ayrıca yapmaya gerek yok.)
    return NextResponse.json({
      ok: true,
      calismaGunler: sonuc.calismaGunler,
      damperGunler: sonuc.damperGunler,
      guzergahGunler: sonuc.guzergahGunler ?? [],
      kontakGunler: sonuc.kontakGunler ?? [],
      mesaj: `İçe aktarıldı — ${parcalar.join(", ")}.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
