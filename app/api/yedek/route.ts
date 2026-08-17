// Tüm DB tablolarının yedeğini JSON olarak indirme endpoint'i.
// SADECE yönetici (role=yonetici) erişebilir.
// Service role ile çalışır → RLS bypass, tüm satırlar dahil.
//
// Kullanım: GET /api/yedek  → application/json dosyası döner (Content-Disposition ile download).
//
// Yanıt AKIŞ (stream) olarak üretilir: tablolar sırayla çekilip anında yazılır, tamamı
// bellekte tutulmaz. "meta" alanı SONA yazılır — dosyanın sonunda meta YOKSA indirme
// yarıda kesilmiştir (süre limiti) ve o yedek EKSİKTİR.
//
// Hangi tabloların yedeklendiği lib/yedek/kapsam.ts'te (tek kaynak; yerel yedek script'i
// de aynı listeyi kullanır). Tam ve garantili yedek için: scripts/yedek-al.ts —
// bu makinedeki haftalık görev, süre/boyut limitine takılmaz.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { YEDEK_TABLOLARI, YEDEK_DISI, PARCA_BOYUTU, OZEL_PARCA } from "@/lib/yedek/kapsam";

export const maxDuration = 60;

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
  const hatalar: { tablo: string; hata: string }[] = [];
  const uyarilar: string[] = [];
  const satirSayilari: Record<string, number> = {};

  // Liste denetimi: veritabanında olup ne YEDEK_TABLOLARI'nda ne YEDEK_DISI'nda olan bir tablo
  // varsa (yeni tablo eklenmiş ama yedeğe konmamışsa) uyarı olarak bildirilir. Eskiden yanlış
  // yazılmış tablo adları sessizce boş geçiliyordu — artık her iki durum da meta'da görünür.
  try {
    const spec = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` },
    }).then((r) => (r.ok ? r.json() : null));
    const canliTablolar: string[] = Object.keys(spec?.definitions ?? {});
    if (canliTablolar.length) {
      const listelenmemis = canliTablolar.filter((t) => !YEDEK_TABLOLARI.includes(t) && !(t in YEDEK_DISI));
      if (listelenmemis.length) {
        uyarilar.push(`Yedek listesinde OLMAYAN tablolar (veri kaybı riski): ${listelenmemis.join(", ")}`);
      }
      const bulunmayan = YEDEK_TABLOLARI.filter((t) => !canliTablolar.includes(t));
      if (bulunmayan.length) {
        uyarilar.push(`Listede olup veritabanında BULUNMAYAN tablolar (ad yanlış olabilir): ${bulunmayan.join(", ")}`);
      }
    }
  } catch {
    uyarilar.push("Tablo listesi denetimi yapılamadı (şema özeti okunamadı).");
  }

  // Bir tablonun satırlarını parça parça getirir. Ağır tablolarda Supabase 500 dönebiliyor;
  // o durumda parça boyutu küçültülüp yeniden denenir (10 satırın altına inilmez).
  async function* tabloParcalari(sb: SupabaseClient, tablo: string) {
    let offset = 0;
    let parcaBoyutu = OZEL_PARCA[tablo] ?? PARCA_BOYUTU;
    while (true) {
      const { data, error } = await sb.from(tablo).select("*").range(offset, offset + parcaBoyutu - 1);
      if (error) {
        const yokHatasi = error.code === "PGRST205" || error.message?.toLowerCase().includes("not exist");
        if (!yokHatasi && parcaBoyutu > 10) {
          parcaBoyutu = Math.max(10, Math.floor(parcaBoyutu / 4));
          continue;
        }
        throw error;
      }
      const parca = data ?? [];
      if (parca.length) yield parca;
      if (parca.length < parcaBoyutu) return;
      offset += parcaBoyutu;
      if (offset > 1_000_000) return; // güvenlik freni
    }
  }

  const tarih = new Date();
  const tarihStr = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, "0")}-${String(tarih.getDate()).padStart(2, "0")}_${String(tarih.getHours()).padStart(2, "0")}-${String(tarih.getMinutes()).padStart(2, "0")}`;

  const kodlayici = new TextEncoder();
  const akis = new ReadableStream<Uint8Array>({
    async start(kontrol) {
      const yaz = (metin: string) => kontrol.enqueue(kodlayici.encode(metin));
      try {
        yaz('{"veriler":{');
        let ilkTablo = true;
        for (const tablo of YEDEK_TABLOLARI) {
          yaz(`${ilkTablo ? "" : ","}${JSON.stringify(tablo)}:[`);
          ilkTablo = false;
          let sayi = 0;
          try {
            for await (const parca of tabloParcalari(supabase, tablo)) {
              for (const kayit of parca) {
                yaz(`${sayi ? "," : ""}${JSON.stringify(kayit)}`);
                sayi++;
              }
            }
          } catch (err) {
            // Artık sessizce geçilmiyor: hata meta'ya yazılır, tablo boş dizi olarak kapanır.
            hatalar.push({ tablo, hata: err instanceof Error ? err.message : String(err) });
          }
          satirSayilari[tablo] = sayi;
          yaz("]");
        }
        const meta = {
          proje: "ikikatweb",
          yedek_tarihi: tarih.toISOString(),
          kaynak: "web (/api/yedek)",
          toplam_tablo: YEDEK_TABLOLARI.length,
          basarili_tablo: YEDEK_TABLOLARI.length - hatalar.length,
          toplam_satir: Object.values(satirSayilari).reduce((s, n) => s + n, 0),
          yedek_disi: YEDEK_DISI,
          hatalar,
          uyarilar,
          tablo_satir_sayilari: satirSayilari,
        };
        yaz(`},"meta":${JSON.stringify(meta)}}`);
        kontrol.close();
      } catch (err) {
        kontrol.error(err);
      }
    },
  });

  return new NextResponse(akis, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ikikatweb-yedek-${tarihStr}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
