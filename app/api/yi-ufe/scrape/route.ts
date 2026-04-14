// Yi-ÜFE veri çekme API route - Tanımlamalar'daki URL'den endeks verilerini scrape eder
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const AY_ISIMLERI = [
  "OCAK",
  "ŞUBAT",
  "MART",
  "NİSAN",
  "MAYIS",
  "HAZİRAN",
  "TEMMUZ",
  "AĞUSTOS",
  "EYLÜL",
  "EKİM",
  "KASIM",
  "ARALIK",
];

export async function GET(request: Request) {
  // Güvenlik kontrolü: Cron secret veya Authorization header
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Cron secret tanımlıysa kontrol et (Vercel Cron Jobs için)
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase yapılandırması eksik" },
      { status: 500 }
    );
  }

  // Server tarafında service role key ile bağlan (RLS bypass)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // URL'yi tanımlamalardan çek
    const { data: urlTanim } = await supabase
      .from("tanimlamalar")
      .select("deger")
      .eq("kategori", "Yi-ÜFE Veri Kaynağı")
      .eq("aktif", true)
      .limit(1)
      .single();

    if (!urlTanim?.deger) {
      return NextResponse.json(
        { error: "Yi-ÜFE veri kaynağı URL'si tanımlanmamış. Tanımlamalar > Yi-ÜFE Veri Kaynağı'ndan URL ekleyin." },
        { status: 400 }
      );
    }
    const scrapeUrl = urlTanim.deger;

    const response = await fetch(scrapeUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Site erişim hatası: ${response.status}` },
        { status: 502 }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Tabloyu bul ve parse et
    const veriler: { yil: number; ay: number; endeks: number }[] = [];

    $("table tbody tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;

      const yilText = $(cells[0]).text().trim();
      const yil = parseInt(yilText);
      if (isNaN(yil) || yil < 1994) return;

      cells.each((cellIndex, cell) => {
        if (cellIndex === 0) return; // İlk sütun yıl
        const ay = cellIndex; // 1-12 arası
        if (ay > 12) return;

        const degerText = $(cell).text().trim().replace(",", ".");
        const endeks = parseFloat(degerText);

        if (!isNaN(endeks) && endeks > 0) {
          veriler.push({ yil, ay, endeks });
        }
      });
    });

    if (veriler.length === 0) {
      // Tablo bulunamadıysa alternatif seçici dene
      $("table tr").each((_, row) => {
        const cells = $(row).find("td, th");
        if (cells.length < 2) return;

        const yilText = $(cells.first()).text().trim();
        const yil = parseInt(yilText);
        if (isNaN(yil) || yil < 1994) return;

        cells.each((cellIndex, cell) => {
          if (cellIndex === 0) return;
          const ay = cellIndex;
          if (ay > 12) return;

          const degerText = $(cell).text().trim().replace(",", ".");
          const endeks = parseFloat(degerText);

          if (!isNaN(endeks) && endeks > 0) {
            veriler.push({ yil, ay, endeks });
          }
        });
      });
    }

    if (veriler.length === 0) {
      return NextResponse.json(
        { error: "Siteden veri okunamadı", yeniKayit: 0 },
        { status: 200 }
      );
    }

    // Supabase'e upsert (mevcut verileri güncelle, yenileri ekle)
    const { data, error } = await supabase
      .from("yi_ufe")
      .upsert(veriler, { onConflict: "yil,ay" })
      .select();

    if (error) {
      return NextResponse.json(
        { error: `Veritabanı hatası: ${error.message}` },
        { status: 500 }
      );
    }

    // En son veriyi bul
    const sonVeri = veriler.reduce((max, v) =>
      v.yil > max.yil || (v.yil === max.yil && v.ay > max.ay) ? v : max
    );

    return NextResponse.json({
      basarili: true,
      toplamVeri: veriler.length,
      yeniKayit: data?.length ?? 0,
      sonVeri: {
        yil: sonVeri.yil,
        ay: AY_ISIMLERI[sonVeri.ay - 1],
        endeks: sonVeri.endeks,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
