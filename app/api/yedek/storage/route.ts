// Supabase Storage yedek endpoint'i — tüm bucket'lardaki dosyaları ZIP olarak indirir.
// Yedek mantığı:
//   1. Yetki: sadece yönetici
//   2. Bucket listele (firmalar, santiyeler, yazismalar, araclar, arac-bakim, vb.)
//   3. Her bucket için tüm dosyaları recursive listele
//   4. Dosyaları indir (beşerli paralel), indirildikçe ZIP akışına yaz
//   5. Sona _yedek_meta.json ekle, merkezi dizini yaz ve akışı kapat
//
// 28.11.2026 — YEDEK ALINAMIYORDU. Ölçüm (üretim): 1.508 dosya / 765 MB tek cevapta
// toplanıyordu ve istek 300,3 saniyede 504 FUNCTION_INVOCATION_TIMEOUT veriyordu.
// Sebep üçlüydü: (1) her dosya belleğe alınıp JSZip'te birikiyordu, (2) ZIP ancak
// hepsi bittikten sonra tek parça üretiliyordu, (3) zaten sıkıştırılmış PDF/JPEG/MP4
// dosyaları bir de DEFLATE'ten geçiriliyordu.
//
// Şimdi: ZipAkis ile dosya indirildikçe AKIŞA yazılıyor (bellekte tek dosya durur,
// indirme ilk saniyede başlar), sıkıştırma yok, indirmeler beşerli paralel.
// ?kova=<ad> ile tek kova indirilebilir — en büyük kova 291 MB, hepsi 765 MB; yavaş
// bağlantıda tek tek almak tek çare. ?liste=1 kovaları dosya sayısı/boyutuyla döner.
//
// SÜRE BÜTÇESİ: bütçe dolarsa ZIP DÜZGÜN kapatılır ve alınamayan dosyalar
// _yedek_meta.json içindeki "alinmayan" alanına yazılır — eksik arşiv sessiz kalmaz.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { BUCKET_DISI, YEDEK_BUCKET_LISTESI } from "@/lib/yedek/kapsam";
import { ZipAkis } from "@/lib/yedek/zip-akis";

// Vercel bu projede işlevi 300 saniyede kesiyor (ölçüldü 28.11.2026: 300,3 sn'de 504).
export const maxDuration = 300;
// Kendi bütçemiz daha kısa: kalan süre ZIP'i düzgün kapatmaya ve meta yazmaya gider.
const SURE_BUTCESI_MS = 270_000;
// Aynı anda kaç dosya indirilir. En büyük dosya 20,5 MB → 5 taneyle bellek rahat.
const ES_ZAMANLI_INDIRME = 5;

// Bucket listesi CANLI olarak Supabase'den okunur — sabit liste tutmak, yeni bucket
// eklendiğinde (ör. kasa-slipleri: 436 dosya / 106 MB) o dosyaların yedeksiz kalmasına
// yol açıyordu. Kapsam tanımı lib/yedek/kapsam.ts'te (yerel yedek script'i de aynısını kullanır).
async function bucketAdlari(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.storage.listBuckets();
  if (error || !data?.length) return YEDEK_BUCKET_LISTESI.filter((b) => !BUCKET_DISI.has(b));
  return data.map((b) => b.name).filter((ad) => !BUCKET_DISI.has(ad));
}

// Tek bucket içindeki dosyaları RECURSIVE listele (alt klasörler dahil).
async function listeleHepsi(
  supabase: SupabaseClient,
  bucket: string,
  klasor = "",
): Promise<{ path: string; size: number | null }[]> {
  const sonuc: { path: string; size: number | null }[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(klasor, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      // Bucket yoksa atla
      if (error.message.toLowerCase().includes("not found") || error.message.toLowerCase().includes("does not exist")) {
        return [];
      }
      throw error;
    }
    if (!data || data.length === 0) break;
    for (const item of data) {
      const tamPath = klasor ? `${klasor}/${item.name}` : item.name;
      // Klasör mü dosya mı?
      // Supabase Storage list API: id null ise klasör, dolu ise dosya.
      if (item.id) {
        sonuc.push({
          path: tamPath,
          size: (item.metadata as { size?: number } | null)?.size ?? null,
        });
      } else {
        // Alt klasör — recursive
        const alt = await listeleHepsi(supabase, bucket, tamPath);
        sonuc.push(...alt);
      }
    }
    if (data.length < limit) break;
    offset += limit;
    if (offset > 50000) break; // Güvenlik
  }
  return sonuc;
}

export async function GET(request: Request) {
  const t0 = Date.now();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return NextResponse.json({ error: "Supabase yapılandırması eksik" }, { status: 500 });
  }

  // YETKİ KONTROLÜ — sadece yönetici
  try {
    const cookieStore = await cookies();
    const cookieAdiOnEk = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
    const tokenCookie = cookieStore.get(`sb-${cookieAdiOnEk}-auth-token`);
    if (!tokenCookie) {
      return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 401 });
    }
    let accessToken: string | null = null;
    try {
      const ham = tokenCookie.value.startsWith("base64-")
        ? Buffer.from(tokenCookie.value.slice(7), "base64").toString("utf-8")
        : tokenCookie.value;
      const parsed = JSON.parse(ham);
      accessToken = parsed?.access_token ?? null;
    } catch { /* sessiz */ }
    if (!accessToken) {
      return NextResponse.json({ error: "Geçersiz oturum" }, { status: 401 });
    }
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: userData } = await authClient.auth.getUser();
    if (!userData?.user?.id) {
      return NextResponse.json({ error: "Kullanıcı doğrulanamadı" }, { status: 401 });
    }
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

  // STORAGE YEDEĞİ — tüm bucket'lardaki dosyaları ZIP'e ekle.
  // Dosyaları okunaklı isimle (firma_adi, plaka, iş_adi, evrak konusu) klasörlere yerleştirir.
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const sorgu = new URL(request.url).searchParams;
  const tumKovalar = await bucketAdlari(supabase);

  // ===== ?liste=1 — kovalar, dosya sayıları ve boyutları. Sayfa her kovayı ayrı
  // indirebilsin diye; hepsini tek seferde almak yavaş bağlantıda süreye takılıyor.
  if (sorgu.get("liste") === "1") {
    const kovalar: { kova: string; dosya: number; bayt: number; hata?: string }[] = [];
    for (const kova of tumKovalar) {
      try {
        const d = await listeleHepsi(supabase, kova);
        kovalar.push({ kova, dosya: d.length, bayt: d.reduce((t, x) => t + (x.size ?? 0), 0) });
      } catch (err) {
        // Sessiz geçilmez: sayfada o kovanın yanında hata görünsün.
        kovalar.push({ kova, dosya: 0, bayt: 0, hata: err instanceof Error ? err.message : String(err) });
      }
    }
    return NextResponse.json({ kovalar }, { headers: { "Cache-Control": "no-store" } });
  }

  // ===== ?kova=<ad> — yalnız o kova. Yoksa hepsi.
  const istenenKova = sorgu.get("kova");
  if (istenenKova && !tumKovalar.includes(istenenKova)) {
    return NextResponse.json({ error: `Kova bulunamadı: ${istenenKova}` }, { status: 404 });
  }
  const kovalar = istenenKova ? [istenenKova] : tumKovalar;

  // ===== DB LOOKUP MAP'LERİ — UUID'leri insan-okunabilir isimlere çevir =====
  // Dosya/klasör adı için filesystem-safe string'e çevir.
  function dosyaSafe(s: string, maxLen = 80): string {
    return s
      .replace(/[\\/:*?"<>|]/g, "_")   // OS yasak karakterleri
      .replace(/[\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen);
  }

  // UUID kontrol — bir string standart 36 karakter UUID formatında mı?
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = (s: string) => UUID_RE.test(s);

  const firmaMap = new Map<string, string>();    // firma_id → firma_adi
  const santiyeMap = new Map<string, string>();  // santiye_id → is_adi
  const aracMap = new Map<string, string>();     // arac_id → plaka
  const bakimAracMap = new Map<string, { aracId: string; tarih: string }>(); // bakim_id → {arac, tarih}
  const policeAracMap = new Map<string, string>(); // police_id → arac_id
  const evrakMap = new Map<string, { konu: string; tarih: string; sayiNo: string; tip: "gelen" | "giden" | "banka" }>(); // pdf_url → bilgi

  try {
    const [firmalarRes, santiyelerRes, araclarRes, bakimRes, policeRes, gelenRes, gidenRes, bankaRes] = await Promise.all([
      supabase.from("firmalar").select("id, firma_adi"),
      supabase.from("santiyeler").select("id, is_adi"),
      supabase.from("araclar").select("id, plaka"),
      supabase.from("arac_bakim").select("id, arac_id, bakim_tarihi"),
      supabase.from("arac_police").select("id, arac_id"),
      supabase.from("gelen_evrak").select("pdf_url, konu, evrak_tarihi, evrak_sayi_no").not("pdf_url", "is", null),
      supabase.from("giden_evrak").select("pdf_url, konu, evrak_tarihi, evrak_sayi_no").not("pdf_url", "is", null),
      supabase.from("banka_yazismalari").select("pdf_url, konu, evrak_tarihi, evrak_sayi_no").not("pdf_url", "is", null),
    ]);
    for (const f of (firmalarRes.data ?? []) as { id: string; firma_adi: string }[]) firmaMap.set(f.id, f.firma_adi);
    for (const s of (santiyelerRes.data ?? []) as { id: string; is_adi: string }[]) santiyeMap.set(s.id, s.is_adi);
    for (const a of (araclarRes.data ?? []) as { id: string; plaka: string }[]) aracMap.set(a.id, a.plaka);
    for (const b of (bakimRes.data ?? []) as { id: string; arac_id: string; bakim_tarihi: string }[]) {
      bakimAracMap.set(b.id, { aracId: b.arac_id, tarih: b.bakim_tarihi });
    }
    for (const p of (policeRes.data ?? []) as { id: string; arac_id: string }[]) policeAracMap.set(p.id, p.arac_id);
    // Yazışmalar — pdf_url'i tam URL veya path olabilir. Her ikisi için map'e ekle.
    const evrakEkle = (rows: { pdf_url: string | null; konu: string; evrak_tarihi: string; evrak_sayi_no: string }[], tip: "gelen" | "giden" | "banka") => {
      for (const r of rows) {
        if (!r.pdf_url) continue;
        evrakMap.set(r.pdf_url, { konu: r.konu, tarih: r.evrak_tarihi, sayiNo: r.evrak_sayi_no, tip });
      }
    };
    evrakEkle((gelenRes.data ?? []) as never, "gelen");
    evrakEkle((gidenRes.data ?? []) as never, "giden");
    evrakEkle((bankaRes.data ?? []) as never, "banka");
  } catch (err) {
    // Lookup başarısız olsa bile yedeklemeye devam et — sadece UUID'lerle kalır.
    console.error("[yedek/storage] lookup map hatası:", err);
  }

  // Bucket bazında path → okunaklı path dönüşümü.
  // Geriye dönen path filesystem-safe olmalı; aynı UUID birden fazla dosya içerdiğinden
  // klasör adı UUID'nin SON 6 karakterini de içerir (çakışmaları önler).
  function okunakliPath(bucket: string, origPath: string): string {
    const parcalar = origPath.split("/");
    // İlk segment çoğu bucket'ta bir UUID veya sabit alt klasör adı.
    const ilk = parcalar[0];
    const sonEk = isUuid(ilk) ? `_${ilk.slice(-6)}` : ""; // UUID'lerin son 6 hanesi çakışmaya karşı

    if (bucket === "firmalar" && isUuid(ilk)) {
      const ad = firmaMap.get(ilk);
      if (ad) parcalar[0] = `${dosyaSafe(ad)}${sonEk}`;
    } else if (bucket === "santiyeler" && isUuid(ilk)) {
      const ad = santiyeMap.get(ilk);
      if (ad) parcalar[0] = `${dosyaSafe(ad)}${sonEk}`;
    } else if (bucket === "araclar") {
      if (ilk === "police" && parcalar.length > 1 && isUuid(parcalar[1])) {
        const policeId = parcalar[1];
        const aracId = policeAracMap.get(policeId);
        const plaka = aracId ? aracMap.get(aracId) : null;
        const sonEkP = `_${policeId.slice(-6)}`;
        parcalar[1] = plaka ? `${dosyaSafe(plaka)}_police${sonEkP}` : `police${sonEkP}`;
      } else if (isUuid(ilk)) {
        const plaka = aracMap.get(ilk);
        if (plaka) parcalar[0] = `${dosyaSafe(plaka)}${sonEk}`;
      }
    } else if (bucket === "arac-bakim" && isUuid(ilk)) {
      const bakim = bakimAracMap.get(ilk);
      if (bakim) {
        const plaka = aracMap.get(bakim.aracId);
        const tarih = bakim.tarih ?? "tarihsiz";
        parcalar[0] = plaka ? `${dosyaSafe(plaka)}_${tarih}${sonEk}` : `${tarih}${sonEk}`;
      }
    } else if (bucket === "yazismalar" && parcalar.length >= 3) {
      // yazismalar/gelen/{firmaId}/{file}, gelen-ek, giden, banka
      const tip = parcalar[0]; // "gelen" | "gelen-ek" | "giden" | "banka"
      const firmaId = parcalar[1];
      if (isUuid(firmaId)) {
        const ad = firmaMap.get(firmaId);
        if (ad) parcalar[1] = dosyaSafe(ad);
      }
      // Dosya adına evrak bilgisi (konu) eklemek için pdf_url ile eşleştir.
      // origPath, supabase storage path'i — pdf_url ise public URL.
      // Her iki yöne de denemek için endsWith kontrolüyle ara.
      const dosyaAdi = parcalar[parcalar.length - 1];
      let evrakBilgi: { konu: string; tarih: string; sayiNo: string } | null = null;
      for (const [url, info] of evrakMap) {
        // gelen-ek için ekler ayrı tutulur, ana evrak pdf_url'den farklı path'te.
        // gelen/giden/banka için tam path eşleşmesi: pdf_url URL'i origPath ile bitiyorsa eşleşir.
        if (url.endsWith(origPath) || url.endsWith(dosyaAdi)) {
          if ((tip === "gelen" && info.tip === "gelen")
            || (tip === "giden" && info.tip === "giden")
            || (tip === "banka" && info.tip === "banka")) {
            evrakBilgi = info;
            break;
          }
        }
      }
      if (evrakBilgi) {
        const eklem = `${evrakBilgi.tarih}_${dosyaSafe(evrakBilgi.konu, 40)}`;
        // Orijinal dosya uzantısını koru
        const uzanti = dosyaAdi.includes(".") ? dosyaAdi.slice(dosyaAdi.lastIndexOf(".")) : "";
        parcalar[parcalar.length - 1] = `${eklem}${uzanti}`;
      }
    }

    return parcalar.join("/");
  }

  const tarih = new Date();
  const tarihStr = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, "0")}-${String(tarih.getDate()).padStart(2, "0")}_${String(tarih.getHours()).padStart(2, "0")}-${String(tarih.getMinutes()).padStart(2, "0")}`;

  const meta: {
    proje: string;
    yedek_tarihi: string;
    kapsam: string;
    bucket_sayilari: Record<string, number>;
    toplam_dosya: number;
    toplam_bayt: number;
    isim_eslemesi: Record<string, { orijinal: string; okunakli: string }[]>;
    alinmayan: { bucket: string; path: string; sebep: string }[];
    hatalar: { bucket: string; path?: string; hata: string }[];
  } = {
    proje: "ikikatweb",
    yedek_tarihi: tarih.toISOString(),
    kapsam: istenenKova ? `tek kova: ${istenenKova}` : "bütün kovalar",
    bucket_sayilari: {},
    toplam_dosya: 0,
    toplam_bayt: 0,
    isim_eslemesi: {},
    alinmayan: [],
    hatalar: [],
  };

  const akis = new ReadableStream<Uint8Array>({
    async start(kontrol) {
      const zip = new ZipAkis((parca) => kontrol.enqueue(parca));
      try {
        for (const bucket of kovalar) {
          let dosyalar: { path: string; size: number | null }[];
          try {
            dosyalar = await listeleHepsi(supabase, bucket);
          } catch (err) {
            meta.hatalar.push({ bucket, hata: err instanceof Error ? err.message : String(err) });
            meta.bucket_sayilari[bucket] = 0;
            continue;
          }
          let basarili = 0;
          meta.isim_eslemesi[bucket] = [];

          // Beşerli paralel indir, ZIP'e SIRAYLA yaz (arşiv düzeni bozulmasın).
          for (let i = 0; i < dosyalar.length; i += ES_ZAMANLI_INDIRME) {
            if (Date.now() - t0 > SURE_BUTCESI_MS) {
              // Bütçe doldu: kalan her dosya ADIYLA meta'ya yazılır, ZIP düzgün kapanır.
              for (const kalan of dosyalar.slice(i)) {
                meta.alinmayan.push({ bucket, path: kalan.path, sebep: "süre limiti" });
              }
              break;
            }
            const kume = dosyalar.slice(i, i + ES_ZAMANLI_INDIRME);
            const sonuclar = await Promise.all(kume.map(async (item) => {
              try {
                const { data, error } = await supabase.storage.from(bucket).download(item.path);
                if (error || !data) return { item, hata: error?.message ?? "data null" };
                return { item, bayt: new Uint8Array(await data.arrayBuffer()) };
              } catch (err) {
                return { item, hata: err instanceof Error ? err.message : String(err) };
              }
            }));
            for (const r of sonuclar) {
              if (!("bayt" in r) || !r.bayt) {
                meta.hatalar.push({ bucket, path: r.item.path, hata: r.hata ?? "bilinmeyen" });
                continue;
              }
              const okunakli = okunakliPath(bucket, r.item.path);
              zip.dosyaEkle(`${bucket}/${okunakli}`, r.bayt, tarih);
              meta.isim_eslemesi[bucket].push({ orijinal: r.item.path, okunakli });
              meta.toplam_bayt += r.bayt.length;
              basarili++;
            }
          }
          meta.bucket_sayilari[bucket] = basarili;
          meta.toplam_dosya += basarili;
        }

        // Meta EN SONA yazılır: o ana kadar ne indi, ne inmedi, ne hata verdi hepsi burada.
        zip.dosyaEkle(
          "_yedek_meta.json",
          new TextEncoder().encode(JSON.stringify(meta, null, 2)),
          tarih,
        );
        zip.bitir();
        kontrol.close();
      } catch (err) {
        // Buraya düşmek = ZIP bozuk. Akışı hata ile kapatıyoruz; tarayıcı yarım
        // dosyayı "indirildi" sanmasın.
        console.error("[yedek/storage] akış hatası:", err);
        kontrol.error(err);
      }
    },
  });

  const adEk = istenenKova ? `-${istenenKova}` : "";
  return new NextResponse(akis, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ikikatweb-dosya-yedek${adEk}-${tarihStr}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
