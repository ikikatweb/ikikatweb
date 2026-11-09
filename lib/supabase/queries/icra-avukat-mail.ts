// AVUKATA MAİL GÖNDERME — iki ekran da bunu çağırır (hızlı cevap penceresi ve
// icra sayfasındaki tam form). Asıl iş sunucuda (app/api/icra/avukata-gonder):
// belgeyi bulur, indirir, maili gönderir ve ANCAK gittiyse cevap tarihini yazar.
export type AvukatMailSonucu = {
  alici: string;
  ek: string;
  /** Şirkete açılan takipte cevap tarihi diye bir alan yok — orada null döner. */
  cevap_tarihi: string | null;
  /** Maili gönderen kullanıcı (sunucuda oturumdan çözülür). */
  gonderen: string;
  gonderildiAt: string;
  /** Mail gitti ama kayıt güncellenemedi — kullanıcıya SÖYLENMELİ. */
  kayitHatasi: string | null;
  /** Antet kayıtlı ama inemedi — mail ANTETSİZ gitti. */
  antetInemedi: boolean;
};

/**
 * MAİL GİTTİKTEN SONRA EKRANA ÇIKAN HATIRLATMA.
 *
 * NİYE: dosyayı avukata göndermek işi bitirmiyor; panel bundan sonrasını
 * görmüyor (duruşma, haciz, itiraz sonucu avukatta kalıyor). "Gönderildi"
 * yazısı tek başına işin kapandığı izlenimi veriyordu.
 *
 * YALNIZ MAİL GERÇEKTEN GİTTİYSE gösterilir — gitmeyen bir maile "takip et"
 * demek yanlış yere güven verir.
 */
export const AVUKAT_TAKIP_NOTU =
  "Avukatla iletişime geçerek gelişmeler hakkında bilgi almayı unutmayın !";

export async function avukataGonder(
  icraId: string, avukatId: string, not: string, kaynak: "icra" | "sirket" = "icra",
): Promise<AvukatMailSonucu> {
  const res = await fetch("/api/icra/avukata-gonder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ icraId, avukatId, not, kaynak }),
  });
  const c = await res.json();
  if (!res.ok) throw new Error(c.error ?? "Mail gönderilemedi.");
  return c as AvukatMailSonucu;
}
