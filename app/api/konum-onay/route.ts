// KONUM AYDINLATMA ONAYINI KAYDET — SUNUCU TARAFINDA.
//
// NİYE TARAYICIDAN DEĞİL: bu kayıt sonradan "bu kişiye ne söylendi, ne zaman,
// neyi kabul etti" sorusuna cevap verecek bir dayanak. Tarayıcıya yazdırılsaydı
// kullanıcı kendi (ya da başkasının) onayını elle üretebilirdi; kayıt savunma
// belgesi sayılmazdı. Artık yazma yalnız burada (service role), tarayıcıda
// yalnız okuma var (sql/konum_onay_kanit.sql).
//
// NE SAKLANIYOR: kullanıcı (oturumdan), adı (anlık kopya), metnin TAMAMI,
// metin sürümü, konum izni verilmiş miydi, cihaz (user agent) ve IP.
// IP başlıktan okunuyor — tarayıcının beyanı değil.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const kullanici = await oturum();
  if (!kullanici) return yetkisiz();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anahtar) return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  const sb = createClient(url, anahtar, { auth: { persistSession: false } });

  try {
    const { metin_surum, metin, konum_izni, cihaz, ret_sebep, ret_kaynak } = (await request.json()) as {
      metin_surum?: string; metin?: string; konum_izni?: boolean | null; cihaz?: string;
      ret_sebep?: string; ret_kaynak?: string;
    };
    // İKİ AYRI KAYIT TÜRÜ, TEK SATIR:
    //   onay → metin dolu gelir (kişi aydınlatmayı okuyup kabul etti)
    //   ret  → metin YOK, ret_sebep var (kişi "Konumu aç"a bastı, izin çıkmadı)
    // Ret de yazılıyor ki listede "hiç bakmamış" ile "deneyip reddedilmiş"
    // birbirine karışmasın — ikincisi yardım isteyen kişidir.
    const ret = !metin && Boolean(ret_sebep);
    if (!metin_surum || (!metin && !ret)) {
      return NextResponse.json({ error: "metin ve metin_surum zorunlu" }, { status: 400 });
    }

    // IP: vekil sunucu zinciri başlıkta; ilk sıradaki istemcinin adresi.
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
      || request.headers.get("x-real-ip")
      || null;

    // UPSERT: aynı sürüm için ikinci onay yeni satır açmaz, var olanı tazeler
    // (önce izinsiz onaylayıp sonra izni veren kullanıcı).
    const simdi = new Date().toISOString();
    const satir: Record<string, unknown> = {
      kullanici_id: kullanici.id,
      ad_soyad: kullanici.ad_soyad ?? null,
      metin_surum,
      konum_izni: typeof konum_izni === "boolean" ? konum_izni : null,
      cihaz: (cihaz ?? request.headers.get("user-agent") ?? "").slice(0, 300) || null,
      ip,
    };
    if (ret) {
      // RET: onay alanlarına DOKUNULMAZ. Daha önce onay vermiş biri sonradan
      // izni kapatırsa onayı silinmemeli — olan şey yeni bir ret denemesidir.
      satir.ret_at = simdi;
      satir.ret_sebep = (ret_sebep ?? "").slice(0, 300) || null;
      satir.ret_kaynak = (ret_kaynak ?? "").slice(0, 40) || null;
    } else {
      satir.metin = metin;
      satir.onay_at = simdi;
    }

    const { error } = await sb.from("konum_onaylari").upsert(satir, {
      onConflict: "kullanici_id,metin_surum",
    });

    // SESSİZ GEÇİLMEZ: kaydedilemediyse pencere "onayınız alındı" dememeli.
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ kaydedildi: true, ip });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    console.error("[konum-onay]", mesaj);
    return NextResponse.json({ error: `Onay kaydedilemedi: ${mesaj}` }, { status: 500 });
  }
}
