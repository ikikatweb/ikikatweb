-- SERME'ye AYRI ince ayarlar — greyder reglajda ve sermede farklı davrandığı için serme haritası kendi
-- eşik/hız/grid/süresiyle sadeleşir (reglajdan bağımsız). Kolonlar NULLABLE: boşken getArventoAyarlar reglaj
-- değerine düşer → kullanıcı serme'yi ayrı ayarlayana kadar davranış AYNI kalır.
alter table public.arvento_ayarlar add column if not exists serme_guzergah_tekrar integer;      -- serme tekrar eşiği
alter table public.arvento_ayarlar add column if not exists serme_tekrar_pencere_saat numeric;  -- serme tekrar süresi (saat)
alter table public.arvento_ayarlar add column if not exists serme_grid_mesafe integer;          -- serme yan yana çizgi mesafesi (m)
alter table public.arvento_ayarlar add column if not exists serme_transit_hiz integer;          -- serme transit hız eşiği (km/s)
