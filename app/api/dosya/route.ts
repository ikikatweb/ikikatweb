// DOSYA GEÇİDİ — Storage'daki özel dosyaları OTURUMLU kullanıcıya imzalı bağlantıyla verir.
//
// Önceden bucket'ların tamamı `public: true` idi: kasa slipleri, iş deneyim belgeleri,
// evrak taramaları, ruhsatlar internette anahtarsız okunabiliyordu (ölçüldü: anon anahtarıyla
// klasörler listelenip dosyalar anahtarsız indirildi). Bucket'lar özele çevrildi; veritabanında
// kayıtlı URL'ler ise olduğu gibi KALDI — o yüzden bu geçit kayıtlı genel-URL'i alır,
// bucket + yol'a ayırır ve kısa ömürlü imzalı URL'e yönlendirir.
//
// Böylece: arayüzde <a href>/<img src> yalnız `/api/dosya?u=...` olarak değişir, veri göçü
// gerekmez, dosyaya erişen her istek oturum kontrolünden geçer.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oturum, yetkisiz } from "@/lib/api/guvenlik";
import { storageIndir } from "@/lib/api/storage-indir";

export const dynamic = "force-dynamic";

/** Kayıtlı genel URL → { bucket, yol }. Beklenen biçim: .../storage/v1/object/public/<bucket>/<yol> */
function cozumle(u: string): { bucket: string; yol: string } | null {
  try {
    const url = new URL(u);
    const i = url.pathname.indexOf("/storage/v1/object/");
    if (i < 0) return null;
    // "public/" ya da "sign/" sonrasını al
    const kalan = url.pathname.slice(i + "/storage/v1/object/".length).replace(/^(public|sign|authenticated)\//, "");
    const [bucket, ...parcalar] = kalan.split("/");
    const yol = parcalar.join("/");
    if (!bucket || !yol) return null;
    return { bucket, yol: decodeURIComponent(yol) };
  } catch {
    return null;
  }
}

/** Uzantıdan içerik türü — ham modda tarayıcıya doğru türü söylemek için. */
function tur(yol: string): string {
  const u = (yol.split(".").pop() ?? "").toLowerCase();
  const harita: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf",
  };
  return harita[u] ?? "application/octet-stream";
}

export async function GET(request: Request) {
  if (!(await oturum())) return yetkisiz();

  const u = new URL(request.url).searchParams.get("u");
  if (!u) return NextResponse.json({ error: "u gerekli" }, { status: 400 });

  // Yalnız KENDİ Supabase projemizin URL'i kabul edilir — yoksa geçit açık yönlendiriciye
  // (open redirect) dönerdi: ?u=https://kotu.site ile kullanıcı başka yere gönderilebilirdi.
  const proje = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!proje || !u.startsWith(proje)) {
    return NextResponse.json({ error: "Geçersiz dosya adresi" }, { status: 400 });
  }

  const coz = cozumle(u);
  if (!coz) return NextResponse.json({ error: "Dosya yolu çözülemedi" }, { status: 400 });

  // HAM MOD (?ham=1) — yönlendirme YOK, dosyanın baytları buradan akar.
  //
  // NEDEN: 302 ile Supabase'e giden görseller tarayıcı için BAŞKA KÖKENden gelir ve
  // CORS izni olmadığı için üzerine çizildikleri tuvali "kirletir": canvas.toDataURL()
  // SecurityError atıyor. iPhone'da evrak yazdırma tam bunu yapıyor (html2canvas → jsPDF),
  // 26.10.2026'daki geçit değişikliğinden sonra PDF önizlemesi çalışmayı bıraktı.
  // İmza <img crossorigin> ile de kurtarılamıyor: CORS kipindeki istek çerez TAŞIMAZ,
  // geçit de oturum çerezine bakıyor → 401. Tek çözüm dosyayı aynı kökenden sunmak.
  // Antet/kaşe gibi tuvale çizilen küçük görseller bu modu kullanır (bkz. dosyaUrlHam).
  if (new URL(request.url).searchParams.get("ham") === "1") {
    const bayt = await storageIndir(u);
    if (!bayt) {
      // SESSİZ GEÇME: indirilemeyen görsel boş dönerse evrak antetsiz basılır.
      console.error(`[api/dosya] ham indirilemedi: ${coz.bucket}/${coz.yol}`);
      return NextResponse.json({ error: "Dosya indirilemedi" }, { status: 502 });
    }
    return new NextResponse(new Uint8Array(bayt), {
      headers: {
        "Content-Type": tur(coz.yol),
        "Content-Length": String(bayt.length),
        // Oturum sahibinin tarayıcısında önbelleklenir (ortak önbelleğe DİĞMEZ): antet her
        // sayfa açılışında yeniden inmesin, Vercel egress'i boşuna yanmasın.
        "Cache-Control": "private, max-age=3600",
        // Ham mod dosyayı KENDİ kökenimizden sunuyor (yönlendirme modunda dosya Supabase
        // kökeninde kalıyordu). Yüklenen bir SVG doğrudan açılırsa site içinde betik
        // çalıştırabilirdi → tür tahminini kapat ve belgeyi kum havuzuna al.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  }

  const sb = createClient(proje, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.storage.from(coz.bucket).createSignedUrl(coz.yol, 300);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? "Dosya bulunamadı" }, { status: 404 });
  }
  // 302: tarayıcı imzalı adrese gider. Yönlendirme önbelleğe ALINMAZ — imza 5 dk sonra ölür.
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
