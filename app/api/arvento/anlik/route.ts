// Arvento anlık konum — Supabase `arvento_anlik` tablosundan okur.
// Tabloyu, Arvento'nun İZİNLİ olduğu bir makinede çalışan senkron besler
// (scripts/arvento-anlik-sync.mjs). Böylece Vercel Arvento'ya hiç gitmez;
// Arvento'nun Vercel IP'sini engellemesi sorun olmaktan çıkar.
// GET /api/arvento/anlik → { araclar: [...], guncelleme: "...", kaynak: "db" }
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
    }
    const supabase = createClient(url, key);
    // "*" → "kontak" kolonu henüz eklenmemiş olsa bile sorgu patlamaz (kolon yoksa undefined gelir).
    const { data, error } = await supabase
      .from("arvento_anlik")
      .select("*");
    if (error) {
      // Tablo henüz yoksa anlaşılır mesaj
      if (/does not exist|arvento_anlik/i.test(error.message)) {
        return NextResponse.json(
          { error: "arvento_anlik tablosu yok. SQL'i çalıştırın ve senkronu başlatın." },
          { status: 500 },
        );
      }
      throw new Error(error.message);
    }
    const rows = (data ?? []) as {
      node: string; lat: number | null; lng: number | null; hiz: number | null;
      yon: number | null; tarih: string | null; adres: string | null; guncelleme: string | null;
      kontak?: boolean | null;
    }[];
    const araclar = rows.map((r) => ({
      node: r.node,
      plaka: null,
      lat: r.lat, lng: r.lng, hiz: r.hiz, yon: r.yon,
      tarih: r.tarih, adres: r.adres,
      kontak: r.kontak ?? null, // kontak açık=true / kapalı=false / bilinmiyor=null
      odometre: null,
      ham: {},
    }));
    // En güncel yazma zamanı (UI "veri tazeliği" gösterebilir)
    const guncelleme = rows.reduce<string | null>(
      (en, r) => (r.guncelleme && (!en || r.guncelleme > en) ? r.guncelleme : en),
      null,
    );
    // CDN önbelleği (Vercel Edge): aynı 30 sn içinde kaç kullanıcı/sekme sorarsa sorsun fonksiyon 1 kez
    // çalışır → Fluid Active CPU + invocation hacmi düşer. Veri zaten senkron script'ten 1-3 dk'da bir
    // yazıldığından 30 sn bayatlık gösterimi etkilemez. stale-while-revalidate: süre dolunca eskiyi anında
    // servis et, arkada tazele (kullanıcı bekletilmez).
    return NextResponse.json(
      { araclar, guncelleme, kaynak: "db" },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
