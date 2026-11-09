// AVUKATA MAİL GÖNDERME — iki ekran da bunu çağırır (hızlı cevap penceresi ve
// icra sayfasındaki tam form). Asıl iş sunucuda (app/api/icra/avukata-gonder):
// belgeyi bulur, indirir, maili gönderir ve ANCAK gittiyse cevap tarihini yazar.
export type AvukatMailSonucu = {
  alici: string;
  ek: string;
  cevap_tarihi: string;
  /** Maili gönderen kullanıcı (sunucuda oturumdan çözülür). */
  gonderen: string;
  gonderildiAt: string;
  /** Mail gitti ama kayıt güncellenemedi — kullanıcıya SÖYLENMELİ. */
  kayitHatasi: string | null;
  /** Antet kayıtlı ama inemedi — mail ANTETSİZ gitti. */
  antetInemedi: boolean;
};

export async function avukataGonder(icraId: string, avukatId: string, not: string): Promise<AvukatMailSonucu> {
  const res = await fetch("/api/icra/avukata-gonder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ icraId, avukatId, not }),
  });
  const c = await res.json();
  if (!res.ok) throw new Error(c.error ?? "Mail gönderilemedi.");
  return c as AvukatMailSonucu;
}
