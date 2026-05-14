// Tüm DB tablolarının yedeğini JSON olarak indirme endpoint'i.
// SADECE yönetici (role=yonetici) erişebilir.
// Service role ile çalışır → RLS bypass, tüm satırlar dahil.
//
// Kullanım: GET /api/yedek  → application/json dosyası döner (Content-Disposition ile download).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Yedeklenecek tablolar — proje genelinde tüm veri saklayan tablolar.
// Yeni tablo eklendikçe buraya da ekle.
const YEDEK_TABLOLARI = [
  // Yönetim
  "firmalar",
  "santiyeler",
  "santiye_ortaklari",
  "santiye_is_gruplari",
  "kullanicilar",
  "izin_sablonlari",
  // Personel
  "personel",
  "personel_santiye",
  "personel_atama_gecmisi",
  "personel_atama_manuel_gun",
  "personel_teknik",
  "personel_brut_ucret",
  // Araç
  "araclar",
  "arac_police",
  "arac_bakim",
  "arac_puantaj",
  "teklif_gonderim",
  // Yazışmalar
  "gelen_evrak",
  "giden_evrak",
  "banka_yazismalari",
  // Yakıt
  "yakit_alimlar",
  "arac_yakitlar",
  "yakit_virmanlar",
  // Kasa
  "kasa_hareketleri",
  // İşçilik / Bordro
  "iscilik_takibi",
  "iscilik_aylik",
  "bordro_pending_mail",
  "gunluk_ucretler",
  // Şantiye defteri
  "santiye_defteri",
  // Tanımlamalar
  "tanimlamalar",
  "yi_ufe",
  "kasa_islem_tipleri",
  // Mesajlaşma
  "mesaj_konusma",
  "mesaj_uye",
  "mesaj",
  // İhale (varsa)
  "ihale",
];

const PARCA_BOYUTU = 1000;

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }

  // YETKİ KONTROLÜ — sadece yönetici yedek alabilir.
  // Cookie'deki Supabase session token üzerinden çağıran kullanıcının rolünü kontrol et.
  try {
    const cookieStore = await cookies();
    const cookieAdiOnEk = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
    const tokenCookieAdi = `sb-${cookieAdiOnEk}-auth-token`;
    const tokenCookie = cookieStore.get(tokenCookieAdi);

    if (!tokenCookie) {
      return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });
    }

    // Cookie değeri JSON formatında ya da base64-encoded JSON olabilir.
    let accessToken: string | null = null;
    try {
      const ham = tokenCookie.value.startsWith("base64-")
        ? Buffer.from(tokenCookie.value.slice(7), "base64").toString("utf-8")
        : tokenCookie.value;
      const parsed = JSON.parse(ham);
      accessToken = parsed?.access_token ?? null;
    } catch {
      accessToken = null;
    }

    if (!accessToken) {
      return NextResponse.json({ error: "Geçersiz oturum" }, { status: 401 });
    }

    // Anon key ile bir client oluştur ve token'ı kullan
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: userData } = await authClient.auth.getUser();
    if (!userData?.user?.id) {
      return NextResponse.json({ error: "Kullanıcı doğrulanamadı" }, { status: 401 });
    }

    // Rol kontrolü — service role ile kullanıcıyı bul
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: kullaniciKaydi } = await adminClient
      .from("kullanicilar")
      .select("rol")
      .eq("auth_id", userData.user.id)
      .single();

    if (!kullaniciKaydi || kullaniciKaydi.rol !== "yonetici") {
      return NextResponse.json({ error: "Yedek alma yetkisi sadece yöneticilerde" }, { status: 403 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Yetki kontrolü hatası";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // YEDEK ALMA
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const yedek: Record<string, unknown[]> = {};
  const hatalar: { tablo: string; hata: string }[] = [];

  for (const tablo of YEDEK_TABLOLARI) {
    try {
      const tumKayitlar: unknown[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from(tablo)
          .select("*")
          .range(offset, offset + PARCA_BOYUTU - 1);
        if (error) {
          // Tablo yoksa atlayalım (örn. ihale gibi opsiyonel tablolar).
          // PGRST205 = "Table not found in schema cache"
          if (error.code === "PGRST205" || error.message?.toLowerCase().includes("not exist")) {
            break;
          }
          throw error;
        }
        const parca = data ?? [];
        tumKayitlar.push(...parca);
        if (parca.length < PARCA_BOYUTU) break;
        offset += PARCA_BOYUTU;
        // Güvenlik: 1 milyon satırda kes
        if (offset > 1_000_000) break;
      }
      yedek[tablo] = tumKayitlar;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      hatalar.push({ tablo, hata: msg });
      yedek[tablo] = [];
    }
  }

  const tarih = new Date();
  const tarihStr = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, "0")}-${String(tarih.getDate()).padStart(2, "0")}_${String(tarih.getHours()).padStart(2, "0")}-${String(tarih.getMinutes()).padStart(2, "0")}`;

  const sonuc = {
    meta: {
      proje: "ikikatweb",
      yedek_tarihi: tarih.toISOString(),
      toplam_tablo: YEDEK_TABLOLARI.length,
      basarili_tablo: YEDEK_TABLOLARI.length - hatalar.length,
      hatalar,
      tablo_satir_sayilari: Object.fromEntries(
        Object.entries(yedek).map(([t, k]) => [t, k.length]),
      ),
    },
    veriler: yedek,
  };

  const json = JSON.stringify(sonuc, null, 2);
  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ikikatweb-yedek-${tarihStr}.json"`,
    },
  });
}
