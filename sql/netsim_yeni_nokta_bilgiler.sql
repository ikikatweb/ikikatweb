-- NETSİM'DEKİ İŞE AİT EK BİLGİLER
--
-- Ana ekrandaki "Netsim'de yeni iş açılmış" uyarısı yalnız işin ADINI gösteriyordu;
-- ad da Netsim'de BÜYÜK HARF ve 40 karaktere kırpık olduğu için hangi iş olduğu çoğu
-- zaman anlaşılmıyordu. ISLMNOKT tablosunda aynı işe ait sözleşme bedeli, ihale tarihi,
-- İKN, ortaklık oranı gibi alanlar da duruyor — uyarıda bunlar da görünsün.
--
-- Hangi alanların alındığı ölçülerek seçildi (106 gerçek iş noktası üzerinde):
--   sözleşme bedeli 93, iş kodu 106, özel kod 105, İKN 39, ihale tarihi 38,
--   ortaklık oranı 40, pilot firma 40, sözleşme tarihi 29, işyeri teslim 25,
--   iş grubu 25, asgari işçilik 26, yaklaşık maliyet 10, ek sözleşme 4.
-- Alınmayanlar 106 noktanın hepsinde boştu: K_EKAP_BELGE_NO, K_BELGE_TUTARI, DIGER_BILGI.
alter table public.netsim_yeni_nokta
  add column if not exists kod                   text,
  add column if not exists sorumlu               text,
  add column if not exists is_grubu              text,
  add column if not exists sozlesme_bedeli       numeric,
  add column if not exists ek_sozlesme_bedeli    numeric,
  add column if not exists yaklasik_maliyet      numeric,
  add column if not exists ihale_tarihi          date,
  add column if not exists ilan_tarihi           date,
  add column if not exists ihale_kayit_no        text,
  add column if not exists sozlesme_tarihi       date,
  add column if not exists isyeri_teslim_tarihi  date,
  add column if not exists ortaklik_orani        numeric,
  add column if not exists pilot_firma           text,
  add column if not exists asgari_iscilik_orani  numeric;

comment on column public.netsim_yeni_nokta.sorumlu is
  'ISLMNOKT.OZEL_KOD — işten sorumlu kişi (Netsim bu alanı isim olarak kullanıyor)';
