-- Personel öğrenim durumu — personel ve taşeron personel eklerken ZORUNLU alan.
-- Eski kayıtlarda NULL kalır (düzenlemede doldurulması istenir).
alter table public.personel add column if not exists ogrenim_durumu text;

-- Bordro mail kuyruğu: giriş/çıkış/transfer maillerinde öğrenim durumu da iletilir.
alter table public.bordro_pending_mail add column if not exists personel_ogrenim text;
