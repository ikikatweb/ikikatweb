// ANTETİN GRİ KOPYASI — tarayıcıda üretilir.
//
// NEDEN: Yazışma evrakları anteti siyah-beyaz basıyor, mail ise renkli gönderiyor.
// Kullanıcıya iki ayrı dosya hazırlatmak yerine renkli asıl bir kez yükleniyor,
// gri kopyası burada üretilip ayrıca saklanıyor.
//
// NEDEN CSS FİLTRESİ DEĞİL: ekranda `filter: grayscale(1)` yeterdi ama iOS yazdırması
// (lib/utils/evrak-yazdir.ts) html2canvas ile PDF üretiyor ve html2canvas CSS `filter`
// desteklemiyor — iPhone'dan basılan evrak renkli çıkardı. Gri kopya dosya olarak
// durursa her yolda (ekran, masaüstü yazdırma, iOS PDF) aynı görünür.

/** Gözün parlaklık algısına göre gri değer (Rec. 601). Düz ortalama alınsaydı
 *  turuncu logo soluk, mavi koyu çıkardı. */
function griDeger(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Renkli görseli gri tonlamalı PNG'ye çevirir. Saydamlık korunur (antetler
 * genelde saydam zeminli PNG).
 *
 * Hata durumunda HATA FIRLATIR — çağıran taraf sessizce geçmemeli: gri kopya
 * üretilemediyse yazışmada renkli antet basılır ve kimse fark etmez.
 */
export async function griKopyaUret(dosya: File): Promise<File> {
  const bitmap = await createImageBitmap(dosya);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d bağlamı alınamadı");
    ctx.drawImage(bitmap, 0, 0);

    // ctx.filter = "grayscale(1)" her tarayıcıda yok; piksel piksel çevirmek her yerde çalışır.
    const veri = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const p = veri.data;
    for (let i = 0; i < p.length; i += 4) {
      const gri = griDeger(p[i], p[i + 1], p[i + 2]);
      p[i] = gri; p[i + 1] = gri; p[i + 2] = gri; // alfa (p[i+3]) dokunulmaz
    }
    ctx.putImageData(veri, 0, 0);

    const blob = await new Promise<Blob | null>((cz) => canvas.toBlob(cz, "image/png"));
    if (!blob) throw new Error("gri kopya PNG'ye çevrilemedi");
    return new File([blob], "antet.png", { type: "image/png" });
  } finally {
    bitmap.close();
  }
}

/** Görselde gerçekten renk var mı? Kenar yumuşatma gürültüsünü saymaz.
 *  Zaten gri bir dosya yüklendiyse kullanıcıya "mail de siyah-beyaz gidecek" denebilsin diye. */
export async function renkliMi(dosya: File): Promise<boolean> {
  const bitmap = await createImageBitmap(dosya);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return true; // ölçemiyorsak uyarı verme
    ctx.drawImage(bitmap, 0, 0);
    const p = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let renkli = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 10) continue; // saydam piksel
      const fark = Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]);
      if (fark > 24 && ++renkli > 200) return true; // 200 belirgin renkli piksel → renkli say
    }
    return false;
  } catch {
    return true; // ölçemediysek uyarı verme
  } finally {
    bitmap.close();
  }
}
