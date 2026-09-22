-- TEKNİK ROLÜ ATAMA DIŞI KİŞİ DOLDURUYORSA
--
-- Firma sahibini sigortalayamıyoruz, yani şantiyeye personel ataması açamıyoruz; ama
-- sözleşmedeki teknik personel rolünü o dolduruyor. Şimdiye kadar bunu gösterecek bir yer
-- yoktu: rol boş görünüyor ve "Atanmamış Teknik" uyarısı hiç kalkmıyordu.
--
-- Bu alan "hangi rol, kim tarafından dolduruluyor" bilgisini şantiyede tutar:
--   {"Harita Mühendisi 3 Yıl Deneyimli": "Kenan Tugay İKİKAT"}
--
-- Atama OLUŞTURMAZ: puantaj, bordro, gün hesabı ve SGK bildirge akışlarına hiç dokunmaz.
-- Yalnız teknik personel rolünün dolu sayılmasını sağlar.
alter table santiyeler add column if not exists teknik_dis_atama jsonb not null default '{}'::jsonb;

comment on column santiyeler.teknik_dis_atama is
  'Atama dışı (firma sahibi vb.) doldurulan teknik personel rolleri: {"rol adı": "ad soyad"}';
