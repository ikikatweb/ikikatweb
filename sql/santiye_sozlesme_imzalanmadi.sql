-- "Henüz Sözleşme imzalanmadı" — kullanıcı formda bilerek işaretlediğinde true olur.
-- Ana sayfa "sözleşme tarihini girin" hatırlatması SADECE bu alanı true olan (ve tarihi hâlâ boş, 7g+ eski)
-- işlerde çıkar. Böylece eski/ihalesiz (tarihi zaten boş) işler yanlışlıkla uyarıya düşmez.
alter table santiyeler add column if not exists sozlesme_imzalanmadi boolean default false;
