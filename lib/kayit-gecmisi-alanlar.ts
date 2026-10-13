// Kayıt geçmişinde sütun adlarını okunur hâle getirir.
//
// Günlük veritabanı sütun adını saklıyor ("sozlesme_fiyatlariyla_gerceklesen"); kullanıcıya
// böyle göstermek anlaşılmaz olurdu. Karşılığı olmayan alanlar için snake_case otomatik
// çözülür, yani yeni sütun eklenince burayı güncellemek ZORUNLU değil — sadece daha iyi
// bir ad vermek isteyince.

export const ALAN_ADLARI: Record<string, Record<string, string>> = {
  santiyeler: {
    is_adi: "İşin adı",
    is_grubu: "İş tanımı",
    il: "İl",
    ihaleli: "İhaleli iş",
    ekap_belge_no: "EKAP belge no",
    ihale_kayit_no: "İhale kayıt no",
    ilan_tarihi: "İlan tarihi",
    ihale_tarihi: "İhale tarihi",
    yuklenici_firma_id: "Yüklenici firma",
    is_ortak_girisim: "Ortak girişim",
    ortaklik_orani: "Ortaklık oranı",
    sozlesme_bedeli: "Sözleşme bedeli",
    para_birimi: "Para birimi",
    sozlesme_tarihi: "Sözleşme tarihi",
    sozlesme_imzalanmadi: "Sözleşme imzalanmadı",
    isyeri_teslim_tarihi: "İşyeri teslim tarihi",
    is_suresi: "İş süresi (gün)",
    is_bitim_tarihi: "İş bitim tarihi",
    sure_uzatimi: "Süre uzatımı",
    sure_uzatimlari: "Süre uzatımları",
    sure_uzatimli_tarih: "Süre uzatımlı tarih",
    ff_hesaplanacak: "Fiyat farkı hesaplanacak",
    ff_dahil_kalan_tutar: "FF dâhil kalan tutar",
    sozlesme_fiyatlariyla_gerceklesen: "Tamamlanan keşif",
    gecici_kabul_tarihi: "Geçici kabul tarihi",
    onay_tarihi_yok: "Onay tarihi yok",
    gecici_kabul_itibar_tarihi: "Geçici kabul itibar tarihi",
    kesin_kabul_tarihi: "Kesin kabul tarihi",
    tasfiye_tarihi: "Tasfiye tarihi",
    devir_tarihi: "Devir tarihi",
    teknik_personel_sayisi: "Teknik personel sayısı",
    teknik_personeller: "Teknik personeller",
    teknik_atama_gun: "Teknik atama süresi (gün)",
    teknik_dis_atama: "Firma yetkilisi ataması",
    depo_kapasitesi: "Depo kapasitesi",
    netsim_nokta_no: "Netsim işlem noktası",
    netsim_gerceklesen: "Netsim gerçekleşen",
    netsim_son_hakedis_kesif: "Son hakediş bedeli",
    netsim_son_hakedis_fark: "Son hakediş fiyat farkı",
    netsim_son_hakedis_tarih: "Son hakediş tarihi",
    durum: "Durum",
    sira_no: "Sıra no",
  },
  kullanicilar: {
    ad_soyad: "Ad soyad",
    kullanici_adi: "Kullanıcı adı",
    rol: "Rol",
    aktif: "Aktif",
    izinler: "Yetkiler",
    santiye_ids: "Şantiye yetkileri",
    firma_ids: "Firma yetkileri",
    yetki_kaynak_id: "Yetki kaynağı",
  },
};

const PARA_ALANLARI = /bedel|tutar|gerceklesen|maliyet|ucret|fiyat/i;
const TARIH_ALANI = /_tarihi?$|^tarih$/i;

/** Sütun adını okunur başlığa çevirir; karşılığı yoksa snake_case'i çözer. */
export function alanAdi(tablo: string, alan: string): string {
  const esle = ALAN_ADLARI[tablo]?.[alan];
  if (esle) return esle;
  const duz = alan.replace(/_/g, " ").trim();
  return duz.charAt(0).toLocaleUpperCase("tr") + duz.slice(1);
}

/** Ham metin değeri okunur hâle getirir (boş, Evet/Hayır, para, tarih). */
export function degerGoster(alan: string | null, deger: string | null): string {
  if (deger == null || deger === "") return "boş";
  if (deger === "true") return "Evet";
  if (deger === "false") return "Hayır";
  if (alan && TARIH_ALANI.test(alan) && /^\d{4}-\d{2}-\d{2}/.test(deger)) {
    return deger.slice(0, 10).split("-").reverse().join(".");
  }
  if (alan && PARA_ALANLARI.test(alan) && /^-?\d+(\.\d+)?$/.test(deger)) {
    return Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return deger.length > 80 ? deger.slice(0, 80) + "…" : deger;
}
