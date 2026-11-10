// MUHASEBE AŞAMASI — GÖNDERİM ÇAĞRISI VE AŞAMA HESABI (TEK YER).
//
// Dosya panele girilir girilmez muhasebeye mail gidiyor; cevabın altlığını ve
// borç durumunu muhasebe çıkarıyor, CEVAP ŞEKLİNİ de o belirliyor. Asıl iş
// sunucuda (app/api/icra/muhasebeye-gonder): belgeyi bulur, indirir, maili
// gönderir ve ANCAK gittiyse izini yazar.
//
// AŞAMA HESABI BURADA: aynı üç hâl (gönderilmedi / bekleniyor / cevaplandı) beş
// yerde gösteriliyor — iki tablo, iki pencere, ana ekran uyarısı. Her birinde
// ayrı yazılsaydı biri değişip öbürü geride kalırdı.
import { sonGunHesapla, bugunISO, hatirlatmaZamaniMi, VARSAYILAN_CEVAP_SURESI } from "@/lib/utils/icra-sure";

export type MuhasebeMailSonucu = {
  /** Mail bu çağrıda gerçekten gitti mi? Otomatik gönderimde daha önce gitmişse false. */
  gonderildi: boolean;
  /** Otomatik gönderimde "zaten gönderilmişti" — ikinci mail atılmadı. */
  zatenGonderildi?: boolean;
  alicilar: string[];
  ek: string;
  /** Maili gönderen kullanıcı (sunucuda oturumdan çözülür). */
  gonderen: string;
  gonderildiAt: string;
  /** Mail gitti ama kayıt güncellenemedi — kullanıcıya SÖYLENMELİ. */
  kayitHatasi: string | null;
  /** Antet kayıtlı ama inemedi — mail ANTETSİZ gitti. */
  antetInemedi: boolean;
};

/**
 * @param otomatik  Gönderimi insan değil ekran başlattı. Kayıtta gönderim izi
 *                  varsa sunucu İKİNCİ MAİLİ ATMAZ — aynı dosyayı iki kullanıcının
 *                  ekranı ya da bir sayfa yenilemesi tetikleyebilir.
 */
export async function muhasebeyeGonder(
  icraId: string, kaynak: "icra" | "sirket" = "icra", not = "", otomatik = false,
): Promise<MuhasebeMailSonucu> {
  const res = await fetch("/api/icra/muhasebeye-gonder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ icraId, kaynak, not, otomatik }),
  });
  const c = await res.json();
  if (!res.ok) throw new Error(c.error ?? "Mail gönderilemedi.");
  return c as MuhasebeMailSonucu;
}

/** Aşamayı hesaplamak için gereken en küçük küme — iki defter de bunu karşılar. */
export type MuhasebeDurumu = {
  muhasebe_mail_at?: string | null;
  muhasebe_cevap_at?: string | null;
  /** Cevap maili POSTA KUTUSUNDA görüldü — içeriği işlendi demek DEĞİL. */
  muhasebe_cevap_mail_at?: string | null;
  muhasebe_cevap_mail_gonderen?: string | null;
  muhasebe_cevap_mail_konu?: string | null;
  /** Mailin düz metni — panelde okunsun diye. */
  muhasebe_cevap_mail_metin?: string | null;
  /** Mailin HTML aslı — ayrı pencerede sandbox iframe içinde gösterilir. */
  muhasebe_cevap_mail_html?: string | null;
  /** Mailin ekleri (hesap ekstresi): yazismalar kovasında, dosyaUrl ile açılır. */
  muhasebe_cevap_mail_ekler?: { ad: string; yol: string; cid?: string }[] | null;
  /** ESKİ KAYITLARDA DOLU OLABİLİR — artık sorulmuyor (10.11.2026). */
  muhasebe_borc_durumu?: string | null;
  muhasebe_borc_tutari?: number | null;
  muhasebe_cevap_sekli?: string | null;
  muhasebe_notu?: string | null;
};

export type MuhasebeAsama = "gonderilmedi" | "bekleniyor" | "cevaplandi";

/**
 * ÖLÇÜ MAİLİN KENDİSİ: muhasebe_mail_at boşsa mail GİTMEMİŞTİR (sunucu ancak
 * gönderim başarılıysa yazıyor). Cevap da panele girilmedikçe "bekleniyor"dur —
 * mail kutusunda duran bir cevap, panelde cevap sayılmaz.
 */
export function muhasebeAsamasi(k: MuhasebeDurumu | null | undefined): MuhasebeAsama {
  if (!k) return "gonderilmedi";
  if (k.muhasebe_cevap_at) return "cevaplandi";
  if (k.muhasebe_mail_at) return "bekleniyor";
  return "gonderilmedi";
}

/**
 * "MUHASEBEYE GÖNDERİLMEDİ" UYARISI HANGİ DOSYA İÇİN ANLAMLI?
 *
 * GEÇMİŞ DOSYALAR SAYILMAZ. Defterde 2021-2023 tebliğ tarihli, süresi yıllar önce
 * dolmuş cevapsız kayıtlar var (devredilen eski liste). Onlar için muhasebeden
 * altlık istemenin bir karşılığı yok; uyarıya katılsalar sayı hiç düşmez ve uyarı
 * duvar kâğıdına döner — okunmaz olur.
 *
 * Ölçü: cevap verilmemiş VE süresi henüz geçmemiş dosya.
 */
export function muhasebeGerekliMi(
  k: { teblig_tarihi?: string | null; cevapVerildi: boolean; sureGun?: number | null },
  sirket: boolean,
  bugun = bugunISO(),
): boolean {
  if (k.cevapVerildi) return false;
  const sure = sirket ? k.sureGun : (k.sureGun ?? VARSAYILAN_CEVAP_SURESI);
  const son = sonGunHesapla(k.teblig_tarihi ?? null, sure ?? null);
  // SÜRE BİLİNMİYORSA ELE ALINMIŞ SAYILMAZ: belgede süre yazmayan ödeme
  // emirlerinde gün hesaplanamıyor ama dosya yine de cevap bekliyor.
  if (!son) return true;
  return son >= bugun;
}

/** Muhasebe cevabı beklenirken süre daralıyor mu? Ana ekran uyarısının ölçüsü. */
export function muhasebeCevabiAcilMi(sonGun: string | null, bugun = bugunISO()): boolean {
  return hatirlatmaZamaniMi(sonGun, bugun);
}
