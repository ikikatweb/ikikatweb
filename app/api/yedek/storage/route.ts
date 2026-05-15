// Supabase Storage yedek endpoint'i — tüm bucket'lardaki dosyaları ZIP olarak indirir.
// Yedek mantığı:
//   1. Yetki: sadece yönetici
//   2. Bucket listele (firmalar, santiyeler, yazismalar, araclar, arac-bakim, vb.)
//   3. Her bucket için tüm dosyaları recursive listele
//   4. Dosyaları indir, JSZip'e ekle (bucket adı / klasör yapısı korunur)
//   5. ZIP buffer'ı stream et
//
// NOT: ZIP dosyası büyük olabilir, indirme uzun sürebilir.
// Çok fazla dosya varsa (1000+) timeout'a takılabilir, o durumda bucket bazında ayrı ayrı indirebilirsin.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import JSZip from "jszip";

// Bilinen bucket isimleri — yeni bucket eklenirse buraya da ekle.
// /api/upload route'unda kullanılan tüm bucket'lar burada listeli.
const BUCKETLAR = [
  "yazismalar",   // Gelen/giden evrak PDF'leri, ekler
  "firmalar",     // Antet, kaşe görselleri
  "santiyeler",   // Şantiye dosyaları (iş deneyim, geçici/kesin kabul)
  "araclar",      // Araç dosyaları (ruhsat vb.)
  "arac-bakim",   // Bakım dosyaları
];

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

export async function GET() {
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

  const zip = new JSZip();
  const meta: {
    proje: string;
    yedek_tarihi: string;
    bucket_sayilari: Record<string, number>;
    toplam_dosya: number;
    isim_eslemesi: Record<string, { orijinal: string; okunakli: string }[]>;
    hatalar: { bucket: string; path?: string; hata: string }[];
  } = {
    proje: "ikikatweb",
    yedek_tarihi: new Date().toISOString(),
    bucket_sayilari: {},
    toplam_dosya: 0,
    isim_eslemesi: {},
    hatalar: [],
  };

  for (const bucket of BUCKETLAR) {
    try {
      const dosyalar = await listeleHepsi(supabase, bucket);
      let basarili = 0;
      meta.isim_eslemesi[bucket] = [];
      for (const item of dosyalar) {
        try {
          const { data, error } = await supabase.storage.from(bucket).download(item.path);
          if (error || !data) {
            meta.hatalar.push({ bucket, path: item.path, hata: error?.message ?? "data null" });
            continue;
          }
          const buffer = Buffer.from(await data.arrayBuffer());
          const okunakli = okunakliPath(bucket, item.path);
          zip.file(`${bucket}/${okunakli}`, buffer);
          meta.isim_eslemesi[bucket].push({ orijinal: item.path, okunakli });
          basarili++;
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          meta.hatalar.push({ bucket, path: item.path, hata: m });
        }
      }
      meta.bucket_sayilari[bucket] = basarili;
      meta.toplam_dosya += basarili;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      meta.hatalar.push({ bucket, hata: m });
      meta.bucket_sayilari[bucket] = 0;
    }
  }

  // Meta dosyasını ZIP'in köküne ekle
  zip.file("_yedek_meta.json", JSON.stringify(meta, null, 2));

  // ZIP'i buffer olarak üret
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const tarih = new Date();
  const tarihStr = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, "0")}-${String(tarih.getDate()).padStart(2, "0")}_${String(tarih.getHours()).padStart(2, "0")}-${String(tarih.getMinutes()).padStart(2, "0")}`;

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ikikatweb-dosya-yedek-${tarihStr}.zip"`,
      "Content-Length": String(zipBuffer.length),
    },
  });
}
