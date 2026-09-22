-- FİRMA YETKİLİLERİ
--
-- Firma sahibi/yetkilisi sigortalanamadığı için personel kaydı olmayabilir, ama sözleşmedeki
-- teknik personel rolünü doldurabiliyor. Şimdiye kadar böyle bir liste yoktu; teknik rol
-- ataması yapılırken tüm personel listesinden seçmek gerekiyordu.
--
-- Biçim: [{"ad":"Kenan Tugay İKİKAT","gorev":"Ziraat Mühendisi"}]
-- gorev boş bırakılabilir.
alter table firmalar add column if not exists yetkililer jsonb not null default '[]'::jsonb;

comment on column firmalar.yetkililer is
  'Firma yetkilileri: [{"ad":"Kenan Tugay İKİKAT","gorev":"Ziraat Mühendisi"}]';
