-- ŞİFREMİ UNUTTUM — e-posta ile şifre yenileme altyapısı
--
-- Neden kendi akışımız: hesaplar Supabase Auth'ta UYDURMA adreslerle açılmış
-- ("<kullaniciadi>@gmail.com") ve giriş ekranı şifreyi bu türetilmiş adresle deniyor.
-- Supabase'in hazır sıfırlama maili o adrese gider — yani yabancı birinin gerçek Gmail
-- kutusuna. Auth e-postasını gerçek adrese çevirmek ise girişi kırar. Bu yüzden gerçek
-- adres BİZİM tablomuzda tutulur, link kendi SMTP'mizden gider, Auth kimliği değişmez.

-- 1) Kullanıcının gerçek e-posta adresi
alter table kullanicilar
  add column if not exists eposta text,
  add column if not exists eposta_dogrulandi boolean not null default false;

comment on column kullanicilar.eposta is
  'Şifre yenileme bağlantısının gideceği GERÇEK adres. Auth kimliği DEĞİLDİR (giriş kullanıcı adıyla).';
comment on column kullanicilar.eposta_dogrulandi is
  'Adres doğrulama bağlantısıyla teyit edildi mi? Yönetici girdiğinde false başlar.';

-- 2) Tek kullanımlık bağlantı jetonları
--
-- Jetonun KENDİSİ saklanmaz, yalnız SHA-256 özeti: veritabanı sızsa bile o özetten
-- çalışan bir bağlantı üretilemez. Her jeton tek kullanımlık ve süreli.
create table if not exists kullanici_token (
  id uuid primary key default gen_random_uuid(),
  kullanici_id uuid not null references kullanicilar(id) on delete cascade,
  tip text not null check (tip in ('sifre_sifirlama', 'eposta_dogrulama')),
  token_ozet text not null,
  -- Jetonun üretildiği andaki hedef adres: kullanıcı adresini sonradan değiştirse de
  -- bağlantı ESKİ adrese aitti; yeni adrese erişen biri eski bağlantıyı kullanamasın.
  eposta text not null,
  son_kullanma timestamptz not null,
  kullanildi_mi boolean not null default false,
  olusturma timestamptz not null default now()
);

create index if not exists kullanici_token_ozet_idx on kullanici_token (token_ozet);
create index if not exists kullanici_token_kullanici_idx on kullanici_token (kullanici_id, tip, olusturma desc);

-- RLS AÇIK, POLICY YOK → anon ve authenticated hiçbir satırı göremez.
-- Tabloya yalnız sunucudaki service-role erişir (API rotaları).
alter table kullanici_token enable row level security;

-- Doğrulama
select column_name from information_schema.columns
 where table_name = 'kullanicilar' and column_name in ('eposta', 'eposta_dogrulandi');
select count(*) as token_tablosu_hazir from kullanici_token;
