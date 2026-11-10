-- KONUM İZNİ REDDİ DE KAYDA GEÇSİN — "kim reddetti" sorusu cevapsız kalmasın
--
-- NİYE: kullanıcı listesinde konum sütunu üç şeyi ayırt edebilmeli:
--   yeşil   → aydınlatmayı onayladı, konum izni açık
--   kırmızı → ekrana girdi, "Konumu aç"a bastı, tarayıcı/telefon REDDETTİ
--   gri     → hiç bakmamış (kayıt yok)
-- Bugüne kadar yalnız BAŞARILI onay yazılıyordu; reddeden kişi hiç gelmemiş
-- gibi görünüyordu. Oysa ayırt edilmesi gereken iki ayrı durum: biri yardım
-- istiyor (telefon ayarı kapalı), diğeri henüz hiç denememiş.
--
-- NİYE AYRI TABLO DEĞİL: satır zaten "bu kişinin bu metin sürümündeki durumu".
-- Reddeden kişide metin NULL kalır (onay vermedi), ret bilgisi dolu olur.
-- Sonra izni verip onaylarsa AYNI satır tazelenir: metin dolar, konum_izni
-- true olur; ret_at geçmiş kaydı olarak durur ("önce reddetmişti, sonra açtı").
--
-- ONAY SAYILMAZ: panelin onay kontrolü konum_izni = true VE metin dolu arar
-- (components/shared/konum-onay-dialog.tsx → konumOnayiVarMi). Ret satırı bu
-- koşulu geçmez; kullanıcıya onay ekranı yine çıkar.
alter table public.konum_onaylari add column if not exists ret_at     timestamptz;
alter table public.konum_onaylari add column if not exists ret_sebep  text;
alter table public.konum_onaylari add column if not exists ret_kaynak text;

comment on column public.konum_onaylari.ret_at is
  'Konum izni en son NE ZAMAN reddedildi. Doluysa kişi ekrana girip denemiş demektir.';
comment on column public.konum_onaylari.ret_sebep is
  'Tarayıcının söylediği sebep (kullanıcıya gösterilen metnin aynısı).';
comment on column public.konum_onaylari.ret_kaynak is
  'site = site izni kapalı · cihaz = telefonun konum servisi kapalı · bilinmiyor. '
  'Hangisi olduğu bilinmeden kişiye doğru yol tarif edilemiyor.';

-- METİN ARTIK ZORUNLU DEĞİL: ret satırında onaylanmış bir metin yok.
-- (Sütun zaten nullable eklenmişti; burada niyet yazılı kalsın diye not.)
