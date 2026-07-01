-- Günlük Arvento metrik cache'i — dashboard widget "Sezon Özeti" için (sezon = günlerin TOPLAMI).
-- Değerler tarayıcıda hesaplanıp (widget bugün için, backfill geçmiş için) buraya yazılır; sezon = SUM.
create table if not exists arvento_gunluk_metrik (
  tarih          date primary key,
  reglaj_km      numeric  not null default 0,
  kamyon_sefer   integer  not null default 0,
  serme_km       numeric  not null default 0,
  sikistirma_km  numeric  not null default 0,
  makine_sn      integer  not null default 0,
  olusturma      timestamptz not null default now()
);
-- Yalnız sunucu (service role) erişir; RLS açık, policy yok → anon/authenticated göremez.
alter table arvento_gunluk_metrik enable row level security;
