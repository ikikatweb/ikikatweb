-- Netsim iş listesinin AYNASI — şantiye formundaki "Netsim'deki karşılığını seç" önerisi için.
--
-- Neden gerekiyor: site Vercel'de çalışıyor, Netsim ise şirket ağındaki Firebird sunucusunda
-- (192.168.3.62). Tarayıcı oraya erişemez. Bu yüzden 15 dakikada bir dönen netsim-sync
-- (şirket ağındaki bilgisayarda çalışıyor) Netsim'in iş listesini buraya kopyalar; form da
-- öneriyi bu tablodan yapar. Tutarlar bilgi amaçlıdır — asıl hesap yine senkronla gelir.
--
-- Supabase SQL editöründe bir kez çalıştırın.

create table if not exists netsim_isler (
  nokta_no      integer primary key,        -- Netsim ISLMNOKT.ISLEM_NOKTASI_NO
  ad            text not null,              -- Netsim'deki iş adı (VARCHAR(40) — kırpılmış olabilir)
  kesif         numeric,                    -- tamamlanan keşif (hakediş toplamı)
  fark          numeric,                    -- alınan toplam fiyat farkı
  bagli         boolean not null default false, -- bir şantiyeye bağlanmış mı?
  guncellendi   timestamptz not null default now()
);

comment on table netsim_isler is
  'Netsim iş listesi aynası — scripts/netsim-sync.ts her turda tazeler. Şantiye formu buradan öneri yapar.';

-- Tarayıcı sadece OKUR. Yazan tek şey senkron script'i (service role, RLS dışında).
alter table netsim_isler enable row level security;

drop policy if exists "netsim_isler_authenticated_read" on public.netsim_isler;
create policy "netsim_isler_authenticated_read"
  on public.netsim_isler
  for select
  to authenticated
  using (true);

-- Öneri sorgusu bağlı olmayanları ada göre tarar
create index if not exists netsim_isler_bagli_idx on netsim_isler (bagli);
