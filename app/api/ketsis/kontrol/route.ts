// KETSİS (GİB e-tebligat) TAKİBİ — kontrol kaydı ve bildirim durumu.
//
// NEDEN SUNUCU ROTASI: ketsis_bildirim / ketsis_kontrol tablolarına tarayıcıdan YAZILMAZ
// (RLS'de yalnız select izni var). "Ben baktım" kaydına kullanıcı başkasının adını
// yazamasın; ad, oturumdan alınır.
//
// ÜÇ İŞLEM
//   kontrol-kaydi   : "Dijital Vergi Dairesi'ne baktım" — haftalık hatırlatma buna bakar.
//   bildirim-kontrol: bir bildirim maili incelendi (gerçekten tebligat çıktı).
//                     YAN ETKİSİ VAR: o gönderen bundan sonra "kesin" sayılır (script
//                     onaylanmış göndereni öğreniyor). Bu yüzden "düzenle" yetkisi ister.
//   bildirim-ilgisiz: aday yanlış çıktı, satır listeden düşsün. Yetki: "düzenle".
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { hasPermission, type Rol } from "@/lib/permissions";
import type { Izinler } from "@/lib/supabase/types";

export async function POST(request: Request) {
  const k = await oturum();
  if (!k) return yetkisiz();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const servis = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !servis) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const sb = createClient(url, servis, { auth: { persistSession: false } });

  const { data: kul } = await sb.from("kullanicilar").select("izinler").eq("id", k.id).single();
  const izinler = (kul?.izinler ?? {}) as Izinler;
  const gorur = hasPermission(k.rol as Rol, izinler, "yazismalar-e-tebligat", "goruntule");
  const duzenler = hasPermission(k.rol as Rol, izinler, "yazismalar-e-tebligat", "duzenle");
  if (!gorur) return NextResponse.json({ error: "E-Tebligat yetkiniz yok." }, { status: 403 });

  const g = (await request.json().catch(() => ({}))) as {
    islem?: string; id?: number; bulgu?: string; notlar?: string;
  };

  // ── 1) Elle kontrol kaydı ────────────────────────────────────────────────
  // Mail gelmeden de tebligat gelebilir (bilgilendirme maili hukuken tebligatın parçası
  // değil). Bu kayıt olmadan "kimse bakmadı mı, bakıldı mı" ayırt edilemez.
  if (g.islem === "kontrol-kaydi") {
    const bulgu = g.bulgu === "tebligat_var" ? "tebligat_var" : "temiz";
    const { error } = await sb.from("ketsis_kontrol").insert({
      kullanici_id: k.id, kullanici_ad: k.ad_soyad, bulgu,
      notlar: g.notlar?.slice(0, 1000) ?? null,
    });
    if (error) return NextResponse.json({ error: `Kontrol kaydedilemedi: ${error.message}` }, { status: 500 });
    return NextResponse.json({ durum: "kaydedildi" });
  }

  // ── 2/3) Bildirim satırı ────────────────────────────────────────────────
  if (g.islem === "bildirim-kontrol" || g.islem === "bildirim-ilgisiz") {
    if (!duzenler) {
      return NextResponse.json(
        { error: "Bildirimi işaretlemek için E-Tebligat düzenleme yetkisi gerekir." }, { status: 403 });
    }
    if (!g.id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

    const kontrolEdildi = g.islem === "bildirim-kontrol";
    const { error } = await sb.from("ketsis_bildirim").update({
      durum: kontrolEdildi ? "kontrol_edildi" : "ilgisiz",
      kontrol_eden_id: k.id,
      kontrol_eden_ad: k.ad_soyad,     // o anki ad: kullanıcı sonradan silinse de iz kalsın
      kontrol_at: new Date().toISOString(),
      notlar: g.notlar?.slice(0, 1000) ?? null,
    }).eq("id", g.id);
    // Hata YUTULMAZ: işaretlenmediyse kullanıcı işaretledi sanır, uyarı da kalkmaz.
    if (error) return NextResponse.json({ error: `İşaretlenemedi: ${error.message}` }, { status: 500 });

    // Bildirimi "kontrol edildi" yapmak için Dijital Vergi Dairesi'ne girilmiş olması
    // gerekir → haftalık hatırlatma da sıfırlanır. Bu kayıt yazılamazsa işlem yarım
    // kalmış sayılır; kullanıcı uyarının neden durduğunu anlayabilsin.
    if (kontrolEdildi) {
      const { error: kErr } = await sb.from("ketsis_kontrol").insert({
        kullanici_id: k.id, kullanici_ad: k.ad_soyad, bulgu: "tebligat_var",
        notlar: `Bildirim #${g.id} incelendi`,
      });
      if (kErr) {
        return NextResponse.json({
          durum: "isaretlendi",
          uyari: `Bildirim işaretlendi ama haftalık kontrol kaydı yazılamadı: ${kErr.message}`,
        });
      }
    }
    return NextResponse.json({ durum: "isaretlendi" });
  }

  // ── 4) Tebligat defteri ─────────────────────────────────────────
  // Daireye bakan kişi GÖRDÜĞÜNÜ yazıyor; son günü panel hesaplıyor (VUK 107/A).
  // Tebligatın KENDİSİ burada, bildirim maili değil — mail hiç gelmemiş olabilir.
  return NextResponse.json({ error: "Bilinmeyen işlem" }, { status: 400 });
}
