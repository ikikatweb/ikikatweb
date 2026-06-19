// Arvento cihaz kayıt defteri — node (strNode) ↔ plaka ↔ şoför eşlemesi.
//   GET  /api/arvento/cihaz            → kayıtlı cihaz listesi (service role okuma)
//   POST /api/arvento/cihaz  (Excel)   → "Cihazlar_*.xlsx" yükle → arvento_cihaz'a upsert
// Web servisi anlık konumu cihaz NODE'u ile döndürdüğü için Canlı sekmesi bu eşlemeyle
// plaka/şoför gösterir.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase yapılandırması eksik");
  return createClient(url, key);
}

const norm = (s: unknown) =>
  String(s ?? "").toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç]/g, "");

export async function GET() {
  try {
    const supabase = serviceClient();
    const { data, error } = await supabase
      .from("arvento_cihaz")
      .select("node, plaka, tescil, surucu, marka, model, sinif");
    if (error) throw new Error(error.message);
    return NextResponse.json({ cihazlar: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Dosya gerekli (file)" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const satirlar = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
    if (satirlar.length < 2) return NextResponse.json({ error: "Boş dosya" }, { status: 400 });

    // Başlık satırından sütun indekslerini bul (sıra/ad değişse de çalışsın)
    const baslik = satirlar[0].map((h) => norm(h));
    const idx = (...anahtarlar: string[]) =>
      baslik.findIndex((h) => anahtarlar.some((a) => h === norm(a) || h.includes(norm(a))));
    const cNode = idx("Cihaz");
    const cPlaka = idx("Plaka");
    const cTescil = idx("Araç Tescil Plakası", "Tescil");
    const cSurucu = idx("Sürücü", "Surucu", "Şoför", "Sofor");
    const cMarka = idx("Araç Markası", "Marka");
    const cModel = idx("Araç Modeli", "Model");
    const cSinif = idx("Araç Sınıfı", "Sınıf");
    if (cNode < 0) return NextResponse.json({ error: "‘Cihaz’ sütunu bulunamadı" }, { status: 400 });

    const al = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    const kayitlar: Record<string, string | null>[] = [];
    for (let i = 1; i < satirlar.length; i++) {
      const r = satirlar[i];
      const node = al(r, cNode);
      if (!node) continue;
      const plaka = al(r, cPlaka) || al(r, cTescil); // Plaka yoksa Tescil
      kayitlar.push({
        node,
        plaka: plaka || null,
        tescil: al(r, cTescil) || null,
        surucu: al(r, cSurucu) || null,
        marka: al(r, cMarka) || null,
        model: al(r, cModel) || null,
        sinif: al(r, cSinif) || null,
      });
    }
    if (kayitlar.length === 0) return NextResponse.json({ error: "Cihaz satırı bulunamadı" }, { status: 400 });

    const supabase = serviceClient();
    const { error } = await supabase.from("arvento_cihaz").upsert(kayitlar, { onConflict: "node" });
    if (error) throw new Error(error.message);
    const surucuSayi = kayitlar.filter((k) => k.surucu).length;
    return NextResponse.json({ ok: true, sayi: kayitlar.length, surucuSayi });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
