// Gece cron: iş makinelerinin göstergesini çalışma saatiyle ileri yürütür.
//
// Arvento makineler için saat vermiyor (anlık `odometre` = km), saat yalnız günlük raporlarda.
// Bu yüzden gösterge son elle okumadan itibaren hesaplanır:
//   gösterge = son okuma + (okumadan beri kontak saati) × katsayı
//
// Arvento rapor cron'u 18:00'de çalışıp o günün raporlarını yazdığı için bu cron ondan SONRA
// (19:00) tetiklenir; aksi hâlde hep bir gün geriden gelirdi.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { kontakSaati, projeksiyon } from "@/lib/arvento/makine-saat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from("araclar")
    .select("id, plaka, guncel_gosterge, son_okuma_deger, son_okuma_tarihi, saat_katsayi")
    .eq("sayac_tipi", "saat");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type M = {
    id: string; plaka: string; guncel_gosterge: number | null;
    son_okuma_deger: number | null; son_okuma_tarihi: string | null; saat_katsayi: number | null;
  };
  const makineler = (data ?? []) as M[];

  const simdi = new Date().toISOString();
  const guncellenen: { plaka: string; eski: number | null; yeni: number; saat: number }[] = [];
  const atlanan: string[] = [];

  for (const m of makineler) {
    // Okuması olmayan makine yürütülemez — kalibrasyon betiğiyle bir kez okuma girilmeli.
    if (m.son_okuma_deger == null || !m.son_okuma_tarihi) { atlanan.push(`${m.plaka}: okuma yok`); continue; }
    const baslangic = m.son_okuma_tarihi.slice(0, 10);
    const { saat } = await kontakSaati(sb, m.plaka, baslangic);
    const yeni = projeksiyon(m.son_okuma_deger, saat, m.saat_katsayi);
    if (yeni == null) { atlanan.push(`${m.plaka}: hesaplanamadı`); continue; }
    // Gösterge GERİ gitmesin: elle daha yüksek bir değer girilmişse (yakıt/puantaj ekranı)
    // onu ezmek veriyi bozardı — o değer sahadan gelen taze bilgidir.
    if (m.guncel_gosterge != null && yeni <= m.guncel_gosterge) continue;
    const { error: uErr } = await sb.from("araclar")
      .update({ guncel_gosterge: yeni, updated_at: simdi }).eq("id", m.id);
    if (uErr) { atlanan.push(`${m.plaka}: ${uErr.message}`); continue; }
    guncellenen.push({ plaka: m.plaka, eski: m.guncel_gosterge, yeni, saat: Math.round(saat) });
  }

  console.log(`[makine-saat cron] ${guncellenen.length}/${makineler.length} makine güncellendi`);
  return NextResponse.json({ makine: makineler.length, guncellenen, atlanan });
}
