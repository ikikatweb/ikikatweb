-- BORDRO TAKİBİ'NDE GİZLEME
--
-- Bordro Takibi listesinde takip edilmesi gerekmeyen işler (ihalesiz özmal işler,
-- merkez kayıtları vb.) karta sağ tıklanıp "Gizle" ile listeden kaldırılabilsin.
-- Gizleme HERKES İÇİN geçerlidir: iş kullanıcıya özel değil, şirkete ait bir karardır.
-- Liste altındaki "Gizli işleri göster" düğmesi hepsini geri getirir (kayıt silinmez).
--
-- Kolon yoksa ekranlar yine çalışır (getSantiyelerAll kolonu varsa alır, yoksa geri
-- düşer) — bu betik çalıştırılana kadar gizleme düğmesi etkisiz kalır.

alter table public.santiyeler
  add column if not exists bordro_gizli boolean not null default false;

comment on column public.santiyeler.bordro_gizli is
  'true → iş Bordro Takibi listesinde gizlenir ("Gizli işleri göster" ile görünür). Kullanıcıya özel değil, geneldir.';

-- Gizli iş sayısı az olacağı için kısmi indeks yeter.
create index if not exists santiyeler_bordro_gizli_idx
  on public.santiyeler (bordro_gizli) where bordro_gizli;
