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
