// Uyarı gizleme — "Anlaşıldı" / "Anladım" düğmesinin veri katmanı.
//
// Kullanıcının kendi kaydına yazar (app/api/uyari-gizle). Tarayıcı deposu DEĞİL:
// kullanıcı başka cihazdan girdiğinde de kapalı kalsın diye kalıcı olarak tutulur.
// Ayrıca her basış uyari_onaylari günlüğüne düşer (kim, ne zaman).

/** Uyarı anahtarı: "<uyari-tipi>:<kayit-id>" */
export const uyariAnahtari = (tip: string, kayitId: string) => `${tip}:${kayitId}`;

/** Uyarıyı bu kullanıcı için kapatır (geriAl=true → yeniden açar).
 *  kayitHatasi: uyarı kapandı AMA onay günlüğüne yazılamadı — arayüz bunu kullanıcıya
 *  söylemeli, yoksa "kim onayladı" kaydının tutulduğu sanılır. */
export async function uyariGizle(
  anahtar: string,
  geriAl = false,
): Promise<{ gizlenenler: string[]; kayitHatasi: string | null }> {
  const res = await fetch("/api/uyari-gizle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anahtar, geriAl }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Uyarı gizlenemedi.");
  const data = (await res.json()) as { gizlenen_uyarilar: string[]; kayitHatasi?: string | null };
  return { gizlenenler: data.gizlenen_uyarilar ?? [], kayitHatasi: data.kayitHatasi ?? null };
}
