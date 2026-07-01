-- Günlük metrik cache'ine ayar parmak izi (imza) — Tanımlamalar'da metriği etkileyen bir ayar (güzergah eşiği,
-- yan yana mesafe, tekrar süresi, silindir eşiği, transit hız, mükerrer, ocak yarıçapı) değişince cache'lenmiş
-- günler "eski imzalı" kalır; dashboard onları yeniden hesaplatır. Eski satırlar null imza → güncel değil sayılır.
alter table arvento_gunluk_metrik add column if not exists imza text;
