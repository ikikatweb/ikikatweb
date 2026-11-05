// Arvento cihaz kayıt defteri — node (strNode) ↔ plaka ↔ şoför eşlemesi.
//   GET  /api/arvento/cihaz            → kayıtlı cihaz listesi (service role okuma)
//   POST /api/arvento/cihaz  (Excel)   → "Cihazlar_*.xlsx" yükle → arvento_cihaz'a upsert
// Web servisi anlık konumu cihaz NODE'u ile döndürdüğü için Canlı sekmesi bu eşlemeyle
// plaka/şoför gösterir.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
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
    const sutunlar = "node, plaka, tescil, surucu, marka, model, sinif";
    let { data, error } = await supabase.from("arvento_cihaz").select(`${sutunlar}, sessiz_onay`);
    // sessiz_onay sütunu (sql/arvento_cihaz_sessiz_onay.sql) çalıştırılmamış olabilir →
    // tüm cihaz listesini kaybetmek yerine sütunsuz dön; eksiklik log'a yazılır.
    if (error && /sessiz_onay/.test(error.message)) {
      console.warn("[cihaz] sessiz_onay sütunu yok — sql/arvento_cihaz_sessiz_onay.sql çalıştırılmalı.");
      ({ data, error } = await supabase.from("arvento_cihaz").select(sutunlar));
    }
    if (error) throw new Error(error.message);
    // Cihaz↔plaka eşlemesi nadiren değişir (yalnız Excel yüklenince) → 5 dk CDN önbelleği: her sayfa
    // açılışında fonksiyon çalıştırmak yerine Edge'den servis edilir (Fluid CPU tasarrufu).
    return NextResponse.json(
      { cihazlar: data ?? [] },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
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

// PATCH /api/arvento/cihaz  { node, model } → tek cihazın harita etiketini (model) güncelle.
// arvento_cihaz'da anon/authenticated UPDATE RLS politikası YOK (client update 0 satır etkiler, sessizce başarısız).
// Bu yüzden etiket düzenlemesi service role ile buradan yazılır. Oturum kontrolü: yalnız giriş yapmış kullanıcı.
export async function PATCH(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const cookieStore = await cookies();
    const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const node = typeof body?.node === "string" ? body.node.trim() : "";
    if (!node) return NextResponse.json({ error: "node zorunlu" }, { status: 400 });

    const supabase = serviceClient();

    // İKİ AYRI İŞ, TEK ROTA: "model" harita etiketini, "sessizOnay" sessiz cihaz uyarısının
    // susturulmasını yazar. Alanın GÖNDERİLMİŞ olması ile boş olması farklıdır: sessizOnay
    // null gönderilirse susturma GERİ ALINIR, hiç gönderilmezse dokunulmaz.
    const yama: Record<string, string | null> = {};
    if ("model" in (body ?? {})) yama.model = (typeof body.model === "string" ? body.model.trim() : "") || null;
    if ("sessizOnay" in (body ?? {})) yama.sessiz_onay = typeof body.sessizOnay === "string" && body.sessizOnay.trim() ? body.sessizOnay.trim() : null;
    if (Object.keys(yama).length === 0) return NextResponse.json({ error: "güncellenecek alan yok" }, { status: 400 });

    const { error } = await supabase.from("arvento_cihaz").update(yama).eq("node", node);
    if (error) {
      // Sütun yoksa sebebi AÇIKÇA söyle: "kaydedilmedi" diyip susmak, kullanıcının düğmeye
      // basıp bir şey olmadığını sanmasına yol açar.
      if (/sessiz_onay/.test(error.message)) {
        return NextResponse.json({
          error: "sessiz_onay sütunu yok — sql/arvento_cihaz_sessiz_onay.sql çalıştırılmalı.",
        }, { status: 500 });
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
