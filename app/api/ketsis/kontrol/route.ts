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
    firma_id?: string | null; vergi_dairesi?: string; konu?: string; belge_no?: string;
    ulasma_tarihi?: string; bildirim_id?: number | null;
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
  if (g.islem === "tebligat-ekle") {
    if (!duzenler) {
      return NextResponse.json(
        { error: "Tebligat kaydetmek için E-Tebligat düzenleme yetkisi gerekir." }, { status: 403 });
    }
    const tarih = String(g.ulasma_tarihi ?? "").slice(0, 10);
    // Tarih ŞART: son gün bundan hesaplanıyor. Boş geçilirse kayıt sessizce
    // süresiz görünür, yani defterin tek işi yapılmamış olur.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) {
      return NextResponse.json({ error: "Tebligatın ulaşma tarihi gerekli (GG.AA.YYYY)." }, { status: 400 });
    }
    const { data, error } = await sb.from("ketsis_tebligat").insert({
      firma_id: g.firma_id || null,
      vergi_dairesi: g.vergi_dairesi?.slice(0, 200) || null,
      konu: g.konu?.slice(0, 500) || null,
      belge_no: g.belge_no?.slice(0, 50) || null,
      ulasma_tarihi: tarih,
      bildirim_id: g.bildirim_id ?? null,
      notlar: g.notlar?.slice(0, 1000) || null,
      kaydeden_id: k.id, kaydeden_ad: k.ad_soyad,
    }).select("id, teblig_tarihi").single();
    if (error) return NextResponse.json({ error: `Tebligat kaydedilemedi: ${error.message}` }, { status: 500 });

    // Tebligat girildiyse daireye bakılmış demektir — haftalık hatırlatma da sıfırlansın.
    const { error: kErr } = await sb.from("ketsis_kontrol").insert({
      kullanici_id: k.id, kullanici_ad: k.ad_soyad, bulgu: "tebligat_var",
      notlar: `Tebligat kaydedildi #${data?.id}`,
    });
    if (kErr) {
      return NextResponse.json({
        durum: "kaydedildi", id: data?.id, teblig_tarihi: data?.teblig_tarihi,
        uyari: `Tebligat kaydedildi ama haftalık kontrol kaydı yazılamadı: ${kErr.message}`,
      });
    }
    return NextResponse.json({ durum: "kaydedildi", id: data?.id, teblig_tarihi: data?.teblig_tarihi });
  }

  // Portalda açıldı işaretlemesi. SÜREYİ DEĞİŞTİRMEZ (107/A), yalnız "bakıldı" bilgisi.
  if (g.islem === "tebligat-okundu") {
    if (!duzenler) {
      return NextResponse.json({ error: "Bunun için düzenleme yetkisi gerekir." }, { status: 403 });
    }
    if (!g.id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
    const { error } = await sb.from("ketsis_tebligat")
      .update({ okundu_at: new Date().toISOString(), okuyan_ad: k.ad_soyad }).eq("id", g.id);
    if (error) return NextResponse.json({ error: `İşaretlenemedi: ${error.message}` }, { status: 500 });
    return NextResponse.json({ durum: "isaretlendi" });
  }

  // Yanlış girilen kayıt silinebilsin — yoksa hatalı bir tarih defterde sürekli
  // kırmızı yanar ve defterin tamamı güvenilmez hale gelir.
  if (g.islem === "tebligat-sil") {
    if (!duzenler) {
      return NextResponse.json({ error: "Bunun için düzenleme yetkisi gerekir." }, { status: 403 });
    }
    if (!g.id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
    const { error } = await sb.from("ketsis_tebligat").delete().eq("id", g.id);
    if (error) return NextResponse.json({ error: `Silinemedi: ${error.message}` }, { status: 500 });
    return NextResponse.json({ durum: "silindi" });
  }

  return NextResponse.json({ error: "Bilinmeyen işlem" }, { status: 400 });
}
