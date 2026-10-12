-- YETKİ KAYNAĞI (kullanıcı çoğaltma)
--
-- Aynı yetkilerle birden çok kullanıcı açılıyor (aynı görevdeki kişiler). Her birini tek
-- tek ayarlamak hem zaman alıyor hem de biri unutulunca yetkiler sessizce ayrışıyor:
-- "aynı işi yapan iki kişiden biri ekranı göremiyor" şikâyeti buradan çıkıyor.
--
-- Bu alan doluysa kullanıcı, kaynak kullanıcının yetkilerini İZLER: kaynakta yapılan her
-- yetki değişikliği otomatik olarak buraya da yazılır. Ad, kullanıcı adı ve şifre kendine
-- aittir, onlar kopyalanmaz.
--
-- on delete set null: kaynak kullanıcı silinirse izleyen kullanıcı yetkilerini KORUR,
-- sadece bağ kopar (o andaki yetkileriyle bağımsız kalır).
alter table kullanicilar add column if not exists yetki_kaynak_id uuid
  references kullanicilar(id) on delete set null;

comment on column kullanicilar.yetki_kaynak_id is
  'Yetkileri izlenen kullanıcı — kaynakta değişiklik olunca buraya da yansır';
