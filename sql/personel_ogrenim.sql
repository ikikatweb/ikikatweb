-- Personel öğrenim durumu — personel ve taşeron personel eklerken ZORUNLU alan.
-- Eski kayıtlarda NULL kalır (düzenlemede doldurulması istenir).
alter table public.personel add column if not exists ogrenim_durumu text;
