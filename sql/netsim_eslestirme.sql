-- Netsim (Ofisnet / Firebird) entegrasyonu — şantiye eşleştirme alanı
--
-- Netsim'de her iş bir "İşlem Noktası"dır (ISLMNOKT.ISLEM_NOKTASI_NO).
-- Senkron script'i (scripts/netsim-sync.ts) bu numara üzerinden şantiyeyi bulur;
-- iş adına göre eşleştirme YAPILMAZ (Netsim adları 40 karaktere kırpıyor,
-- er geç yanlış şantiyeye rakam yazardı).
--
-- Supabase SQL editöründe bir kez çalıştırın.

ALTER TABLE santiyeler
  ADD COLUMN IF NOT EXISTS netsim_nokta_no INTEGER;

COMMENT ON COLUMN santiyeler.netsim_nokta_no IS
  'Netsim ISLMNOKT.ISLEM_NOKTASI_NO — netsim-sync bu numarayla hakediş tutarlarını çeker. Boşsa o şantiye senkronlanmaz.';

-- Aynı Netsim işi iki şantiyeye bağlanmasın (birden fazla NULL serbest).
CREATE UNIQUE INDEX IF NOT EXISTS santiyeler_netsim_nokta_no_key
  ON santiyeler (netsim_nokta_no)
  WHERE netsim_nokta_no IS NOT NULL;

-- Senkronun en son ne zaman/neyi yazdığı — "bu rakam nereden geldi?" sorusunun cevabı.
ALTER TABLE santiyeler
  ADD COLUMN IF NOT EXISTS netsim_son_senkron TIMESTAMPTZ;

COMMENT ON COLUMN santiyeler.netsim_son_senkron IS
  'netsim-sync bu şantiyeye en son ne zaman değer yazdı.';

-- ---------------------------------------------------------------------------
-- Netsim rozeti: senkronun yazdığı DEĞERİ de saklarız. Ekrandaki değer bununla
-- birebir aynıysa "Netsim" rozeti gösterilir; kullanıcı elle değiştirince
-- tutmaz ve rozet kendiliğinden kalkar. (netsim_son_senkron tek başına yetmez:
-- şantiyenin başka bir alanını düzenlemek de updated_at'i değiştiriyor.)
-- ---------------------------------------------------------------------------

ALTER TABLE santiyeler
  ADD COLUMN IF NOT EXISTS netsim_gerceklesen NUMERIC;

COMMENT ON COLUMN santiyeler.netsim_gerceklesen IS
  'netsim-sync bu şantiyeye en son yazdığı "tamamlanan keşif" değeri. sozlesme_fiyatlariyla_gerceklesen bununla aynıysa değer Netsim kaynaklıdır (rozet gösterilir).';

ALTER TABLE iscilik_takibi
  ADD COLUMN IF NOT EXISTS netsim_fiyat_farki NUMERIC;

COMMENT ON COLUMN iscilik_takibi.netsim_fiyat_farki IS
  'netsim-sync bu satıra en son yazdığı fiyat farkı. fiyat_farki bununla aynıysa değer Netsim kaynaklıdır (rozet gösterilir).';

-- ---------------------------------------------------------------------------
-- "Beklenen fark" işareti: geçici kabullü işlerde site ile Netsim arasındaki
-- tamamlanan keşif farkı incelenip sitedeki tutar doğru kabul edildiğinde
-- buraya KABUL ANINDAKİ NETSİM TUTARI yazılır. Karşılaştırma raporu bu işleri
-- "kontrol edildi" başlığına alır, her seferinde tekrar uyarmaz.
-- Netsim'deki tutar sonradan değişirse (yeni hakediş) kayıtlı değerle tutmaz
-- ve iş yeniden incelenecekler listesine düşer — kasıtlı.
-- ---------------------------------------------------------------------------
alter table santiyeler
  add column if not exists netsim_fark_kabul numeric;

comment on column santiyeler.netsim_fark_kabul is
  'Site-Netsim tamamlanan keşif farkı kontrol edildi, site doğru kabul edildi. Değer kabul anındaki Netsim tutarı; Netsim değişirse rapor yeniden uyarır.';
