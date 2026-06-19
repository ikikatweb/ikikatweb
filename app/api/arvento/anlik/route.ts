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
    const { data, error } = await supabase
      .from("arvento_anlik")
      .select("node, lat, lng, hiz, yon, tarih, adres, guncelleme");
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
    }[];
    const araclar = rows.map((r) => ({
      node: r.node,
      plaka: null,
      lat: r.lat, lng: r.lng, hiz: r.hiz, yon: r.yon,
      tarih: r.tarih, adres: r.adres,
      odometre: null,
      ham: {},
    }));
    // En güncel yazma zamanı (UI "veri tazeliği" gösterebilir)
    const guncelleme = rows.reduce<string | null>(
      (en, r) => (r.guncelleme && (!en || r.guncelleme > en) ? r.guncelleme : en),
      null,
    );
    return NextResponse.json({ araclar, guncelleme, kaynak: "db" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
