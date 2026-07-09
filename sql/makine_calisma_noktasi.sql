-- Ekskavatör (paletli iş makinesi) ÇALIŞMA NOKTALARI — yerinde çalışan makineler iz bırakmadığı için,
-- kontak açıkken belirli aralıklarla (Tanımlamalar → "Ekskavatör Nokta Sıklığı") konumu buraya kaydedilir.
-- Güzergah/mesafe hesabından AYRI tutulur (toplam yolu şişirmesin). İş Makineleri haritasında nokta olarak çizilir.
create table if not exists public.makine_calisma_noktasi (
  id           bigint generated always as identity primary key,
  plaka        text not null,
  rapor_tarihi date not null,
  saat         text,                 -- "HH:MM:SS"
  lat          double precision not null,
  lng          double precision not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_makine_nokta_tarih_plaka on public.makine_calisma_noktasi (rapor_tarihi, plaka);

-- Tarayıcı (authenticated) OKUR; yazma yalnız senkron (service-role, RLS baypas) tarafından yapılır.
alter table public.makine_calisma_noktasi enable row level security;
drop policy if exists "makine_nokta_read" on public.makine_calisma_noktasi;
create policy "makine_nokta_read" on public.makine_calisma_noktasi for select to authenticated using (true);

-- Ekskavatör çalışma noktası kayıt sıklığı (dakika) — kontak açıkken bu aralıkta bir konum yazılır.
alter table public.arvento_ayarlar add column if not exists ekskavator_nokta_dk integer not null default 10;
-- Ekskavatör çalışma SAATLERİ — nokta kaydı yalnız bu saatler arası yapılır (gece/çalışılmayan saatlerde boşuna sorgu yok).
alter table public.arvento_ayarlar add column if not exists ekskavator_bas_saat integer not null default 7;
alter table public.arvento_ayarlar add column if not exists ekskavator_bit_saat integer not null default 19;
