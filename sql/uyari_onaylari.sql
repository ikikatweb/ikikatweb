-- UYARI ONAY GÜNLÜĞÜ — ana ekrandaki uyarıyı kim, ne zaman "Anladım" ile kapattı?
--
-- kullanicilar.gizlenen_uyarilar (sql/kullanici_gizlenen_uyarilar.sql) yalnız KİMİN kapattığını
-- tutar, NE ZAMAN kapattığını tutmaz; üstelik geri alınırsa iz kalmaz. Çalışılmayan dönem
-- uyarısında "hangi şantiye yöneticisi dönemin başladığını görüp onayladı" bilgisinin kalıcı
-- olması istendi (ileride sorulabilir) → her tuşa basış buraya AYRI SATIR olarak yazılır.
--
-- Uyarı tipinden bağımsızdır: anahtar "<uyari-tipi>:<kayit-id>" biçiminde geldiği için
-- bundan sonra eklenecek uyarılar da kendiliğinden günlüğe girer.
create table if not exists public.uyari_onaylari (
  id           bigserial primary key,
  tip          text        not null,   -- anahtarın önü, ör. 'calisilmayan-donem'
  anahtar      text        not null,   -- tam anahtar, ör. 'calisilmayan-donem:<santiyeId>-2026-11-25'
  kullanici_id uuid,
  kullanici_ad text,                   -- anlık kopya: kullanıcı sonradan silinse de kim olduğu kalır
  geri_alindi  boolean     not null default false,  -- true → uyarı yeniden açıldı
  onay_at      timestamptz not null default now()
);

comment on table public.uyari_onaylari is
  'Ana ekran uyarılarında "Anladım/Anlaşıldı" basışlarının günlüğü — kim, hangi uyarıyı, ne zaman kapattı';

create index if not exists uyari_onaylari_anahtar_idx on public.uyari_onaylari (anahtar, onay_at desc);
create index if not exists uyari_onaylari_kullanici_idx on public.uyari_onaylari (kullanici_id, onay_at desc);
create index if not exists uyari_onaylari_tip_idx on public.uyari_onaylari (tip, onay_at desc);

-- Okumak serbest (ileride "kim onaylamış" ekranı yapılabilir), YAZMAK DEĞİL:
-- günlüğe yalnız /api/uyari-gizle servis anahtarıyla yazar. Böylece kullanıcı kendi
-- izini silemez ya da başkası adına satır atamaz.
alter table public.uyari_onaylari enable row level security;
drop policy if exists "uyari_onaylari_read" on public.uyari_onaylari;
create policy "uyari_onaylari_read"
  on public.uyari_onaylari
  for select
  to authenticated
  using (true);
