-- Personel kaydını KİM açtı / KİM güncelledi.
--
-- Bugüne kadar personel tablosunda yalnız created_at / updated_at vardı; "bu kaydı kim
-- açmış?" sorusu veritabanından cevaplanamıyordu (11.09.2026'da Fatih SOYLU kaydında
-- soruldu, cevaplanamadı). Diğer tablolardaki kalıbın aynısı: kullanıcı id'si + o anki
-- ad_soyad birlikte tutulur — kullanıcı sonradan silinse/adı değişse bile kayıt okunur kalır.
--
-- GEÇMİŞE DÖNÜK DOLDURULAMAZ: mevcut kayıtlarda bu alanlar boş kalır, o bilgi hiç tutulmamıştı.
--
-- Supabase SQL editöründe bir kez çalıştırın.

alter table personel add column if not exists created_by     uuid;
alter table personel add column if not exists created_by_ad  text;
alter table personel add column if not exists updated_by     uuid;
alter table personel add column if not exists updated_by_ad  text;

comment on column personel.created_by_ad is
  'Kaydı açan kullanıcının o andaki ad_soyad''ı. created_by ile birlikte tutulur ki kullanıcı silinse de iz kalsın.';
comment on column personel.updated_by_ad is
  'Kaydı en son güncelleyen kullanıcının ad_soyad''ı.';
