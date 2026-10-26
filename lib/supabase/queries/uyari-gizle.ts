// Uyarı gizleme — "Anlaşıldı" düğmesinin veri katmanı.
//
// Kullanıcının kendi kaydına yazar (app/api/uyari-gizle). Tarayıcı deposu DEĞİL:
// kullanıcı başka cihazdan girdiğinde de kapalı kalsın diye kalıcı olarak tutulur.

/** Uyarı anahtarı: "<uyari-tipi>:<kayit-id>" */
export const uyariAnahtari = (tip: string, kayitId: string) => `${tip}:${kayitId}`;

export async function uyariGizle(anahtar: string, geriAl = false): Promise<string[]> {
  const res = await fetch("/api/uyari-gizle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anahtar, geriAl }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Uyarı gizlenemedi.");
  const data = (await res.json()) as { gizlenen_uyarilar: string[] };
  return data.gizlenen_uyarilar ?? [];
}
