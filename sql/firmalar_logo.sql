-- FİRMA LOGOSU — kenar çubuğunda ve giriş ekranında dönen logo
--
-- Dönen logolar koda gömülüydü (components/shared/logo-donen.tsx içindeki üç dosya).
-- Yeni bir firma ya da ortaklık kurulduğunda logosu ancak kod değiştirilerek
-- eklenebiliyordu. Artık Firma düzenleme ekranındaki "Logo Yükle" ile yüklenen her
-- logo kendiliğinden dönüyor.
--
-- Antet bu iş için kullanılamaz: antet 1891x212 gibi UZUN bir şerit, kenar çubuğunun
-- kare kutusunda okunamayacak kadar küçülüyor. Logo ayrı ve kare-ye yakın bir görsel.

alter table firmalar add column if not exists logo_url text;

comment on column firmalar.logo_url is
  'Kenar çubuğunda/giriş ekranında dönen logo. Boşsa o firma dönmez. 700x300 tuval önerilir.';

-- Bugüne kadar koda gömülü olan üç logo, dosya yolu olarak işlenir: public/ altından
-- servis edildikleri için yeniden yüklenmeleri gerekmez, görünüm birebir aynı kalır.
update firmalar set logo_url = '/logolar/kad-tem.png'
  where kisa_adi = 'KAD' and logo_url is null;
update firmalar set logo_url = '/logolar/ikikat.png'
  where kisa_adi = 'IKI' and logo_url is null;
update firmalar set logo_url = '/logolar/kenan-tugay-ikikat.png'
  where kisa_adi = 'KTI' and logo_url is null;
