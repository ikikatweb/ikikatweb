// Personel bildirge "Düzelt" — dashboard'daki uyuşmazlık kartında kullanıcı bildirgedeki resmi tarihi
// kabul edince: (1) BORDRO'yu düzeltir → personel_atama_gecmisi'ndeki ilgili tarihi (çıkış=bitis_tarihi,
// giriş=baslangic_tarihi) eski tarihten bildirge tarihine çeker, (2) takip kaydını tamamlandı yapar.
// Service-role ile çalışır (personel eşleşmesi + atama güncellemesi tek yerde, güvenilir).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const supabase = createClient(url, key);

  let id: string | undefined;
  try { id = (await request.json())?.id; } catch { /* gövdesiz */ }
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

  // 1) Takip kaydı: eski tarih (islem_tarihi) + bildirgedeki resmi tarih (bildirge_tarihi)
  const { data: rec, error: e1 } = await supabase
    .from("personel_islem_takip")
    .select("personel_tc, personel_ad, tip, islem_tarihi, bildirge_tarihi")
    .eq("id", id).single();
  if (e1 || !rec) return NextResponse.json({ error: "Takip kaydı bulunamadı" }, { status: 404 });
  const yeni = rec.bildirge_tarihi;
  if (!yeni) return NextResponse.json({ error: "Bildirge tarihi yok — düzeltilecek tarih bilinmiyor." }, { status: 400 });
  const eski = rec.islem_tarihi;

  // 2) BORDRO düzeltme: personel_atama_gecmisi'ndeki tarihi eski→yeni çek (TC → personel → atama).
  let atamaGuncellendi = 0;
  const tc = (rec.personel_tc ?? "").replace(/\D/g, "");
  if (tc.length === 11 && eski) {
    const { data: p } = await supabase.from("personel").select("id").eq("tc_kimlik_no", tc).maybeSingle();
    if (p?.id) {
      const alan = rec.tip === "cikis" ? "bitis_tarihi" : "baslangic_tarihi";
      const { data: upd, error: e2 } = await supabase
        .from("personel_atama_gecmisi")
        .update({ [alan]: yeni })
        .eq("personel_id", p.id).eq(alan, eski)
        .select("id");
      if (!e2 && Array.isArray(upd)) atamaGuncellendi = upd.length;
    }
  }

  // 3) Takip kaydını tamamlandı yap (dashboard uyarısı kalksın)
  const { error: e3 } = await supabase
    .from("personel_islem_takip")
    .update({ islem_tarihi: yeni, durum: "tamamlandi", uyusmazlik: null, cevap_tarihi: new Date().toISOString() })
    .eq("id", id);
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  return NextResponse.json({ ok: true, yeni, atamaGuncellendi });
}
