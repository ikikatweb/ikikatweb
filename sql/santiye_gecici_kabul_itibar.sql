-- Geçici Kabul İTİBAR tarihi — kabulün geçerli sayıldığı tarih.
-- Mevcut "gecici_kabul_tarihi" artık ONAY tarihi olarak kullanılıyor (form etiketi "Geçici Kabul Onay Tarihi").
-- İtibar tarihi form'da onay tarihinin ÜSTÜNDE ayrı bir alan; herhangi bir kilit/durum mantığını tetiklemez (sadece kayıt).
alter table santiyeler add column if not exists gecici_kabul_itibar_tarihi date;
