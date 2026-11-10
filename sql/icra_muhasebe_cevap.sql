-- MUHASEBEDEN GELEN CEVAP MAİLİNİN İZİ
--
-- NİYE: icra yazısı muhasebeye gidiyor ama cevabın geldiğini panel bilmiyordu;
-- "cevap geldi mi" sorusu mail kutusunda aranıyordu. Posta kutusu zaten taranıyor
-- (bildirge cevapları için, lib/personel/bildirge-fetch) — aynı yoldan muhasebenin
-- icra cevabı da yakalanıyor ve dosyanın yanında "cevap geldi" işareti yanıyor.
--
-- İKİ AYRI ŞEY, İKİ AYRI SÜTUN:
--   muhasebe_cevap_mail_at → POSTA KUTUSUNDA cevap maili görüldü (makine buldu)
--   muhasebe_cevap_at      → cevabın İÇERİĞİ panele girildi (insan okudu, girdi)
-- Birincisi "haber var" demek; borç durumu ve cevap şekli ancak ikincisiyle
-- belli olur. Makinenin bulduğu maili "cevap işlendi" saymak, okunmamış bir
-- maile göre dosya kapatmak olurdu.
--
-- EŞLEŞTİRME: gönderen muhasebe adreslerinden biri + mail tarihi gönderimden
-- sonra + konuda dosya esas no geçiyor. Numara başka bir mailde de geçebilir,
-- o yüzden üç şart birden aranıyor ve karar yine insana bırakılıyor.

alter table public.icra add column if not exists muhasebe_cevap_mail_at timestamptz;
alter table public.icra add column if not exists muhasebe_cevap_mail_gonderen text;
alter table public.icra add column if not exists muhasebe_cevap_mail_konu text;
alter table public.icra add column if not exists muhasebe_cevap_mail_ek text;

alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_mail_at timestamptz;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_mail_gonderen text;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_mail_konu text;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_mail_ek text;

comment on column public.icra.muhasebe_cevap_mail_at is
  'Muhasebenin cevap maili POSTA KUTUSUNDA görüldüğü an — içeriği işlenmiş demek değil';
comment on column public.icra.muhasebe_cevap_mail_ek is
  'Cevap mailindeki ek dosya adları (altlık) — virgülle';
comment on column public.icra_sirket_takip.muhasebe_cevap_mail_at is
  'Muhasebenin cevap maili POSTA KUTUSUNDA görüldüğü an — içeriği işlenmiş demek değil';
