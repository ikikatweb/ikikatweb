// Client-side push bildirim tetikleyici
// Insert fonksiyonlarından sonra fire-and-forget çağrılır
// Hata olursa sessizce geçer — bildirim gelmezse iş akışını bozmaz

export type BildirimPayload = {
  baslik: string;
  govde: string;
  url?: string;
  tag?: string;
  // Şantiye yöneticisi filtresi için: bu olay hangi şantiyeye ait?
  // (yönetici tüm bildirimleri alır; santiye_admin sadece atandığı şantiyelere ait olanları)
  santiye_id?: string | null;
};

export function bildirimGonder(payload: BildirimPayload): void {
  if (typeof window === "undefined") return;
  // await etmiyoruz — arkada gitsin, insert akışını yavaşlatmasın
  fetch("/api/push/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn("Bildirim gönderilemedi:", err);
  });
}

// Puantaj gibi çok sık tetiklenen olaylar için:
// Gün içinde her N'inci olayda 1 bildirim gönderir (1, 11, 21, ... giriş).
// Sayaç localStorage'da gün bazlı tutulur.
export function bildirimGonderHerNdaBir(
  kategori: string,
  n: number,
  payload: BildirimPayload,
): void {
  if (typeof window === "undefined") return;
  try {
    const bugun = new Date().toISOString().slice(0, 10);
    const key = `bildirim-sayac-${kategori}-${bugun}`;
    const sayac = parseInt(localStorage.getItem(key) ?? "0", 10) + 1;
    localStorage.setItem(key, String(sayac));
    // 1, n+1, 2n+1, ... olaylarda bildirim
    if ((sayac - 1) % n === 0) {
      bildirimGonder({
        ...payload,
        govde: `${payload.govde} · Bugünkü ${sayac}. giriş`,
      });
    }
  } catch {
    // localStorage yoksa normal bildirim gönder
    bildirimGonder(payload);
  }
}

// TL formatı (bildirim metni için kısa)
export function formatTL(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " TL";
}

// Tarih formatı (dd.MM.yyyy)
export function formatTarih(d: string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}
