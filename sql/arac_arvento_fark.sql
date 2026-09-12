-- Araç gösterge (km / motor saati) otomatik güncelleme — Arvento offset'i.
--
-- Arvento'nun verdiği dOdometer, CİHAZIN kendi saydığı değerdir; aracın gösterge
-- sayacı değil. Cihaz sonradan takılmışsa sıfırdan başlar (ör. 60 ACE 788: gösterge
-- 452.146 km, Arvento 46.704). Bu yüzden araç başına bir FARK tutulur:
--
--     gerçek gösterge = Arvento değeri + arvento_fark
--
-- Fark bir kez kalibre edilir (araçlar stop hâldeyken gerçek gösterge okunur),
-- sonrasında senkron her turda hesaplayıp guncel_gosterge'ye yazar.
--
-- Supabase SQL editöründe bir kez çalıştırın.

alter table araclar add column if not exists arvento_fark          numeric;
alter table araclar add column if not exists arvento_fark_tarihi   timestamptz;
alter table araclar add column if not exists arvento_gosterge      numeric;

comment on column araclar.arvento_fark is
  'Gerçek gösterge ile Arvento cihaz sayacı arasındaki sabit fark. gerçek = arvento + fark. NULL ise bu araç otomatik güncellenmez.';
comment on column araclar.arvento_fark_tarihi is
  'Farkın en son ne zaman kalibre edildiği. Cihaz değişirse/sıfırlanırsa yeniden kalibrasyon gerekir.';
comment on column araclar.arvento_gosterge is
  'Senkronun en son yazdığı gösterge değeri. guncel_gosterge bununla aynıysa değer Arvento kaynaklıdır (rozet); elle değiştirilince tutmaz.';
