// Bildirge TC uyuşmazlığı onayı — dashboard'daki "TC'yi düzelt ve kapat" düğmesi burayı çağırır.
//
// Gelen bildirgedeki TC ile bekleyen talebin TC'si tutmadığında (talebe yanlış TC yazılmışsa)
// senkron kaydı kapatmaz, uyusmazlik_tip='tc' + bildirge_tc ile işaretler. Kullanıcı onaylayınca:
//   1) talebin personel_tc'si bildirgedeki doğru TC ile düzeltilir,
//   2) talep "tamamlandi" yapılır.
// Personel kartına DOKUNULMAZ: uyuşmazlık zaten kartta doğru TC olduğu için tespit ediliyor.
//
// Service-role ile çalışır (RLS'i atlar).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const supabase = createClient(url, key);

  let id: string | undefined;
  try { const b = await request.json(); id = b?.id; } catch { /* gövdesiz */ }
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

  const { data: rec, error: e1 } = await supabase
    .from("personel_islem_takip")
    .select("personel_ad, personel_tc, bildirge_tc, uyusmazlik_tip, durum")
    .eq("id", id).single();
  if (e1 || !rec) return NextResponse.json({ error: "Takip kaydı bulunamadı" }, { status: 404 });
  if (rec.durum !== "bekliyor") return NextResponse.json({ error: "Kayıt zaten kapanmış" }, { status: 409 });
  if (rec.uyusmazlik_tip !== "tc" || !rec.bildirge_tc) {
    return NextResponse.json({ error: "Bu kayıtta TC uyuşmazlığı yok" }, { status: 400 });
  }

  const { error: e2 } = await supabase
    .from("personel_islem_takip")
    .update({
      personel_tc: rec.bildirge_tc,
      durum: "tamamlandi",
      uyusmazlik: null,
      uyusmazlik_tip: null,
      bildirge_tc: null,
      cevap_tarihi: new Date().toISOString(),
    })
    .eq("id", id).eq("durum", "bekliyor");
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ ok: true, eskiTc: rec.personel_tc, yeniTc: rec.bildirge_tc });
}
