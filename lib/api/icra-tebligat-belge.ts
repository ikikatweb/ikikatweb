// İCRA DOSYASININ TEBLİGAT BELGESİNİ BUL VE İNDİR — TEK YER.
//
// NİYE ORTAK: aynı iş iki serviste geçiyor (avukata gönder, muhasebeye gönder) ve
// ikisinde de kural aynı: EK İNMEDEN MAİL GİTMEZ. İki kopya tutulsaydı biri
// düzeltilir öbürü geride kalırdı — AGENTS.md'deki kasko olayı (27.10.2026) tam
// bunun yüzünden yaşandı: ek inmedi, hata yutuldu, mail eksik gitti.
//
// Dönen değer ya belge+içerik ya da KULLANICIYA GÖSTERİLECEK sebep. Sessiz
// "null" dönmüyor; çağıran servis sebebi olduğu gibi kullanıcıya veriyor.
import type { SupabaseClient } from "@supabase/supabase-js";
import { storageIndir } from "@/lib/api/storage-indir";

export type TebligatEk = { ad: string; yol: string; tur?: string | null };

type Sonuc =
  | { belge: TebligatEk; icerik: Buffer; hata?: undefined }
  | { belge?: undefined; icerik?: undefined; hata: { mesaj: string; kod: number } };

/**
 * @param kimIcin  Hata metninde geçer: "Avukat yazıyı görmeden cevap yazamaz" /
 *                 "Muhasebe yazıyı görmeden altlık hazırlayamaz" gibi.
 */
export async function icraTebligatBelgesi(
  sb: SupabaseClient,
  kayit: { dosya_esas_no?: string | null; belge_yolu?: string | null },
  sirket: boolean,
  kimIcin: string,
): Promise<Sonuc> {
  let belge: TebligatEk | null = null;

  // ŞİRKET DEFTERİNDE BELGE KAYDA BAĞLI: ödeme emri okunurken belge_yolu
  // yazılıyor, dosya esas numarasıyla tebligat aramaya gerek yok. Arama
  // yapılsaydı aynı numarayı taşıyan başka bir tebligat seçilebilirdi.
  if (sirket) {
    const yol = (kayit.belge_yolu ?? "").trim();
    if (!yol) {
      return { hata: { kod: 400, mesaj: "Bu takipte tebligat belgesi bağlı değil — mail GÖNDERİLMEDİ. " + kimIcin } };
    }
    belge = { ad: yol.split("/").pop() || "odeme-emri.pdf", yol };
  } else {
    // icra kaydında tebligat bağlantısı yok; eşleştirme dosya esas numarası
    // üzerinden. Konu biçimi: "<Daire> [2024/57908] [...]" — numara köşeli
    // parantez içinde geçiyor, benzersiz sayılabilir.
    if (!kayit.dosya_esas_no) {
      return { hata: { kod: 400, mesaj: "Kayıtta dosya esas no yok — tebligat belgesi eşleştirilemedi." } };
    }
    const { data: tebligatlar } = await sb.from("tebligat")
      .select("id, konu, ekler, paket_yolu, ulasma_tarihi, indirme_hatasi")
      .ilike("konu", `%${kayit.dosya_esas_no}%`)
      .order("ulasma_tarihi", { ascending: false });

    // "ustyazi" PTT'nin zarf kapağı; asıl yazı o değil. Belgesi olan EN YENİ
    // tebligat alınır.
    for (const t of (tebligatlar ?? []) as { ekler?: TebligatEk[] }[]) {
      const ekler = (t.ekler ?? []) as TebligatEk[];
      const yazi = ekler.find((e) => !/ustyazi/i.test(e.ad) && /pdf/i.test(e.tur ?? e.ad))
        ?? ekler.find((e) => /pdf/i.test(e.tur ?? e.ad));
      if (yazi) { belge = yazi; break; }
    }
    if (!belge) {
      return { hata: { kod: 400,
        mesaj: `${kayit.dosya_esas_no} için tebligat belgesi panelde yok — mail GÖNDERİLMEDİ. `
          + `Tebligatlar ekranından "Belgeleri getir" ile indirip tekrar deneyin.` } };
    }
  }

  // KOVALAR ÖZEL: düz fetch 400 döner, service role ile inilir (lib/api/storage-indir).
  const icerik = await storageIndir(belge.yol);
  if (!icerik) {
    return { hata: { kod: 502,
      mesaj: `Tebligat belgesi (${belge.ad}) indirilemedi — mail GÖNDERİLMEDİ. ${kimIcin}` } };
  }
  return { belge, icerik };
}
