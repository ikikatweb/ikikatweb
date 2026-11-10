// PRİM DENGESİ UYARISI — "görüldü" kaydının sunucu tarafı.
//
// NİYE SUNUCUDA: kayıt eskiden tarayıcının localStorage'ındaydı; bilgisayarda
// kapatılan uyarı telefonda yeniden çıkıyordu (gerekçe: sql/prim_dengesi_gorulen.sql).
//
// YAZMA SERVICE ROLE İLE: kullanıcı yalnız KENDİ satırlarını okuyabiliyor (RLS),
// yazma buradan geçiyor ve kullanıcı oturumdan çözülüyor — kimse başkasının
// uyarısını kapatamasın.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Kayit = { sonTespit: string; anaEkrandaGosterildi: boolean; imza?: string };

function servis() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Kullanıcının kendi "görüldü" deposu. */
export async function GET() {
  const k = await oturum();
  if (!k) return yetkisiz();
  const { data, error } = await servis()
    .from("prim_dengesi_gorulen")
    .select("santiye_id, son_tespit, ana_ekranda_gosterildi, imza")
    .eq("kullanici_id", k.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const depo: Record<string, Kayit> = {};
  for (const r of data ?? []) {
    depo[r.santiye_id as string] = {
      sonTespit: r.son_tespit as string,
      anaEkrandaGosterildi: Boolean(r.ana_ekranda_gosterildi),
      imza: (r.imza as string | null) ?? undefined,
    };
  }
  return NextResponse.json({ depo });
}

/**
 * İki iş:
 *   { depo }        → deponun TAMAMINI yazar (listeden düşen işlerin satırı silinir)
 *   { gosterildi }  → verilen işleri "ana ekranda gösterildi" yapar
 * İkisi aynı istekte de gelebilir (ayrılırken tek atış).
 */
export async function POST(request: Request) {
  const k = await oturum();
  if (!k) return yetkisiz();

  let govde: { depo?: Record<string, Kayit>; gosterildi?: string[] } = {};
  try { govde = await request.json(); } catch { /* gövdesiz */ }
  const sb = servis();

  if (govde.depo) {
    const satirlar = Object.entries(govde.depo).map(([santiye_id, v]) => ({
      kullanici_id: k.id,
      santiye_id,
      son_tespit: v.sonTespit || new Date().toISOString(),
      ana_ekranda_gosterildi: Boolean(v.anaEkrandaGosterildi),
      imza: v.imza ?? null,
      guncelleme: new Date().toISOString(),
    }));

    // LİSTEDEN DÜŞENİ SİL: iş yeniden riske girerse YENİ sayılsın ve uyarı çıksın.
    const kalanlar = satirlar.map((s) => s.santiye_id);
    const sil = sb.from("prim_dengesi_gorulen").delete().eq("kullanici_id", k.id);
    const { error: silHatasi } = kalanlar.length
      ? await sil.not("santiye_id", "in", `(${kalanlar.join(",")})`)
      : await sil;
    if (silHatasi) return NextResponse.json({ error: silHatasi.message }, { status: 500 });

    if (satirlar.length) {
      const { error } = await sb.from("prim_dengesi_gorulen")
        .upsert(satirlar, { onConflict: "kullanici_id,santiye_id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (govde.gosterildi?.length) {
    const { error } = await sb.from("prim_dengesi_gorulen")
      .update({ ana_ekranda_gosterildi: true, guncelleme: new Date().toISOString() })
      .eq("kullanici_id", k.id)
      .in("santiye_id", govde.gosterildi);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
