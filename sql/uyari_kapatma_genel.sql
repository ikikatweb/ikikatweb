-- GENEL UYARI KAPATMA — bir kişi kapatınca HERKESTE kapanan uyarılar.
--
-- kullanicilar.gizlenen_uyarilar (sql/kullanici_gizlenen_uyarilar.sql) KİŞİSELDİR:
-- orada kapatılan uyarı yalnız kapatan kullanıcıda kaybolur. İcra süre uyarıları
-- öyle olmamalı — dosyaya cevap veren kişi tektir ve işi bitirdiğinde uyarının
-- herkeste kalkması gerekir; yoksa her kullanıcı aynı uyarıyı ayrı ayrı kapatır ve
-- "bu dosyayla ilgilenildi mi" bilgisi kimsede toplanmaz.
--
-- KAPATMA KALICIDIR ve arayüzde geri alma yolu YOKTUR. Yanlışlıkla kapatılan bir
-- uyarıyı geri açmak için bu tablodan ilgili satır silinir:
--   delete from public.uyari_kapatma_genel where anahtar = '<tip>:<kayit-id>';
-- Kim kapattı bilgisi hem burada hem uyari_onaylari günlüğünde durur.
create table if not exists public.uyari_kapatma_genel (
  anahtar      text primary key,          -- "<uyari-tipi>:<kayit-id>"
  tip          text        not null,      -- anahtarın önü, ör. 'icra-sure-gecti'
  kapatan_id   uuid,
  kapatan_ad   text,                      -- anlık kopya: kullanıcı silinse de kim olduğu kalır
  kapatildi_at timestamptz not null default now()
);

comment on table public.uyari_kapatma_genel is
  'Bir kullanıcı kapatınca TÜM kullanıcılarda kapanan ana ekran uyarıları (kişisel olan: kullanicilar.gizlenen_uyarilar)';

create index if not exists uyari_kapatma_genel_tip_idx on public.uyari_kapatma_genel (tip, kapatildi_at desc);

-- Okumak serbest (herkes neyin kapalı olduğunu görmeli), YAZMAK DEĞİL: yalnız
-- /api/uyari-gizle servis anahtarıyla yazar. Böylece kapatan kişi kaydı güvenilir
-- kalır — kullanıcı başkası adına satır atamaz ya da kendi izini silemez.
alter table public.uyari_kapatma_genel enable row level security;
drop policy if exists "uyari_kapatma_genel_read" on public.uyari_kapatma_genel;
create policy "uyari_kapatma_genel_read"
  on public.uyari_kapatma_genel
  for select
  to authenticated
  using (true);
