-- İŞ MAKİNESİ ÇALIŞMA SAATİ MODELİ
--
-- Neden: Arvento iş makineleri için SAAT vermiyor, `dodometer` alanında KİLOMETRE veriyor.
-- Ölçüldü (15.10.2026): 34-00-15-13879 için cihazın tüm ömründeki dodometer toplamı 123,6
-- iken yalnız son 24 günün günlük raporlarında 143,5 saat kontak var — saat olsaydı imkânsız.
-- Bu yüzden makinelerde tutulan "arvento_fark" bir kalibrasyon sabiti değil, saat sayacından
-- alakasız bir km sayacının çıkarılmış hâliydi; makine çalıştıkça bayatlıyordu
-- (23 günde 34-00-15-13879'da +129 sa, 60-00-10-0011'de +101 sa "sapma").
--
-- Yeni model:  gösterge = son elle okuma + (o tarihten beri kontak saati) × katsayı
-- Katsayı makineye özel: kontak, makinenin kendi sayacından fazla sayıyor (ölçülen:
-- 34-00-15-13879 → 0,90; 60-00-10-0011 → 0,77). Her yeni okumada yeniden hesaplanır,
-- yani model kendi kendini düzeltir.
--
-- Kamyonlarda (sayac_tipi='km') mevcut km modeli sorunsuz — 23 günde sapma 12–50 km.
-- Bu dosya onlara DOKUNMAZ.

alter table araclar add column if not exists son_okuma_deger   numeric;
alter table araclar add column if not exists son_okuma_tarihi  timestamptz;
alter table araclar add column if not exists saat_katsayi      numeric;

comment on column araclar.son_okuma_deger  is 'Sayaçtan elle okunan son değer (km ya da saat). Projeksiyonun başlangıç noktası.';
comment on column araclar.son_okuma_tarihi is 'son_okuma_deger''in okunduğu an. Kontak saati bu andan itibaren toplanır.';
comment on column araclar.saat_katsayi     is 'İş makinesi: makine sayacı / Arvento kontak oranı. Boşsa 1 kabul edilir.';

-- Projeksiyon her gece cron ile guncel_gosterge'ye yazılır; o alan zaten denetim kaydının
-- (kayit_gecmisi) yok sayılanlar listesinde, günlük yazım log'u şişirmez.
