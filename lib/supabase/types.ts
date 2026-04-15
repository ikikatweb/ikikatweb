// Supabase veritabanı tip tanımları - Tablolar eklendikçe güncellenecek

export type Firma = {
  id: string;
  sira_no: number;
  durum: "aktif" | "pasif";
  firma_adi: string;
  kisa_adi: string | null;
  vergi_no: string | null;
  adres: string | null;
  kase_url: string | null;
  antet_url: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_sender_name: string | null;
  smtp_sender_email: string | null;
  created_at: string;
  updated_at: string;
};

export type FirmaInsert = Omit<Firma, "id" | "sira_no" | "created_at" | "updated_at">;
export type FirmaUpdate = Partial<FirmaInsert>;

export type YiUfe = {
  id: string;
  yil: number;
  ay: number;
  endeks: number;
  created_at: string;
};

export type YiUfeInsert = Omit<YiUfe, "id" | "created_at">;

export type Santiye = {
  id: string;
  sira_no: number;
  durum: "aktif" | "tamamlandi" | "tasfiye" | "devir";
  is_adi: string;
  is_grubu: string | null;
  benzer_is_grubu: string | null; // Benzer İş Grubu (A-V, B-II vb.)
  ekap_belge_no: string | null;
  ihale_kayit_no: string | null;
  ilan_tarihi: string | null;
  ihale_tarihi: string | null;
  yuklenici_firma_id: string | null;
  is_ortak_girisim: boolean;
  ortaklik_orani: number | null;
  sozlesme_bedeli: number | null;
  sozlesme_tarihi: string | null;
  isyeri_teslim_tarihi: string | null;
  is_suresi: number | null;
  is_bitim_tarihi: string | null;
  sure_uzatimlari: number[];
  sure_uzatimi: number | null;
  sure_uzatimli_tarih: string | null;
  ff_dahil_kalan_tutar: number | null;
  sozlesme_fiyatlariyla_gerceklesen: number | null;
  tasfiye_tarihi: string | null;
  devir_tarihi: string | null;
  gecici_kabul_tarihi: string | null;
  gecici_kabul_url: string | null;
  kesin_kabul_tarihi: string | null;
  kesin_kabul_url: string | null;
  is_deneyim_url: string | null;
  depo_kapasitesi: number | null;
  created_at: string;
  updated_at: string;
};

export type SantiyeInsert = Omit<Santiye, "id" | "sira_no" | "created_at" | "updated_at">;
export type SantiyeUpdate = Partial<SantiyeInsert>;

export type SantiyeWithRelations = Santiye & {
  firmalar?: { firma_adi: string; sira_no?: number } | null;
};

// İş grubu dağılımı: bir şantiyenin gerçekleşen tutarının iş gruplarına bölünmesi
export type SantiyeIsGrubu = {
  id: string;
  santiye_id: string;
  is_grubu: string;
  tutar: number;
  created_at: string;
};

export type SantiyeOrtagi = {
  id: string;
  santiye_id: string;
  firma_id: string;
  oran: number;
  is_pilot: boolean;
};

export type Personel = {
  id: string;
  tc_kimlik_no: string;
  ad_soyad: string;
  meslek: string | null;
  gorev: string | null;
  santiye_id: string | null;
  maas: number | null;
  izin_hakki: number | null;
  mesai_ucreti_var: boolean;
  ise_giris_tarihi: string | null;
  durum: "aktif" | "pasif";
  pasif_tarihi: string | null;
  created_at: string;
  updated_at: string;
};

export type PersonelInsert = Omit<Personel, "id" | "created_at" | "updated_at">;
export type PersonelUpdate = Partial<PersonelInsert>;

export type PersonelWithRelations = Personel & {
  santiyeler?: { is_adi: string } | null;
};

// Personel-Şantiye çoklu atama ilişki tablosu
// Bir personel aynı anda birden fazla şantiyeye atanabilir.
export type PersonelSantiye = {
  personel_id: string;
  santiye_id: string;
  atanma_tarihi: string;
};

export type Arac = {
  id: string;
  sira_no: number;
  tip: "ozmal" | "kiralik";
  durum: "aktif" | "pasif" | "trafikten_cekildi";
  plaka: string;
  marka: string | null;
  model: string | null;
  cinsi: string | null;
  yili: number | null;
  sayac_tipi: "km" | "saat" | null;
  guncel_gosterge: number | null;
  santiye_id: string | null;
  firma_id: string | null;
  hgs_saglayici: string | null;
  motor_no: string | null;
  sase_no: string | null;
  yakit_tipi: string | null;
  son_muayene_tarihi: string | null;
  trafik_sigorta_bitis: string | null;
  kasko_bitis: string | null;
  muayene_bitis: string | null;
  tasit_karti_bitis: string | null;
  ruhsat_url: string | null;
  kiralama_firmasi: string | null;
  kiralik_iletisim: string | null;
  created_at: string;
  updated_at: string;
};

export type AracInsert = Omit<Arac, "id" | "sira_no" | "created_at" | "updated_at">;
export type AracUpdate = Partial<AracInsert>;

// Araç poliçe (kasko / trafik sigortası)
export type AracPolice = {
  id: string;
  arac_id: string;
  police_tipi: "kasko" | "trafik";
  tutar: number | null;
  sigorta_firmasi: string | null;
  acente: string | null;
  islem_tarihi: string | null;
  baslangic_tarihi: string | null;
  bitis_tarihi: string | null;
  police_no: string | null;
  police_url: string | null;
  created_by: string | null;
  created_at: string;
};

// Teklif gönderim kaydı
export type TeklifGonderim = {
  id: string;
  arac_id: string;
  police_tipi: "kasko" | "trafik";
  acente_adlari: string;
  acente_emailleri: string;
  created_at: string;
};

export type AracWithRelations = Arac & {
  firmalar?: { firma_adi: string } | null;
  santiyeler?: { is_adi: string } | null;
};

export type IscilikTakibi = {
  id: string;
  santiye_id: string;
  silindi: boolean;
  sicil_no: string | null;
  kesif_artisi: number | null;
  fiyat_farki: number | null;
  iscilik_orani: number | null;
  yatmasi_gereken_prim: number | null;
  yatan_prim: number | null;
  baslangic_tarihi: string | null;
  sure_text: string | null;
  taseron_veri_isleme_tarihi: string | null;
  son_veri_girisi_tarihi: string | null;
  toplam_son_veri_tutari: number | null;
  created_at: string;
  updated_at: string;
};

export type IscilikAylik = {
  id: string;
  iscilik_takibi_id: string;
  sira_no: number;
  ait_oldugu_ay: string;
  alt_yuklenici_tutar: number | null;
  yuklenici_tutar: number | null;
  created_at: string;
};

export type IscilikTakibiWithSantiye = IscilikTakibi & {
  santiyeler: {
    sira_no: number;
    is_adi: string;
    is_grubu: string | null;
    sozlesme_bedeli: number | null;
    sure_uzatimi: number | null;
    is_suresi: number | null;
    is_bitim_tarihi: string | null;
    isyeri_teslim_tarihi: string | null;
    gecici_kabul_tarihi: string | null;
    created_at: string;
  };
};

export type Tanimlama = {
  id: string;
  kategori: string;
  sekme: string | null;
  deger: string;
  kisa_ad: string | null;
  sira: number;
  aktif: boolean;
  created_at: string;
};

export type TanimlamaInsert = Omit<Tanimlama, "id" | "created_at" | "kisa_ad"> & { kisa_ad?: string | null };

export type GelenEvrak = {
  id: string;
  evrak_tarihi: string;
  firma_id: string | null;
  santiye_id: string | null;
  evrak_sayi_no: string;
  konu: string;
  ilgi: string | null;
  icerik: string | null;
  muhatap: string | null;
  ekler: string | null;
  pdf_url: string | null;
  olusturan_id: string;
  olusturma_tarihi: string;
  silindi: boolean;
  silme_nedeni: string | null;
  silen_id: string | null;
  silme_tarihi: string | null;
  created_at: string;
  updated_at: string;
};

export type GelenEvrakInsert = Omit<GelenEvrak, "id" | "created_at" | "updated_at" | "silen_id" | "silme_tarihi"> & {
  silen_id?: string | null;
  silme_tarihi?: string | null;
};

export type GelenEvrakWithRelations = GelenEvrak & {
  firmalar?: { firma_adi: string; kisa_adi: string | null; adres: string | null; antet_url: string | null; kase_url: string | null } | null;
  santiyeler?: { is_adi: string } | null;
  kullanicilar?: { ad_soyad: string } | null;
  silen_kullanici?: { ad_soyad: string } | null;
};

export type GidenEvrak = {
  id: string;
  evrak_tarihi: string;
  firma_id: string;
  santiye_id: string | null;
  evrak_sayi_no: string;
  evrak_kayit_no: string | null;
  konu: string;
  muhatap: string | null;
  muhatap_id: string | null;
  ilgi_listesi: string[];
  metin: string | null;
  ekler: string[];
  kase_dahil: boolean;
  pdf_url: string | null;
  olusturan_id: string;
  olusturma_tarihi: string;
  silindi: boolean;
  silme_nedeni: string | null;
  silen_id: string | null;
  silme_tarihi: string | null;
  created_at: string;
  updated_at: string;
};

export type GidenEvrakInsert = Omit<GidenEvrak, "id" | "created_at" | "updated_at" | "silen_id" | "silme_tarihi"> & {
  silen_id?: string | null;
  silme_tarihi?: string | null;
};

export type GidenEvrakWithRelations = GidenEvrak & {
  firmalar?: { firma_adi: string; kisa_adi: string | null; adres: string | null; antet_url: string | null; kase_url: string | null } | null;
  santiyeler?: { is_adi: string } | null;
  kullanicilar?: { ad_soyad: string } | null;
  silen_kullanici?: { ad_soyad: string } | null;
};

export type BankaYazisma = {
  id: string;
  evrak_tarihi: string;
  firma_id: string;
  evrak_sayi_no: string;
  konu: string;
  muhatap: string | null;
  muhatap_id: string | null;
  ilgi_listesi: string[];
  metin: string | null;
  ekler: string[];
  kase_dahil: boolean;
  pdf_url: string | null;
  olusturan_id: string;
  olusturma_tarihi: string;
  silindi: boolean;
  silme_nedeni: string | null;
  silen_id: string | null;
  silme_tarihi: string | null;
  created_at: string;
  updated_at: string;
};

export type BankaYazismaInsert = Omit<BankaYazisma, "id" | "created_at" | "updated_at" | "silen_id" | "silme_tarihi"> & {
  silen_id?: string | null;
  silme_tarihi?: string | null;
};

// Personel Puantaj - bir personelin bir günde hangi şantiyede ve hangi durumda olduğunu tutar
// UNIQUE(personel_id, tarih) -> Aynı gün aynı personel sadece 1 şantiyede olabilir
export type PersonelPuantajDurum =
  | "calisti"      // Çalıştı
  | "yarim_gun"    // Yarım Gün
  | "gelmedi"      // Gelmedi (açıklama zorunlu)
  | "izinli"       // İzinli
  | "raporlu"      // Raporlu
  | "dis_gorev"    // Dış Görev
  | "yagmur"       // Yağmur (hava muhalefeti)
  | "resmi_tatil"; // Resmi Tatil

export type PersonelPuantaj = {
  id: string;
  personel_id: string;
  santiye_id: string;
  tarih: string;
  durum: PersonelPuantajDurum;
  mesai_saat: number | null;
  aciklama: string | null;
  created_at: string;
  created_by: string | null;
  created_by_ad?: string | null;
};

export type PersonelPuantajInsert = {
  personel_id: string;
  santiye_id: string;
  tarih: string;
  durum: PersonelPuantajDurum;
  mesai_saat?: number | null;
  aciklama?: string | null;
  created_by?: string | null;
};

// Araç Puantaj - bir aracın bir günde hangi şantiyede ve hangi durumda olduğunu tutar
// UNIQUE(arac_id, tarih) -> Aynı gün aynı araç sadece 1 şantiyede olabilir
export type AracPuantajDurum =
  | "calisti"        // Çalıştı
  | "yarim_gun"      // Yarım gün
  | "calismadi"      // Çalışmadı (açıklama zorunlu)
  | "arizali"        // Arızalı (açıklama zorunlu)
  | "operator_yok"   // Operatör yok (açıklama zorunlu)
  | "tatil";         // Tatil

export type AracPuantaj = {
  id: string;
  arac_id: string;
  santiye_id: string;
  tarih: string;
  durum: AracPuantajDurum;
  aciklama: string | null;
  created_at: string;
  created_by: string | null;
  // Resolve edilen kullanıcı adı (opsiyonel - listeleme sorgularında doldurulur)
  created_by_ad?: string | null;
};

export type AracPuantajInsert = {
  arac_id: string;
  santiye_id: string;
  tarih: string;
  durum: AracPuantajDurum;
  aciklama?: string | null;
  created_by?: string | null;
};

// Araç Kira Bedeli Geçmişi
// Her güncelleme yeni bir satır olarak kaydedilir; en güncel satır (gecerli_tarih DESC)
// aktif tarife olarak kabul edilir. Geçmiş kayıtlar özet raporda "önceki ücret" olarak gösterilir.
export type AracKiraBedeli = {
  id: string;
  arac_id: string;
  aylik_bedel: number;
  gecerli_tarih: string; // YYYY-MM-DD
  created_at: string;
  created_by: string | null;
};

// Araç Aylık Puantaj Override
// Özet raporda kullanıcı çalıştı/çalışmadı vb. gün sayılarını elle değiştirebilir.
// Gerçek puantaj verisi (arac_puantaj tablosu) aynen kalır, sadece rapor üstünde
// bu değerler kullanılır.
export type AracPuantajOverride = {
  id: string;
  arac_id: string;
  santiye_id: string;
  yil: number;
  ay: number; // 1-12
  donem_baslangic: string; // YYYY-MM-DD — dönem bazlı override key
  // Override edilen gün sayıları (null ise gerçek puantaj kullanılır)
  calisti: number | null;
  yarim_gun: number | null;
  calismadi: number | null;
  arizali: number | null;
  operator_yok: number | null;
  tatil: number | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

// Yakıt Sayfası Tipleri

// Araç cinsi + sayaç tipi bazlı tüketim limitleri
// Anlık ortalama bu aralığın dışındaysa kırmızı uyarı gösterilir
export type AracCinsiYakitLimit = {
  id: string;
  arac_cinsi: string;
  sayac_tipi: "km" | "saat";
  alt_sinir: number;
  ust_sinir: number;
  created_at: string;
  updated_at: string;
};

// Araçlara verilen yakıt dağıtımı
export type AracYakit = {
  id: string;
  arac_id: string;
  santiye_id: string;
  tarih: string; // YYYY-MM-DD
  saat: string; // HH:MM:SS
  km_saat: number;
  miktar_lt: number;
  depo_full: boolean;
  notu: string | null;
  created_at: string;
  created_by: string | null;
};

// Depoya yakıt alımı (tedarikçiden)
export type YakitAlim = {
  id: string;
  santiye_id: string;
  tarih: string;
  saat: string;
  tedarikci_firma: string;
  miktar_lt: number;
  birim_fiyat: number;
  notu: string | null;
  created_at: string;
  created_by: string | null;
};

// Şantiyeler arası yakıt virmanı
export type YakitVirman = {
  id: string;
  gonderen_santiye_id: string;
  alan_santiye_id: string;
  tarih: string;
  saat: string;
  miktar_lt: number;
  notu: string | null;
  created_at: string;
  created_by: string | null;
};

export type BankaYazismaWithRelations = BankaYazisma & {
  firmalar?: { firma_adi: string; kisa_adi: string | null; adres: string | null; antet_url: string | null; kase_url: string | null } | null;
  kullanicilar?: { ad_soyad: string } | null;
  silen_kullanici?: { ad_soyad: string } | null;
};

// Kasa Defteri — personel harcama takibi
export type KasaHareketi = {
  id: string;
  personel_id: string;
  santiye_id: string;
  tarih: string;
  tip: "gelir" | "gider";
  odeme_yontemi: "nakit" | "kart";
  kategori: string | null;
  tutar: number;
  aciklama: string | null;
  slip_url: string | null;
  created_at: string;
  created_by: string | null;
};

// İhale ve sınır değer hesaplama tipleri
export type Ihale = {
  id: string;
  idare_adi: string | null;
  is_adi: string | null;
  ihale_kayit_no: string | null;
  ihale_tarihi: string | null;
  yaklasik_maliyet: number | null;
  is_grubu: string | null;
  n_katsayisi: number;
  sinir_deger: number | null;
  t1: number | null;
  t2: number | null;
  c_degeri: number | null;
  k_degeri: number | null;
  standart_sapma: number | null;
  muhtemel_kazanan: string | null;
  has_manual_edits: boolean;
  created_by: string | null;
  created_at: string;
};

export type IhaleInsert = Omit<Ihale, "id" | "created_at">;

export type IhaleKatilimci = {
  id: string;
  ihale_id: string;
  firma_adi: string;
  teklif_tutari: number;
  durum: "gecerli" | "gecersiz" | "sinir_alti";
  gecersizlik_nedeni: string | null;
  tenzilat: number | null;
  is_own_company: boolean;
  is_manual: boolean;
  sira: number | null;
  created_at: string;
};

export type IhaleKatilimciInsert = Omit<IhaleKatilimci, "id" | "created_at">;

// Şantiye defteri tipleri
export type SantiyeDefteri = {
  id: string;
  santiye_id: string;
  tarih: string;
  sayfa_no: number;
  hava_durumu: string | null;
  sicaklik: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SantiyeDefterKayit = {
  id: string;
  defter_id: string;
  yazan_id: string;
  icerik: string;
  sira: number;
  created_at: string;
  updated_at: string;
};

// Kullanıcı yönetimi ve yetkilendirme tipleri
export type IzinAksiyonu = "goruntule" | "ekle" | "duzenle" | "sil";

export type ModulIzinleri = {
  goruntule?: boolean;
  ekle?: boolean;
  duzenle?: boolean;
  sil?: boolean;
};

export type Izinler = Record<string, ModulIzinleri>;

export type Kullanici = {
  id: string;
  auth_id: string;
  ad_soyad: string;
  kullanici_adi: string;
  sifre_gorunur: string | null;
  rol: "yonetici" | "kisitli";
  aktif: boolean;
  izinler: Izinler;
  santiye_ids: string[];
  // Kısıtlı kullanıcı: geriye dönük kaç gün işlem yapabilir (puantaj, yakıt vb.)
  // null veya 0 = sadece bugün; 7 = bugün dahil 7 gün geriye
  geriye_donus_gun: number | null;
  created_at: string;
  updated_at: string;
};

export type KullaniciInsert = Omit<Kullanici, "id" | "created_at" | "updated_at">;
export type KullaniciUpdate = Partial<Omit<KullaniciInsert, "auth_id">>;

export type Database = {
  public: {
    Tables: {
      firmalar: {
        Row: Firma;
        Insert: FirmaInsert;
        Update: FirmaUpdate;
      };
      yi_ufe: {
        Row: YiUfe;
        Insert: YiUfeInsert;
        Update: Partial<YiUfeInsert>;
      };
      santiyeler: {
        Row: Santiye;
        Insert: SantiyeInsert;
        Update: SantiyeUpdate;
      };
      santiye_ortaklari: {
        Row: SantiyeOrtagi;
        Insert: Omit<SantiyeOrtagi, "id">;
        Update: Partial<Omit<SantiyeOrtagi, "id">>;
      };
      araclar: {
        Row: Arac;
        Insert: AracInsert;
        Update: AracUpdate;
      };
      personel: {
        Row: Personel;
        Insert: PersonelInsert;
        Update: PersonelUpdate;
      };
      kullanicilar: {
        Row: Kullanici;
        Insert: KullaniciInsert;
        Update: KullaniciUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
