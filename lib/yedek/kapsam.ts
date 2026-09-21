// Yedek KAPSAMI — hangi tablolar/bucket'lar yedeklenir, hangileri bilinçli olarak dışarıda.
//
// TEK KAYNAK: hem web endpoint'i (app/api/yedek, app/api/yedek/storage) hem de bu makinedeki
// haftalık yerel yedek (scripts/yedek-al.ts) bu dosyayı kullanır. Liste iki yere kopyalandığı
// sürece biri güncellenip diğeri unutuluyordu; tablo adları yanlış yazıldığı halde yıllarca
// fark edilmemesinin sebebi buydu.
//
// Yeni tablo/bucket eklerken: ya listeye ekle ya da dışarıda-kalanlara SEBEBİYLE ekle.
// İkisine de eklenmezse yedek meta'sındaki "uyarilar" alanı bunu bildirir.

// ── Veritabanı tabloları ────────────────────────────────────────────────────────
export const YEDEK_TABLOLARI = [
  // Yönetim
  "firmalar",
  "santiyeler",
  "santiye_ortaklari",
  "santiye_is_gruplari",
  "kullanicilar",
  "goruntuleme_limit",
  "maliyet_gizli_santiye",
  // Personel
  "personel",
  "personel_santiye",
  "personel_atama_gecmisi",
  "personel_atama_manuel_gun",
  "personel_atama_bilgi_notu",
  "personel_teknik",
  "personel_brut_ucret",
  "personel_puantaj",
  "personel_islem_takip",
  // Araç
  "araclar",
  "arac_police",
  "arac_bakim",
  "arac_puantaj",
  "arac_puantaj_override",
  "arac_kira_bedeli",
  "teklif_gonderim",
  "sigorta_teklif",
  "sigorta_vazgec",
  // Yazışmalar / evrak
  "gelen_evrak",
  "giden_evrak",
  "giden_evrak_sayac",
  "evrak_sayac",
  "banka_yazismalari",
  "banka_yazisma_sayac",
  // Yakıt
  "yakit_alim",
  "arac_yakit",
  "yakit_virman",
  "arac_cinsi_yakit_limit",
  // Kasa / finans
  "kasa_hareketi",
  "kasa_hareketi_limit",
  "kredi_karti",
  "odeme_plani_kasa",
  "odeme_plani_satir",
  "icra",
  // İşçilik / Bordro
  "iscilik_takibi",
  "iscilik_aylik",
  "bordro_pending_mail",
  "bordro_gonderim",
  "bordro_gunluk_ucret",
  // Şantiye defteri
  "santiye_defteri",
  "santiye_defteri_kayit",
  // Otomatik senkron durumları — nerede kalındığı bilgisi; kaybolursa mailler baştan taranır
  "sigorta_mail_durum",
  "bildirge_imap_durum",
  // Netsim
  "netsim_isler",
  // Tanımlamalar / içerik
  "tanimlamalar",
  "yi_ufe",
  "haberler",
  // Mesajlaşma / bildirim
  "mesaj_konusma",
  "mesaj_uye",
  "mesaj",
  "push_subscriptions",
  // İhale
  "ihale",
  "ihale_katilimci",
  // Arvento (araç takip)
  "arvento_cihaz",           // cihaz ↔ plaka ↔ şoför eşlemesi
  "arvento_ayarlar",         // eşik/ayar değerleri
  "arvento_ocak",            // gün bazlı stabilize ocağı
  "arvento_giris",           // gün bazlı şantiye girişi
  "arvento_sezon_uzunluk",   // sezon bazlı yol uzunlukları
  "arvento_damper_sinif",    // damper olaylarının MANUEL sınıflandırması (elle girilmiş)
  "arvento_harita_katmani",  // NetCAD/KML kayıtlı katmanlar
  "arvento_gunluk_metrik",   // gün bazlı hesaplanmış metrikler
  "arac_arvento_rapor",      // günlük km/kontak/çalışma/damper
  "arac_arvento_guzergah",   // günlük GPS güzergahları — EN AĞIR tablo
  "makine_calisma_noktasi",  // iş makinesi çalışma noktaları — anlık konumdan birikir, geriye üretilemez
  "arvento_anlik",           // canlı konum — yedek anındaki anlık görüntü
  // NOT: Araç↔sekme atamaları "araclar.arvento_sekmeler" kolonunda → "araclar" ile yedekleniyor.
];

// Bilinçli olarak yedeğe ALINMAYAN tablolar — sebebiyle birlikte.
export const YEDEK_DISI: Record<string, string> = {
  bildirim_gecmisi: "bildirim logu — 45binden fazla satır, veri değeri düşük",
  arvento_harita_ozet: "harita özet önbelleği — rapor/güzergah verisinden yeniden üretilir",
  kasa_hareketi_backup_20260423: "eski manuel yedek tablosu",
  yedek_kaydi: "yedek alındı damgası (meta) — geri yüklenmesi anlamsız",
};

/**
 * GÜN AYNASI — ağır tabloların büyük sütunu haftalık JSON'a KONMAZ, ayrı gün dosyalarına
 * bir kez indirilir.
 *
 * arac_arvento_guzergah satır başına ~39 KB GPS noktası taşıyor; tablo 79 MB ve her hafta
 * baştan indiriliyordu (ayda ~315 MB egress). Oysa bir günün güzergahı bir kez yazılıyor,
 * sonra hiç değişmiyor. Gün gün aynalayınca yalnız YENİ günler iniyor: haftada ~6 MB.
 *
 * Haftalık JSON'da satırın geri kalanı (plaka, tarih, mesafe, nokta sayısı) duruyor —
 * özet bilgi tek dosyada kalsın, ağır kısım gün dosyasından gelsin.
 *
 * TAZE_GUN: son N gün her çalışmada yeniden indirilir; senkron o günü sonradan
 * tamamlıyor olabilir, "dosya var" diye atlarsak eksik gün donup kalır.
 */
export const GUN_AYNASI: Record<string, { gunSutunu: string; agirSutun: string }> = {
  arac_arvento_guzergah: { gunSutunu: "rapor_tarihi", agirSutun: "noktalar" },
};
export const TAZE_GUN = 3;

// Varsayılan sayfa boyutu. Satırları çok ağır olan tablolarda Supabase 1000 satırlık
// istekte HTTP 500 döndürüyor (ör. arac_arvento_guzergah: satır başına GPS nokta dizisi
// → 50 satır ≈ 1,7 MB), bu yüzden bu tablolar küçük parçalarla çekilir.
// (Gün aynası olan tablolarda ağır sütun zaten çekilmiyor; küçük parça yalnız gün
//  dosyalarını indirirken devrede.)
export const PARCA_BOYUTU = 1000;
export const OZEL_PARCA: Record<string, number> = {
  arac_arvento_guzergah: 50,
  arvento_harita_katmani: 2,  // KML/NetCAD geometrileri çok büyük
  arac_arvento_rapor: 500,
  makine_calisma_noktasi: 500,
};

// ── Storage bucket'ları ─────────────────────────────────────────────────────────
// Bucket listesi CANLI okunur; sabit liste tutmak yeni bucket'ların (ör. kasa-slipleri:
// 436 dosya / 106 MB) yedeksiz kalmasına yol açıyordu.
export const BUCKET_DISI = new Set([
  "arvento-gecici", // Arvento senkronunun indirdiği geçici rapor dosyaları
]);

// Canlı liste alınamazsa (izin/ağ hatası) kullanılacak bilinen bucket'lar.
export const YEDEK_BUCKET_LISTESI = [
  "yazismalar",     // Gelen/giden evrak PDF'leri, ekler
  "firmalar",       // Antet, kaşe görselleri
  "santiyeler",     // Şantiye dosyaları (iş deneyim, geçici/kesin kabul)
  "araclar",        // Araç dosyaları (ruhsat vb.)
  "arac-bakim",     // Bakım dosyaları
  "kasa-slipleri",  // Kasa hareketi slip/fiş görselleri
  "mesaj-dosya",    // Mesajlaşma ekleri
  "haberler",       // Haber görselleri
];
