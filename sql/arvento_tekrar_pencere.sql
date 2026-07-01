-- Güzergah tekrar SÜRESİ ayarı (SAAT): eşik kadar geçiş bu süre içinde olursa yol çizilir.
-- Ondalık olabilir (1.5 = 90 dk). 0 (varsayılan) = süre şartı kapalı (sadece toplam geçiş sayısına bakar).
alter table arvento_ayarlar add column if not exists tekrar_pencere_saat numeric not null default 0;
-- Eski dakika kolonu varsa (önceki sürüm) artık kullanılmıyor; kaldırılabilir:
alter table arvento_ayarlar drop column if exists tekrar_pencere_dk;
