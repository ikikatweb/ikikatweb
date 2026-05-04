// Yi-ÜFE veri çekme API route - Tanımlamalar'daki URL'den endeks verilerini scrape eder
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
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
  // İki yetki yolu: (a) Cron secret (Vercel Cron Jobs), (b) Authenticated yönetici (manuel buton)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const cronAuthOk = cronSecret ? authHeader === `Bearer ${cronSecret}` : true;

  // Cron header'ı yoksa kullanıcının login olup olmadığına bak.
  // Sayfa erişimi zaten "yonetim-yi-ufe" izniyle filtreleniyor — burada sadece auth kontrolü yeterli.
  let userAuthOk = false;
  if (!cronAuthOk) {
    try {
      const cookieStore = await cookies();
      const supabaseAuth = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return cookieStore.getAll(); },
            setAll() {},
          },
        },
      );
      const { data: { user } } = await supabaseAuth.auth.getUser();
      if (user) userAuthOk = true;
    } catch { /* sessiz */ }
  }

  if (!cronAuthOk && !userAuthOk) {
    return NextResponse.json({ error: "Yetkisiz erişim — login olmanız gerekir" }, { status: 401 });
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
    // ERKEN ÇIKIŞ: Bir önceki ayın verisi zaten DB'de varsa scrape yapma.
    // (TÜİK ayın 3'ünde GEÇEN ay'ın verisini açıklar; geçen ayın verisi
    //  varsa bu ay için yapacağımız bir şey yok.)
    // Cron her 5 dk çalışsa bile, veri çekildikten sonra sessizce hızlı return eder.
    const simdi = new Date();
    const oncekiAyTarih = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
    const beklenenYil = oncekiAyTarih.getFullYear();
    const beklenenAy = oncekiAyTarih.getMonth() + 1; // 1-12
    const { data: mevcutKayit } = await supabase
      .from("yi_ufe")
      .select("id")
      .eq("yil", beklenenYil)
      .eq("ay", beklenenAy)
      .maybeSingle();
    if (mevcutKayit) {
      return NextResponse.json({
        basarili: true,
        atlandi: true,
        mesaj: `Geçen ay (${beklenenAy}/${beklenenYil}) zaten kayıtlı — scrape atlandı.`,
        toplamVeri: 0,
        yeniKayit: 0,
      });
    }

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
    // URL'yi normalize et: bazı formlar otomatik kapitalleştiriyor (Https://Www...)
    // ama hakedis.org path'i case-sensitive — küçük harfe çevirip 404'ü engelle
    const scrapeUrl = String(urlTanim.deger).toLowerCase().trim();

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

    // Sadece 2020 ve sonrası verileri güncelle — 2020 öncesi elle girilir, scrape ile ezilmez
    // Ek sanity check: 2020+ Yi-ÜFE endeksleri 450'den düşük olamaz (saçma placeholder değerler engellensin)
    const filtreli = veriler.filter((v) => v.yil >= 2020 && v.endeks >= 100);

    if (filtreli.length === 0) {
      return NextResponse.json({ basarili: true, toplamVeri: 0, yeniKayit: 0, sonVeri: { yil: 0, ay: "", endeks: 0 } });
    }

    // Supabase'e upsert (sadece 2020+ verileri güncelle/ekle)
    const { data, error } = await supabase
      .from("yi_ufe")
      .upsert(filtreli, { onConflict: "yil,ay" })
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
