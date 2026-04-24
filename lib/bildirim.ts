// Client-side push bildirim tetikleyici
// Insert fonksiyonlarından sonra fire-and-forget çağrılır
// Hata olursa sessizce geçer — bildirim gelmezse iş akışını bozmaz

export type BildirimPayload = {
  baslik: string;
  govde: string;
  url?: string;
  tag?: string;
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
