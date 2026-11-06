// FİRMA UETS AYARLARI — anahtarı sunucuda tutan tek kapı.
//
// API anahtarı TARAYICIYA HİÇ GÖNDERİLMEZ. GET yalnız "tanımlı mı, son 4 hanesi ne,
// en son ne zaman çekildi, hata var mı" bilgisini döner; POST anahtarı yazar ama geri
// okutmaz. Sebep: firmalar tablosunu panele giren herkes okuyabiliyor, bu anahtarla ise
// tebligat okunup silinebiliyor (PTT taahhütnamesi md. 2: anahtar paylaşılamaz).
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { oturum, yetkisiz, type OturumKullanici } from "@/lib/api/guvenlik";
import { hasPermission, type Rol } from "@/lib/permissions";
import type { Izinler, IzinAksiyonu } from "@/lib/supabase/types";

const TEMEL = "https://apipp.etebligat.gov.tr/v1";

function servis(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anahtar = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anahtar) return null;
  return createClient(url, anahtar, { auth: { persistSession: false } });
}

/** Oturum + "yonetim-firmalar" izni. Dönen: [kullanıcı, servis istemcisi] ya da hata yanıtı. */
async function kapi(aksiyon: IzinAksiyonu): Promise<
  { hata: NextResponse } | { k: OturumKullanici; sb: SupabaseClient }
> {
  const k = await oturum();
  if (!k) return { hata: yetkisiz() };
  const sb = servis();
  if (!sb) return { hata: NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 }) };
  const { data } = await sb.from("kullanicilar").select("izinler").eq("id", k.id).single();
  if (!hasPermission(k.rol as Rol, (data?.izinler ?? {}) as Izinler, "yonetim-firmalar", aksiyon)) {
    return { hata: NextResponse.json({ error: "Bu işlem için yetkiniz yok." }, { status: 403 }) };
  }
  return { k, sb };
}

/** Anahtarın yalnız son 4 hanesi gösterilir — doğru anahtar mı diye bakabilmek için yeterli. */
const son4 = (a: string | null | undefined) => (a && a.length >= 4 ? a.slice(-4) : null);

export async function GET(request: Request) {
  const g = await kapi("goruntule");
  if ("hata" in g) return g.hata;
  const firmaId = new URL(request.url).searchParams.get("firma_id");
  if (!firmaId) return NextResponse.json({ error: "firma_id gerekli" }, { status: 400 });

  const { data, error } = await g.sb.from("firma_uets")
    .select("api_key, aktif, uets_adres, sunucu_ip, son_cekim, son_hata, updated_at, guncelleyen_id")
    .eq("firma_id", firmaId).maybeSingle();
  // Hata YUTULMAZ: "ayar yok" ile "sorgu patladı" aynı şey değil; ekran ikisini ayırt etsin.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ kurulu: false, aktif: true });

  let guncelleyen: string | null = null;
  if (data.guncelleyen_id) {
    const { data: u } = await g.sb.from("kullanicilar").select("ad_soyad").eq("id", data.guncelleyen_id).maybeSingle();
    guncelleyen = u?.ad_soyad ?? null;
  }
  return NextResponse.json({
    kurulu: true,
    anahtarVar: !!data.api_key,
    anahtarSon4: son4(data.api_key),
    aktif: data.aktif,
    uets_adres: data.uets_adres,
    sunucu_ip: data.sunucu_ip,
    son_cekim: data.son_cekim,
    son_hata: data.son_hata,
    updated_at: data.updated_at,
    guncelleyen,
  });
}

export async function POST(request: Request) {
  const g = await kapi("duzenle");
  if ("hata" in g) return g.hata;

  const govde = (await request.json().catch(() => ({}))) as {
    firma_id?: string; islem?: "kaydet" | "dene" | "sil";
    api_key?: string; aktif?: boolean; sunucu_ip?: string;
  };
  const firmaId = govde.firma_id;
  if (!firmaId) return NextResponse.json({ error: "firma_id gerekli" }, { status: 400 });

  // ───────── bağlantı denemesi ─────────
  // Kaydedilmiş anahtarla (ya da kutuya yeni yazılanla) UETS'e tek sorgu atar.
  // Anahtarın gerçekten çalıştığını kaydetmeden önce görmek için.
  if (govde.islem === "dene") {
    let anahtar = govde.api_key?.trim();
    if (!anahtar) {
      const { data } = await g.sb.from("firma_uets").select("api_key").eq("firma_id", firmaId).maybeSingle();
      anahtar = data?.api_key ?? undefined;
    }
    if (!anahtar) return NextResponse.json({ error: "Önce bir API anahtarı girin." }, { status: 400 });
    try {
      const u = new URL(`${TEMEL}/messages`);
      // Tek satır, en yenisi: sorgu hakkından en az harcayan deneme. İNDİRME YOK —
      // indirmek tebligatı açmak demek olurdu (taahhütname md. 7).
      u.searchParams.set("start", "0");
      u.searchParams.set("count", "1");
      u.searchParams.set("type", "incoming");
      const r = await fetch(u, { headers: { authorization: `Bearer ${anahtar}`, "content-type": "application/json" } });
      const metin = await r.text();
      if (!r.ok) {
        let mesaj = metin.slice(0, 300);
        try { const j = JSON.parse(metin); mesaj = `${j.message ?? mesaj}${j.code ? ` (kod ${j.code})` : ""}`; } catch { /* düz metin */ }
        return NextResponse.json({ ok: false, durum: r.status, mesaj }, { status: 200 });
      }
      return NextResponse.json({
        ok: true, durum: r.status,
        toplam: Number(r.headers.get("x-total-count") ?? 0),
        okunmamis: Number(r.headers.get("x-unread-count") ?? 0),
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, mesaj: `UETS'e ulaşılamadı: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 });
    }
  }

  // ───────── anahtarı kaldır ─────────
  if (govde.islem === "sil") {
    const { error } = await g.sb.from("firma_uets").delete().eq("firma_id", firmaId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ───────── kaydet ─────────
  const yeni = govde.api_key?.trim();
  const satir: Record<string, unknown> = {
    firma_id: firmaId,
    aktif: govde.aktif ?? true,
    sunucu_ip: govde.sunucu_ip?.trim() || null,
    // uets_adres BİLEREK YOK: ekrandan girilmiyor, ilk tebligatla çekme işi yazıyor.
    // Buradan null geçilseydi her kayıtta öğrenilmiş adres silinirdi.
    guncelleyen_id: g.k.id,
  };
  // Anahtar kutusu BOŞ bırakıldıysa mevcut anahtara dokunulmaz. Ekranda anahtar
  // hiç gösterilmediği için, boş kutuyu "anahtarı sil" saymak onu kazara silerdi.
  if (yeni) satir.api_key = yeni;

  const { error } = await g.sb.from("firma_uets").upsert(satir, { onConflict: "firma_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = await g.sb.from("firma_uets").select("api_key").eq("firma_id", firmaId).maybeSingle();
  return NextResponse.json({ ok: true, anahtarVar: !!data?.api_key, anahtarSon4: son4(data?.api_key) });
}
