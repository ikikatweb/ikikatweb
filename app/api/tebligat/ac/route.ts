// TEBLİGATI AÇ — isteği KUYRUĞA yazar, indirmeyi ofisteki görev yapar.
//
// NEDEN DOĞRUDAN İNDİRMİYOR: UETS API'si yalnız PTT portalında tanımlı statik IP'den
// (ofis) çalışıyor. Panel Vercel'de duruyor ve onun çıkış adresi başka; oradan yapılan
// istek TCP seviyesinde kesiliyor — HTTP cevabı bile oluşmuyor, "fetch failed" gelir.
// İndirmeyi yapan tek yer: `scripts/uets-ac-isle.mjs` (ofiste, dakikada bir çalışır).
//
// Mantık TEK YERDE: hem burada hem görevde indirme olsaydı ikisi zamanla ayrışırdı ve
// tebligat gibi bir konuda "hangisi çalıştı" sorusunu sormak istemeyiz.
//
// AÇMAK GERİ ALINAMAZ: indirmek okumak sayılıyor (taahhütname md. 7). Bu yüzden istek,
// kimin adına açıldığını da kaydeder; ekranda "... tarafından ... okundu" diye görünür.
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

  // İZİN: açmak için "E-Tebligat > düzenle" gerekir, görüntüleme yetmez. Açmak geri
  // alınamaz ve o kişinin adına kaydedilir; listeyi görebilen herkese açık olmamalı.
  const { data: kul } = await sb.from("kullanicilar").select("izinler").eq("id", k.id).single();
  const izinli = hasPermission(k.rol as Rol, (kul?.izinler ?? {}) as Izinler, "yazismalar-e-tebligat", "duzenle");
  if (!izinli) return NextResponse.json({ error: "Tebligat açma yetkiniz yok." }, { status: 403 });

  const { id } = (await request.json().catch(() => ({}))) as { id?: number };
  if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

  const { data: t, error: okuHata } = await sb
    .from("tebligat").select("id, paket_yolu, acilma_durumu").eq("id", id).single();
  if (okuHata || !t) return NextResponse.json({ error: "Tebligat bulunamadı." }, { status: 404 });

  // Zaten inmişse tekrar istenmez: sorgu hakkı harcar, ilk açanın kaydını bozar.
  if (t.paket_yolu) return NextResponse.json({ durum: "zaten-acik" });
  if (t.acilma_durumu === "bekliyor" || t.acilma_durumu === "islemde") {
    return NextResponse.json({ durum: "kuyrukta", tekrar: true });
  }

  const { error } = await sb.from("tebligat").update({
    acilma_durumu: "bekliyor",
    acilma_istegi_at: new Date().toISOString(),
    acilma_isteyen_id: k.id,
    acilma_isteyen_ad: k.ad_soyad,   // o anki ad: kullanıcı sonradan silinse de iz kalsın
    acilma_hatasi: null,
  }).eq("id", id);
  // Hata YUTULMAZ: istek yazılmadıysa tebligat hiç açılmaz ve kullanıcı boşuna bekler.
  if (error) return NextResponse.json({ error: `İstek kaydedilemedi: ${error.message}` }, { status: 500 });

  return NextResponse.json({ durum: "kuyrukta" });
}
