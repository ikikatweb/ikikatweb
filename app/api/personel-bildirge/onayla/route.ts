// Personel bildirge SİCİL onayı — dashboard'daki sicil uyarısında kullanıcı "yine de kapat" ya da
// "sicili gir ve kapat" deyince: (yazSicil=true ise) bildirgeden okunan sicili kaydın şantiyesinin
// iscilik_takibi.sicil_no alanına yazar, ardından takip kaydını "tamamlandi" yapar.
// Service-role ile çalışır (RLS'i atlar; iscilik_takibi yazımı güvenilir tek yerde).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sicilEslesir } from "@/lib/personel/sicil";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const supabase = createClient(url, key);

  let id: string | undefined, yazSicil = false;
  try { const b = await request.json(); id = b?.id; yazSicil = b?.yazSicil === true; } catch { /* gövdesiz */ }
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

  // Takip kaydı: okunan sicil + hedef şantiye
  const { data: rec, error: e1 } = await supabase
    .from("personel_islem_takip")
    .select("cevap_sicil, sicil_santiye_id, durum")
    .eq("id", id).single();
  if (e1 || !rec) return NextResponse.json({ error: "Takip kaydı bulunamadı" }, { status: 404 });

  // İsteğe bağlı: bildirgedeki sicili şantiyenin işçilik takibine yaz (boş sicil durumunda).
  let sicilYazildi = false;
  if (yazSicil && rec.cevap_sicil && rec.sicil_santiye_id) {
    const { data: mevcut } = await supabase
      .from("iscilik_takibi").select("id").eq("santiye_id", rec.sicil_santiye_id).maybeSingle();
    if (mevcut?.id) {
      const { error: e2 } = await supabase
        .from("iscilik_takibi")
        .update({ sicil_no: rec.cevap_sicil, updated_at: new Date().toISOString() })
        .eq("id", mevcut.id);
      if (!e2) sicilYazildi = true;
    } else {
      const { error: e2 } = await supabase
        .from("iscilik_takibi").insert({ santiye_id: rec.sicil_santiye_id, sicil_no: rec.cevap_sicil });
      if (!e2) sicilYazildi = true;
    }
  }

  // Takip kaydını tamamlandı yap (dashboard uyarısı kalksın) + uyuşmazlık işaretlerini temizle.
  const { error: e3 } = await supabase
    .from("personel_islem_takip")
    .update({ durum: "tamamlandi", uyusmazlik: null, uyusmazlik_tip: null, cevap_tarihi: new Date().toISOString() })
    .eq("id", id);
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  // KARDEŞ KAYITLAR: sicil şantiyeye YENİ yazıldıysa, aynı şantiyenin diğer bekleyen sicil uyarılı kayıtlarını
  // da (bildirge sicili artık eşleşenleri) kapat → 8 kişi tek tıkla çözülür, kalanlar tekrar sormaz.
  let kardesKapatildi = 0;
  if (sicilYazildi && rec.sicil_santiye_id && rec.cevap_sicil) {
    const { data: kardesler } = await supabase
      .from("personel_islem_takip")
      .select("id, cevap_sicil")
      .eq("durum", "bekliyor").eq("sicil_santiye_id", rec.sicil_santiye_id)
      .in("uyusmazlik_tip", ["sicil_yok", "sicil_farkli"]).neq("id", id);
    const kapatilacak = ((kardesler ?? []) as { id: string; cevap_sicil: string | null }[])
      .filter((k) => sicilEslesir(rec.cevap_sicil, k.cevap_sicil)).map((k) => k.id);
    if (kapatilacak.length > 0) {
      const { data: upd } = await supabase.from("personel_islem_takip")
        .update({ durum: "tamamlandi", uyusmazlik: null, uyusmazlik_tip: null, cevap_tarihi: new Date().toISOString() })
        .in("id", kapatilacak).eq("durum", "bekliyor").select("id");
      kardesKapatildi = Array.isArray(upd) ? upd.length : 0;
    }
  }

  return NextResponse.json({ ok: true, sicilYazildi, kardesKapatildi });
}
