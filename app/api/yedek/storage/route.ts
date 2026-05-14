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

  // STORAGE YEDEĞİ — tüm bucket'lardaki dosyaları ZIP'e ekle
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const zip = new JSZip();
  const meta: {
    proje: string;
    yedek_tarihi: string;
    bucket_sayilari: Record<string, number>;
    toplam_dosya: number;
    hatalar: { bucket: string; path?: string; hata: string }[];
  } = {
    proje: "ikikatweb",
    yedek_tarihi: new Date().toISOString(),
    bucket_sayilari: {},
    toplam_dosya: 0,
    hatalar: [],
  };

  for (const bucket of BUCKETLAR) {
    try {
      const dosyalar = await listeleHepsi(supabase, bucket);
      let basarili = 0;
      for (const item of dosyalar) {
        try {
          const { data, error } = await supabase.storage.from(bucket).download(item.path);
          if (error || !data) {
            meta.hatalar.push({ bucket, path: item.path, hata: error?.message ?? "data null" });
            continue;
          }
          const buffer = Buffer.from(await data.arrayBuffer());
          // ZIP içindeki path: bucket-adi/orjinal/dosya/yolu.pdf
          zip.file(`${bucket}/${item.path}`, buffer);
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
