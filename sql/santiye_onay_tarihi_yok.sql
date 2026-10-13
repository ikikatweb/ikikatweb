-- "Onay tarihi yok" tiki kalıcı alanda
--
-- Tik, "geçici kabul itibar tarihi dolu + onay tarihi boş" olmasından ÇIKARILIYORDU.
-- İkisi de boş olan kayıtlarda bu çıkarım çalışmıyor: "belgede tasdik tarihi yok" ile
-- "henüz girilmedi" ayırt edilemiyor.
--
-- Somut durum: 9 işte onay tarihine yer tutucu olarak 01.01.1990 yazılmıştı. Bu sahte
-- tarih silinince tik gelmiyordu, çünkü o işlerin itibar tarihi de yok — geçici kabul
-- tutanakları panele yüklenmemiş, iş deneyim belgelerinde de kabul tarihi satırı boş.
alter table public.santiyeler
  add column if not exists onay_tarihi_yok boolean not null default false;

comment on column public.santiyeler.onay_tarihi_yok is
  'Belgede tasdik/onay tarihi yok — kullanıcı bilerek boş bıraktı (çıkarım değil, kayıt)';
