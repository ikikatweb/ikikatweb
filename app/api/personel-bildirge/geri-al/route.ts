// Personel bildirge "Kaldır" — işlemi muhasebeye hiç gönderilmemiş gibi GERİ ALIR.
//
// Muhasebe bazen işlemi yapamıyor (ör. personel raporluyken çıkış/giriş işlenemiyor) ve bunu
// mail gönderildikten sonra söylüyor. O durumda bekleyen takip kaydını kapatmak yetmez;
// bordrodaki karşılığı da geri alınmalı, yoksa kişi çıkmış/girmiş görünmeye devam eder.
//
//   çıkış  → personel_atama_gecmisi.bitis_tarihi tekrar BOŞALTILIR (kişi halen çalışıyor)
//   giriş  → o tarihte açılan atama satırı SİLİNİR (hiç başlamamış sayılır)
//
// Silinen satır kaybolmaz: kayit_gecmisi tetikleyicisi satırın tamamını saklıyor, gerekirse
// birebir geri yazılabilir.
//
// Service-role ile çalışır — TC eşlemesi ve atama değişikliği tek yerde, güvenilir.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";

export async function POST(request: Request) {
  // GÜVENLİK: /api middleware kapsamı dışında — kapı burada (lib/api/guvenlik).
  if (!(await oturum())) return yetkisiz();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const supabase = createClient(url, key);

  let id: string | undefined;
  try { id = (await request.json())?.id; } catch { /* gövdesiz */ }
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

  const { data: rec, error: e1 } = await supabase
    .from("personel_islem_takip")
    .select("personel_tc, personel_ad, tip, islem_tarihi, durum")
    .eq("id", id).single();
  if (e1 || !rec) return NextResponse.json({ error: "Takip kaydı bulunamadı" }, { status: 404 });

  let atamaGeriAlindi = 0;
  let uyari: string | null = null;

  const tc = (rec.personel_tc ?? "").replace(/\D/g, "");
  if (tc.length !== 11) {
    uyari = "Kaydın TC'si yok — bordro tarafı geri alınamadı, yalnız bekleyen istek kapatıldı.";
  } else if (!rec.islem_tarihi) {
    uyari = "Kaydın işlem tarihi yok — bordro tarafı geri alınamadı, yalnız bekleyen istek kapatıldı.";
  } else {
    const { data: p } = await supabase.from("personel").select("id").eq("tc_kimlik_no", tc).maybeSingle();
    if (!p?.id) {
      uyari = "Personel kartı bulunamadı — bordro tarafı geri alınamadı.";
    } else if (rec.tip === "cikis") {
      // Çıkışı geri al: bitiş tarihini boşalt → kişi halen çalışıyor.
      const { data: upd, error } = await supabase
        .from("personel_atama_gecmisi")
        .update({ bitis_tarihi: null })
        .eq("personel_id", p.id).eq("bitis_tarihi", rec.islem_tarihi)
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      atamaGeriAlindi = upd?.length ?? 0;
      if (atamaGeriAlindi === 0) uyari = "Bu tarihte kapatılmış atama bulunamadı (daha önce elle düzeltilmiş olabilir).";
    } else {
      // Girişi geri al: o gün açılan atama satırını sil → hiç başlamamış sayılır.
      // Yalnız HENÜZ KAPANMAMIŞ satır silinir; bitişi girilmişse araya başka işlem girmiş
      // demektir, sessizce silmek veri kaybı olur.
      const { data: aday, error: eSec } = await supabase
        .from("personel_atama_gecmisi")
        .select("id, bitis_tarihi")
        .eq("personel_id", p.id).eq("baslangic_tarihi", rec.islem_tarihi);
      if (eSec) return NextResponse.json({ error: eSec.message }, { status: 500 });
      const silinecek = (aday ?? []).filter((a) => a.bitis_tarihi == null).map((a) => a.id);
      const kapali = (aday ?? []).length - silinecek.length;
      if (silinecek.length > 0) {
        const { data: del, error } = await supabase
          .from("personel_atama_gecmisi").delete().in("id", silinecek).select("id");
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        atamaGeriAlindi = del?.length ?? 0;
      }
      if (atamaGeriAlindi === 0) {
        uyari = kapali > 0
          ? "Bu tarihte açılan atamanın çıkışı da girilmiş — silinmedi, önce çıkışı geri alın."
          : "Bu tarihte açılmış atama bulunamadı (daha önce elle düzeltilmiş olabilir).";
      }
    }
  }

  // Takip kaydı: silinmez, denetim için 'iptal' olarak kalır.
  const { error: e3 } = await supabase
    .from("personel_islem_takip")
    .update({ durum: "iptal", cevap_tarihi: new Date().toISOString(), uyusmazlik: null, uyusmazlik_tip: null })
    .eq("id", id);
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  return NextResponse.json({ ok: true, tip: rec.tip, atamaGeriAlindi, uyari });
}
