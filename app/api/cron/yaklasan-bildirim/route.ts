// Günlük yaklaşan sigorta/muayene + araç bakımı bildirimleri
// Vercel Cron Jobs ile otomatik tetiklenir (vercel.json'da tanımlı)
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToYoneticiler } from "@/lib/push";

export async function GET(request: Request) {
  // Güvenlik: Cron secret kontrolü (Vercel Cron Jobs için)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const bugunMs = new Date().setHours(0, 0, 0, 0);

  // ========== YAKLAŞAN SİGORTA/MUAYENE ==========
  // Araçların trafik/kasko/muayene/taşıt kartı bitiş tarihleri + poliçe bitişleri
  const { data: araclar } = await supabase
    .from("araclar")
    .select("id, plaka, marka, model, tip, durum, muayene_bitis, tasit_karti_bitis, trafik_sigorta_bitis, kasko_bitis")
    .eq("tip", "ozmal")
    .neq("durum", "trafikten_cekildi");

  const { data: policeler } = await supabase
    .from("arac_police")
    .select("arac_id, police_tipi, bitis_tarihi");

  const policeMap = new Map<string, { kasko?: string; trafik?: string }>();
  for (const p of policeler ?? []) {
    if (!p.arac_id || !p.bitis_tarihi) continue;
    const e = policeMap.get(p.arac_id) ?? {};
    if (p.police_tipi === "kasko" && (!e.kasko || p.bitis_tarihi > e.kasko)) e.kasko = p.bitis_tarihi;
    if (p.police_tipi === "trafik" && (!e.trafik || p.bitis_tarihi > e.trafik)) e.trafik = p.bitis_tarihi;
    policeMap.set(p.arac_id, e);
  }

  type Yaklasan = { plaka: string; tip: string; tarih: string; kalanGun: number };
  const yaklasanlar: Yaklasan[] = [];

  for (const a of araclar ?? []) {
    const pc = policeMap.get(a.id);
    const kontroller: [string, string | null][] = [
      ["Trafik Sigorta", pc?.trafik || null],
      ["Kasko", pc?.kasko || null],
      ["Muayene", a.muayene_bitis],
      ["Taşıt Kartı", a.tasit_karti_bitis],
    ];
    for (const [tip, tarih] of kontroller) {
      if (!tarih) continue;
      const kalan = Math.ceil((new Date(tarih + "T00:00:00").getTime() - bugunMs) / 86400000);
      if (kalan <= 30 && kalan >= -7) {
        yaklasanlar.push({ plaka: a.plaka, tip, tarih, kalanGun: kalan });
      }
    }
  }

  // ========== YAKLAŞAN ARAÇ BAKIMLARI ==========
  const { data: bakimlar } = await supabase
    .from("arac_bakim")
    .select("arac_id, tip, bakim_tarihi, sonraki_bakim_km, sonraki_bakim_tarihi, araclar(plaka, marka, model, guncel_gosterge)")
    .eq("tip", "bakim");

  type BakimRow = {
    arac_id: string;
    tip: string;
    bakim_tarihi: string;
    sonraki_bakim_km: number | null;
    sonraki_bakim_tarihi: string | null;
    araclar: { plaka: string; marka: string | null; model: string | null; guncel_gosterge: number | null } | { plaka: string; marka: string | null; model: string | null; guncel_gosterge: number | null }[] | null;
  };
  const sonBakim = new Map<string, BakimRow>();
  for (const b of (bakimlar ?? []) as BakimRow[]) {
    const mevcut = sonBakim.get(b.arac_id);
    if (!mevcut || b.bakim_tarihi > mevcut.bakim_tarihi) sonBakim.set(b.arac_id, b);
  }

  const yaklasanBakimlar: { plaka: string; sebep: string }[] = [];
  for (const b of sonBakim.values()) {
    const arac = Array.isArray(b.araclar) ? b.araclar[0] : b.araclar;
    if (!arac) continue;
    const guncelKm = arac.guncel_gosterge;
    let kmFark: number | undefined;
    let kalanGun: number | undefined;
    if (b.sonraki_bakim_km != null && guncelKm != null) kmFark = b.sonraki_bakim_km - guncelKm;
    if (b.sonraki_bakim_tarihi) {
      kalanGun = Math.ceil((new Date(b.sonraki_bakim_tarihi + "T00:00:00").getTime() - bugunMs) / 86400000);
    }
    const kmYaklasti = kmFark != null && kmFark <= 500;
    const tarihYaklasti = kalanGun != null && kalanGun <= 30;
    if (kmYaklasti || tarihYaklasti) {
      const sebepler: string[] = [];
      if (kmFark != null && kmFark <= 500) {
        sebepler.push(kmFark < 0 ? `${Math.abs(kmFark).toLocaleString("tr-TR")} km geçti` : `${kmFark.toLocaleString("tr-TR")} km kaldı`);
      }
      if (kalanGun != null && kalanGun <= 30) {
        sebepler.push(kalanGun < 0 ? `${Math.abs(kalanGun)} gün geçti` : `${kalanGun} gün kaldı`);
      }
      yaklasanBakimlar.push({ plaka: arac.plaka, sebep: sebepler.join(" · ") });
    }
  }

  // ========== BİLDİRİMLERİ GÖNDER ==========
  let toplamGonderilen = 0;

  if (yaklasanlar.length > 0) {
    const ilkUc = yaklasanlar.slice(0, 3).map((y) => `${y.plaka} ${y.tip}`).join(", ");
    const sent = await sendPushToYoneticiler({
      title: `📋 Yaklaşan Sigorta & Muayene (${yaklasanlar.length} adet)`,
      body: yaklasanlar.length <= 3 ? ilkUc : `${ilkUc} ve ${yaklasanlar.length - 3} adet daha`,
      url: "/dashboard",
      tag: "yaklasan-sigorta",
    });
    toplamGonderilen += sent;
  }

  if (yaklasanBakimlar.length > 0) {
    const ilkUc = yaklasanBakimlar.slice(0, 3).map((y) => `${y.plaka} (${y.sebep})`).join(", ");
    const sent = await sendPushToYoneticiler({
      title: `🛠️ Yaklaşan Araç Bakımları (${yaklasanBakimlar.length} adet)`,
      body: yaklasanBakimlar.length <= 3 ? ilkUc : `${ilkUc} ve ${yaklasanBakimlar.length - 3} adet daha`,
      url: "/dashboard/arac-bakim",
      tag: "yaklasan-bakim",
    });
    toplamGonderilen += sent;
  }

  return NextResponse.json({
    success: true,
    yaklasanSigorta: yaklasanlar.length,
    yaklasanBakim: yaklasanBakimlar.length,
    bildirimGonderilen: toplamGonderilen,
  });
}
