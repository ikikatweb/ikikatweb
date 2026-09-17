// GENİŞ TARİH ARALIĞI HAKKI — Arvento Raporu
//
// POST /api/arvento/genis-aralik → { izinVar, sonraki, kalanGun }
//
// Kural (kullanıcının isteği): yönetici dışındaki kullanıcılar 7 günden uzun aralığı haftada
// yalnız BİR GÜN açabilir. Hakkı kullandığı GÜN BOYUNCA serbest çalışır (aynı gün tekrar tekrar
// aralık değiştirebilir, ek hak harcamaz); o gün bittikten 7 gün sonra hak yenilenir.
// Örnek: 17.09'da kullandıysa → 18.09 00:00 + 7 gün = 25.09'da tekrar açabilir.
//
// Neden var: rota tablosu satır başına ~34 KB; 2 aylık aralık ≈ 65 MB indiriyor ve Supabase
// çıkış kotasının asıl tüketicisi bu (ölçüldü). Sınır maliyet içindir, güvenlik için değil.
//
// Karar SUNUCUDA verilir: tarayıcıdaki depoyu temizleyip sıfırlamak mümkün olmasın.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/** Bekleme: hakkın kullanıldığı gün bittikten SONRA kaç gün. */
const BEKLEME_GUN = 7;

/** Bir anın TR takvim günü ("YYYY-MM-DD"). TR = UTC+3. */
function trGun(d: Date): string {
  return new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" + n gün → "YYYY-MM-DD" */
function gunEkle(gun: string, n: number): string {
  return new Date(Date.parse(`${gun}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  let authId: string | null = null;
  try {
    const cookieStore = await cookies();
    const auth = createServerClient(url, anon, { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } });
    const { data: { user } } = await auth.auth.getUser();
    authId = user?.id ?? null;
  } catch { /* aşağıda 401 */ }
  if (!authId) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

  try {
    const sb = createClient(url, svcKey);
    const { data, error } = await sb
      .from("kullanicilar").select("id, rol, arvento_genis_son").eq("auth_id", authId).single();

    // Kolon henüz eklenmemişse (SQL çalıştırılmadıysa) KİMSEYİ ENGELLEME — sınır çalışmaz ama
    // sayfa bozulmaz. SQL çalıştırılınca kural kendiliğinden devreye girer.
    if (error) {
      if (/arvento_genis_son/.test(error.message)) return NextResponse.json({ izinVar: true, kurulmadi: true });
      throw error;
    }

    const kullanici = data as { id: string; rol: string; arvento_genis_son: string | null };
    if (kullanici.rol === "yonetici") return NextResponse.json({ izinVar: true, yonetici: true });

    const bugun = trGun(new Date());
    const sonGun = kullanici.arvento_genis_son ? trGun(new Date(kullanici.arvento_genis_son)) : null;

    // Aynı gün → hak zaten bugüne ait, serbest (yeni damga yazmaya gerek yok).
    if (sonGun === bugun) return NextResponse.json({ izinVar: true, bugunKullanildi: true });

    // Hiç kullanmamış ya da bekleme dolmuş → hakkı ver ve damgala.
    const acilis = sonGun ? gunEkle(sonGun, BEKLEME_GUN + 1) : null; // gün bitimi (+1) + bekleme
    if (!acilis || bugun >= acilis) {
      await sb.from("kullanicilar").update({ arvento_genis_son: new Date().toISOString() }).eq("id", kullanici.id);
      return NextResponse.json({ izinVar: true, kullanildi: true });
    }

    const kalanGun = Math.max(1, Math.round((Date.parse(`${acilis}T00:00:00Z`) - Date.parse(`${bugun}T00:00:00Z`)) / 86400000));
    return NextResponse.json({ izinVar: false, sonraki: acilis, kalanGun });
  } catch (e) {
    // Beklenmedik hata → engelleme (sınır maliyet içindir; kullanıcıyı kilitlemek amacımız değil).
    return NextResponse.json({ izinVar: true, hata: e instanceof Error ? e.message : "bilinmeyen" });
  }
}
