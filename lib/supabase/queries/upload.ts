import { createClient } from "@/lib/supabase/client";

// BÜYÜK dosya yükleme (≤50 MB) — İMZALI URL ile DOĞRUDAN Supabase'e (Vercel ~4.5MB limitini baypas).
// Evrak PDF'leri gibi büyük olabilecek dosyalar için. Resimler yine sıkıştırılır. publicUrl döner.
export async function uploadDosyaImzali(file: File, bucket: string, path: string): Promise<string> {
  let yuklenecek = file;
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    try { yuklenecek = await sikistirResim(file, 1920, 0.82); } catch { yuklenecek = file; }
  }
  const MAX_BYTES = 50 * 1024 * 1024;
  if (yuklenecek.size > MAX_BYTES) {
    throw new Error(`Dosya çok büyük (${(yuklenecek.size / 1024 / 1024).toFixed(1)} MB). Maksimum 50 MB.`);
  }
  // 1) İmzalı yükleme URL'i al
  const imzaRes = await fetch("/api/upload/imza", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, path }),
  });
  const imza = await imzaRes.json().catch(() => ({}));
  if (!imzaRes.ok) throw new Error(imza.error ?? "Yükleme hazırlanamadı");
  // 2) DOĞRUDAN Supabase Storage'a yükle (Vercel'e uğramaz → büyük dosya takılmaz)
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(imza.path, imza.token, yuklenecek, { contentType: yuklenecek.type });
  if (error) throw new Error(`Dosya yüklenemedi: ${error.message}`);
  return imza.publicUrl as string;
}

// Genel dosya yükleme helper'ı — herhangi bir bucket'a path ile yükler
// /api/upload route'unu kullanır (server-side, service role).
// Resim dosyaları otomatik olarak sıkıştırılır → Vercel 4.5MB body limitini aşmaz,
// telefondan çekilen yüksek çözünürlüklü fotoğraflar da güvenle yüklenir.
export async function uploadDosya(file: File, bucket: string, path: string): Promise<string> {
  // Resim ise sıkıştır (sadece JPEG/PNG/WebP — PDF/diğer dosyalar olduğu gibi gider)
  let yuklenecek = file;
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    try {
      yuklenecek = await sikistirResim(file, 1920, 0.82);
    } catch {
      // Sıkıştırma başarısız olursa orijinali yüklemeyi dene
      yuklenecek = file;
    }
  }

  // 4MB üstündeki dosya hala büyükse (PDF veya başarısız sıkıştırma) hata fırlat
  const MAX_BYTES = 4 * 1024 * 1024;
  if (yuklenecek.size > MAX_BYTES) {
    throw new Error(
      `Dosya çok büyük (${(yuklenecek.size / 1024 / 1024).toFixed(1)} MB). ` +
      `Maksimum 4 MB. Lütfen küçültüp tekrar deneyin.`,
    );
  }

  const formData = new FormData();
  formData.append("file", yuklenecek);
  formData.append("bucket", bucket);
  formData.append("path", path);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  // Sunucu HTML hatası dönerse (örn. Vercel 413 sayfası), JSON parse'ı patlamadan yakala
  let data: { url?: string; error?: string };
  try {
    data = await res.json();
  } catch {
    if (res.status === 413) {
      throw new Error("Dosya sunucu sınırını aşıyor. Lütfen daha küçük bir dosya seçin.");
    }
    throw new Error(`Yükleme hatası (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");
  return data.url as string;
}

// Resmi canvas üzerinden sıkıştır — JPEG'e çevir, max boyut & kalite uygula.
// maxDim: en uzun kenar; quality: 0..1 (0.82 ≈ %80'lik dosya boyutu, görsel olarak göze çarpmaz)
async function sikistirResim(file: File, maxDim: number, quality: number): Promise<File> {
  if (typeof window === "undefined" || typeof document === "undefined") return file;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Dosya okunamadı"));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Resim yüklenemedi"));
      img.onload = () => {
        let { width: w, height: h } = img;
        // En uzun kenarı maxDim'e göre küçült (orantılı)
        if (w > maxDim || h > maxDim) {
          if (w >= h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas oluşturulamadı")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error("Sıkıştırma başarısız")); return; }
            // Orijinalden büyükse orijinali kullan
            if (blob.size >= file.size) { resolve(file); return; }
            const yeniAd = file.name.replace(/\.[^.]+$/, "") + ".jpg";
            resolve(new File([blob], yeniAd, { type: "image/jpeg", lastModified: Date.now() }));
          },
          "image/jpeg",
          quality,
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
