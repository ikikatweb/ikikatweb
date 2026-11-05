-- ANTETİN RENKLİ SÜRÜMÜ (mail için)
--
-- Yazışma evrakları (giden/gelen evrak, banka yazışması) anteti SİYAH-BEYAZ basıyor;
-- mail ise RENKLİ gitsin isteniyor. Tek dosya tutulup ekranda CSS filtresiyle
-- grileştirmek yetmiyordu: iOS yazdırması html2canvas ile PDF üretiyor ve html2canvas
-- CSS `filter` desteklemiyor — iPhone'dan basılan evrak renkli çıkardı.
--
-- Çözüm iki dosya:
--   antet_url        → GRİ sürüm. Yazışmalarda kullanılan, bugüne kadarki alan. Değişmedi.
--   antet_renkli_url → kullanıcının yüklediği RENKLİ aslı. YALNIZ mailde kullanılır.
--
-- Firma düzenleme ekranında antet yüklenince renkli asıl buraya, tarayıcıda üretilen
-- gri kopya antet_url'e yazılır. Eski kayıtlarda bu alan NULL'dır; mail o zaman
-- antet_url'e düşer, yani davranış eskisi gibi kalır.

alter table firmalar add column if not exists antet_renkli_url text;

comment on column firmalar.antet_renkli_url is
  'Antetin renkli aslı — yalnız mail başlığında kullanılır. Yazışma çıktıları antet_url (gri) kullanır.';
