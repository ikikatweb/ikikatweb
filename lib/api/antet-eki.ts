// MAİL ANTETİ — firmanın antet görselini mailin başına koyar.
//
// Görsel BAĞLANTI olarak değil, mailin İÇİNE gömülür (cid): uzaktaki resimleri çoğu mail
// programı kendiliğinden göstermiyor, antet görünmeyince mail antetsiz gitmiş gibi oluyor.
//
// İndirme service role ile yapılır (lib/api/storage-indir): kovalar özele çevrildikten
// sonra kayıtlı "public" adrese düz fetch 400 dönüyor.
//
// Tek kaynak: poliçeleştirme maili (app/api/police-talep-mail) ve teklif isteme maili
// (app/api/teklif-mail) aynı antet düzenini kullanıyor; iki yerde ayrı yazılınca biri
// değişip öbürü geride kalıyordu.

import { storageIndir } from "@/lib/api/storage-indir";

export type AntetSonucu = {
  /** Mailin en başına eklenecek HTML (antet yoksa boş metin). */
  html: string;
  /** nodemailer eki — antet inmediyse null. */
  ek: { filename: string; content: Buffer; cid: string } | null;
  /** Antet KAYITLI ama inemedi: mail gider, kullanıcıya söylenir. */
  inemedi: boolean;
};

/**
 * Firmanın antetini indirip mail başlığı HTML'ini ve ekini üretir.
 *
 * antetUrl boşsa (firmanın anteti tanımlı değil) sessizce boş döner — bu bir hata değil.
 * Tanımlı olup inemezse `inemedi: true` döner; çağıran taraf maili yine gönderebilir ama
 * kullanıcıya "ANTETSİZ gitti" demek ZORUNDADIR (bkz. AGENTS.md "Sessiz hata yok").
 */
export async function antetEki(antetUrl: string | null | undefined): Promise<AntetSonucu> {
  const bos: AntetSonucu = { html: "", ek: null, inemedi: false };
  if (!antetUrl) return bos;

  const icerik = await storageIndir(antetUrl);
  if (!icerik) return { ...bos, inemedi: true };

  const uzanti = (antetUrl.split("?")[0].split(".").pop() ?? "png").slice(0, 5);
  return {
    html: `<p style="margin:0 0 16px;"><img src="cid:antet" alt="" style="max-width:100%;height:auto;" /></p>`,
    ek: { filename: `antet.${uzanti}`, content: icerik, cid: "antet" },
    inemedi: false,
  };
}
