-- Damper API senkronu çalışma saati penceresi (Arvento Tanımlamalar → "Damper Senkron Saatleri").
-- Görev her saat başı tetiklenir; script bu aralık DIŞINDAysa hiç çalışmaz (gece boşuna çalışmasın).
alter table public.arvento_ayarlar add column if not exists damper_sync_bas_saat integer not null default 6;
alter table public.arvento_ayarlar add column if not exists damper_sync_bit_saat integer not null default 21;
-- Senkron PERİYODU (dakika): görev 5 dk'da bir tetiklenir; script son çekimden bu kadar dk geçmeden tekrar çekmez.
alter table public.arvento_ayarlar add column if not exists damper_sync_periyot_dk integer not null default 60;
-- Son BAŞARILI çekim zamanı (script yazar; periyot bir sonraki çalışmayı bundan sayar).
alter table public.arvento_ayarlar add column if not exists damper_sync_son_calisma timestamptz;
