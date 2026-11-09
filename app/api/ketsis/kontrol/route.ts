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
    satirlar?: { belge_no?: string; kurum?: string; belge_turu?: string;
                 ulasma_tarihi?: string; teblig_tarihi?: string; okuma_at?: string }[];
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

  // ── 4) Portal Excel'i aktar ─────────────────────────────────────────────
  // Dijital Vergi Dairesi > e-Tebligat > "Excel'e Aktar" çıktısı. Dosya TARAYICIDA
  // okunup satırlar buraya geliyor; sunucuya dosya yüklenmiyor.
  //
  // NİYE BU YOL: portalda CAPTCHA olduğu için panel kendi giremiyor, yer imi kurulumu
  // da zahmetli bulundu. Excel'i portal zaten kendisi üretiyor — en az adımlı, en az
  // kırılgan yol bu. Belge İNDİRİLMİYOR, yalnız liste aktarılıyor.
  if (g.islem === "excel-aktar") {
    if (!duzenler) {
      return NextResponse.json({ error: "Aktarım için E-Tebligat düzenleme yetkisi gerekir." }, { status: 403 });
    }
    // FİRMA ŞART, TAHMİN EDİLMİYOR: Excel'de VKN yok (09.11.2026'da dosya incelendi).
    // Hangi firmanın listesi olduğunu yalnız yükleyen kişi bilir. Tahminle bağlamak,
    // bir firmanın tebligatını başka firmanın defterine yazmak demek olurdu.
    if (!g.firma_id) {
      return NextResponse.json(
        { error: "Önce firma seçin. Excel dosyasında firma bilgisi yok, tahmin edilmiyor." }, { status: 400 });
    }
    const satirlar = Array.isArray(g.satirlar) ? g.satirlar : [];
    if (satirlar.length === 0) {
      return NextResponse.json(
        { error: "Dosyada tebligat satırı bulunamadı. Doğru dosyayı seçtiğinizden emin olun." }, { status: 400 });
    }

    const atlanan: string[] = [];
    const kayitlar = [];
    for (const r of satirlar) {
      // Ulaşma tarihi olmayan satır YAZILMAZ: süre ondan hesaplanıyor, boş geçilirse
      // defterde tarihi olmayan bir kayıt kalır ve kimse fark etmez.
      if (!r.ulasma_tarihi) {
        atlanan.push(`${r.belge_no ?? "belge no yok"} — gönderme tarihi okunamadı`);
        continue;
      }
      if (!r.belge_no) {
        atlanan.push("belge no olmayan satır — tekrar kaydı ayırt edilemeyeceği için alınmadı");
        continue;
      }
      kayitlar.push({
        firma_id: g.firma_id,
        kaynak: "portal",
        belge_no: r.belge_no,
        kurum: r.kurum ?? null,
        vergi_dairesi: r.kurum ?? null,
        belge_turu: r.belge_turu ?? null,
        konu: r.belge_turu ?? null,
        ulasma_tarihi: r.ulasma_tarihi,
        portal_teblig_tarihi: r.teblig_tarihi ?? null,
        portal_okuma_at: r.okuma_at ?? null,
        okundu_at: r.okuma_at ?? null,
        kaydeden_id: k.id,
        kaydeden_ad: k.ad_soyad,
      });
    }

    const { data: oncekiler } = await sb.from("ketsis_tebligat")
      .select("belge_no").eq("firma_id", g.firma_id).in("belge_no", kayitlar.map((x) => x.belge_no));
    const bilinen = new Set((oncekiler ?? []).map((x) => x.belge_no));
    const yeniSayi = kayitlar.filter((x) => !bilinen.has(x.belge_no)).length;

    if (kayitlar.length > 0) {
      const { error } = await sb.from("ketsis_tebligat")
        .upsert(kayitlar, { onConflict: "firma_id,belge_no" });
      if (error) return NextResponse.json({ error: `Deftere yazılamadı: ${error.message}` }, { status: 500 });
    }

    // Aktarım aynı zamanda bir "baktım" kaydıdır: kişi portala girip listeyi görmüştür.
    await sb.from("ketsis_kontrol").insert({
      kullanici_id: k.id, kullanici_ad: k.ad_soyad,
      bulgu: kayitlar.length > 0 ? "tebligat_var" : "temiz",
      notlar: `Portal Excel aktarımı: ${kayitlar.length} kayıt (${yeniSayi} yeni)`,
    });

    return NextResponse.json({
      durum: "aktarildi", okunan: satirlar.length, yazilan: kayitlar.length,
      yeni: yeniSayi, atlanan,
      // SESSİZ BAŞARI YOK: atlanan varsa bu bir uyarıdır, yeşil "kaydedildi" ile geçilmez.
      uyari: atlanan.length
        ? `${kayitlar.length} kayıt yazıldı (${yeniSayi} yeni), ${atlanan.length} satır ALINMADI: ${atlanan.slice(0, 3).join(" · ")}`
        : undefined,
    });
  }

  return NextResponse.json({ error: "Bilinmeyen işlem" }, { status: 400 });
}
