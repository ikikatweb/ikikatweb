-- Sezon uzunluk metrikleri önbelleği (dashboard "Sezon Özeti").
-- Reglaj/serme/sıkıştırma TOPLANAMAZ (aralık-birleşik omurgadan gelir) → gün-gün cache'ten türetilemez.
-- Bu ağır hesap tarayıcıda BİR KEZ yapılır, buraya yazılır; sonraki tüm açılışlar buradan ANINDA okur.
-- Yalnız API (service-role) erişir; imza + hesaplanma ile bayatlık kontrol edilir (SWR: bayatsa arka planda tazelenir).
create table if not exists public.arvento_sezon_uzunluk (
  bitis          date primary key,             -- genelde bugün; gün ilerledikçe güncellenir
  imza           text,                          -- hesaplandığı andaki ayar imzası (değişince cache "bayat")
  reglaj_km      numeric not null default 0,
  serme_km       numeric not null default 0,
  sikistirma_km  numeric not null default 0,
  bugun_serme_km numeric not null default 0,
  makine_sn      numeric not null default 0,
  hesaplanma     timestamptz not null default now()
);

-- Yalnız API service-role ile erişildiği için RLS açık + policy YOK (anon/authenticated doğrudan okuyamaz).
alter table public.arvento_sezon_uzunluk enable row level security;
