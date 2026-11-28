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
// 28.11.2026 — SÜRE LİMİTİNE TAKILIYORDU, yedek alınamıyordu ("yarıda kesildi").
// Ölçüm: arac_arvento_guzergah TAM satırla çekiliyordu; 50'lik 66 parça = 41 sn ve
// 124 MB. Tek tablo 60 sn'lik bütçenin üçte ikisini yiyordu. İKİ DEĞİŞİKLİK:
//   1) GUN_AYNASI'ndaki ağır sütun (noktalar) ATLANIR — yerel script de böyle yapıyor.
//      41 sn → 1 sn, 124 MB → 1 MB. GPS noktaları web yedeğinde YOKTUR; haftalık yerel
//      yedekte gün dosyalarında duruyor. Bu, meta.kapsam_notu'nda yazılı.
//   2) SÜRE BÜTÇESİ: bütçe dolarsa kalan tablolar çekilmez ama dosya DÜZGÜN kapanır ve
//      alınamayan tablolar meta.alinmayan_tablolar + meta.uyarilar'da ADLARIYLA bildirilir.
//      Böylece eksik yedek sessiz kalmıyor; eskiden akış ortada kesiliyor, elde bozuk
//      JSON kalıyordu.
//
// Sayfalama SIRALI yapılır (order=id): sırasız offset sayfalamada PostgREST satır
// atlayıp tekrarlayabiliyor — yedekte bu sessiz veri kaybı demek. id kolonu olmayan
// tablolarda sıralama atlanır; o tabloların hepsi 400 satırın altında, yani tek
// parçada iniyor ve sayfalama hiç devreye girmiyor.
//
// Hangi tabloların yedeklendiği lib/yedek/kapsam.ts'te (tek kaynak; yerel yedek script'i
// de aynı listeyi kullanır). Tam ve garantili yedek için: scripts/yedek-al.ts —
// bu makinedeki haftalık görev, süre/boyut limitine takılmaz.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { yedekKapsami, YEDEK_DISI, PARCA_BOYUTU, OZEL_PARCA, GUN_AYNASI, TAVAN_SATIR } from "@/lib/yedek/kapsam";

// 300 saniye, 60 değil (28.11.2026 düzeltmesi). Buraya 60 yazılmıştı ve bu PLATFORM
// SINIRI sanılıyordu; ölçtüm, Vercel bu projede işlevi 300. saniyede kesiyor
// (dosya yedeği 300,3 sn'de 504 FUNCTION_INVOCATION_TIMEOUT verdi). 60'lık sınır
// kendi koyduğumuz sınırmış ve bütün tablolar dahil edilince (26-45 sn) tehlikeli
// biçimde yakındı.
export const maxDuration = 300;

// Akış sınırda kesilmeden önce kendimiz kapatalım: kalan 20 sn meta'yı yazmaya ve
// cevabı kapatmaya yeter.
const SURE_BUTCESI_MS = 280_000;

export async function GET() {
  const t0 = Date.now();
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
  const alinmayan: string[] = [];   // süre bütçesi dolduğu için atlanan tablolar

  // KAPSAM CANLI OKUNUR — elle liste yok. Veritabanındaki her gerçek tablo yedeğe
  // girer; yeni tablo eklenince hiçbir yere bir şey yazmak gerekmez. Hangi kaynaktan
  // okunduğu ve ne ters gittiği uyarı olarak meta'ya düşer.
  const kapsam = await yedekKapsami(supabaseUrl, supabaseServiceKey);
  uyarilar.push(...kapsam.uyarilar);

  // Ağır sütunu çıkarmış PostgREST select listesi (ör. arac_arvento_guzergah.noktalar).
  async function hafifSecim(sb: SupabaseClient, tablo: string, agirSutun: string): Promise<string> {
    const { data } = await sb.from(tablo).select("*").limit(1);
    const ornek = (data ?? [])[0] as Record<string, unknown> | undefined;
    const sutunlar = Object.keys(ornek ?? {}).filter((k) => k !== agirSutun);
    return sutunlar.length ? sutunlar.join(",") : "*";
  }

  // Aynı tablodan aynı anda kaç parça çekilir. 91 tablonun tamamı yedeğe girdiğinde
  // sıralı çekim 44,9 sn sürüyordu (60 sn sınırı) — ölçüm 28.11.2026. Parçalar sıralı
  // aralıklar olduğu için paralel çekilmeleri sonucu değiştirmez; yazım sırası korunur.
  const ES_ZAMANLI = 4;

  /** Tek bir parçayı getirir. Hata olduğu gibi fırlatılır; karar çağırana ait. */
  async function parcaGetir(
    sb: SupabaseClient, tablo: string, secim: string, sirala: boolean, offset: number, boyut: number,
  ): Promise<Record<string, unknown>[]> {
    const temel = sb.from(tablo).select(secim).range(offset, offset + boyut - 1);
    const { data, error } = sirala ? await temel.order("id") : await temel;
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  }

  // Bir tablonun satırlarını parça parça getirir. Ağır tablolarda Supabase 500 dönebiliyor;
  // o durumda parça boyutu küçültülüp yeniden denenir (10 satırın altına inilmez).
  async function* tabloParcalari(sb: SupabaseClient, tablo: string, secim: string, idVar: boolean | null) {
    // Ağır sütun çıkarıldıysa küçük parçaya gerek yok (satırlar artık hafif).
    // TAVAN_SATIR aşılamaz: aşılırsa dönen satır istenenden az olur ve döngü tabloyu
    // bitmiş sanıp SESSİZCE yarıda keser (bkz. kapsam.ts).
    let boyut = Math.min(
      TAVAN_SATIR,
      secim === "*" ? (OZEL_PARCA[tablo] ?? PARCA_BOYUTU) : PARCA_BOYUTU,
    );
    // id'si olmayan tabloda sıralamalı istek 42703 ile döner; kapsam bunu zaten söylüyor.
    // Bilinmiyorsa (null) dene, olmazsa geri al.
    let sirala = idVar !== false;

    // İLK PARÇA TEK BAŞINA: sıralama ve parça boyutu burada kesinleşir. Paralel
    // isteklerin ortasında boyut küçültmek ya da sıralamayı geri almak karışık olurdu.
    let ilk: Record<string, unknown>[];
    for (;;) {
      try { ilk = await parcaGetir(sb, tablo, secim, sirala, 0, boyut); break; }
      catch (e) {
        const h = e as { code?: string; message?: string };
        if (sirala && h.code === "42703") { sirala = false; continue; }   // id kolonu yok
        const yokHatasi = h.code === "PGRST205" || h.message?.toLowerCase().includes("not exist");
        if (!yokHatasi && boyut > 10) { boyut = Math.max(10, Math.floor(boyut / 4)); continue; }
        throw e;
      }
    }
    if (ilk.length) yield ilk;
    if (ilk.length < boyut) return;      // tablo tek parçada bitti

    // Gerisi paralel. Parça dolu gelmediği an tablo bitmiştir (sıralı aralıklar).
    let offset = boyut;
    for (;;) {
      const sonuclar = await Promise.all(
        Array.from({ length: ES_ZAMANLI }, (_, i) => parcaGetir(sb, tablo, secim, sirala, offset + i * boyut, boyut)),
      );
      for (const parca of sonuclar) {
        if (parca.length) yield parca;
        if (parca.length < boyut) return;
      }
      offset += ES_ZAMANLI * boyut;
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
        for (const { ad: tablo, idVar } of kapsam.tablolar) {
          yaz(`${ilkTablo ? "" : ","}${JSON.stringify(tablo)}:[`);
          ilkTablo = false;
          let sayi = 0;
          // SÜRE BÜTÇESİ DOLDU: kalan tabloları çekmeye kalkmak akışın ortada
          // kesilmesine yol açar. Boş dizi yazıp adını meta'ya not ediyoruz.
          if (Date.now() - t0 > SURE_BUTCESI_MS) {
            alinmayan.push(tablo);
            satirSayilari[tablo] = 0;
            yaz("]");
            continue;
          }
          try {
            const ayna = GUN_AYNASI[tablo];
            const secim = ayna ? await hafifSecim(supabase, tablo, ayna.agirSutun) : "*";
            for await (const parca of tabloParcalari(supabase, tablo, secim, idVar)) {
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
        if (alinmayan.length) {
          uyarilar.push(
            `SÜRE LİMİTİ: ${alinmayan.length} tablo ALINAMADI → ${alinmayan.join(", ")}. ` +
            "Bu yedek EKSİKTİR; tam yedek için C:\\ikikatweb-yedek klasöründeki haftalık yedeği kullanın.",
          );
        }
        const kapsamNotu = Object.entries(GUN_AYNASI)
          .map(([t, a]) => `${t}.${a.agirSutun} bu yedekte YOK (çok ağır) — haftalık yerel yedekteki gün dosyalarında.`)
          .join(" ");
        const meta = {
          proje: "ikikatweb",
          yedek_tarihi: tarih.toISOString(),
          kaynak: "web (/api/yedek)",
          kapsam_notu: kapsamNotu,
          alinmayan_tablolar: alinmayan,
          kapsam_kaynagi: kapsam.kaynak,   // canli | sema | bilinen
          toplam_tablo: kapsam.tablolar.length,
          basarili_tablo: kapsam.tablolar.length - hatalar.length - alinmayan.length,
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
