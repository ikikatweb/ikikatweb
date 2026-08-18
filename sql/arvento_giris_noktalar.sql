-- Ocak girişi KAPI ÇİZGİSİ — çok noktalı (köşelendirilebilir) hale getirme.
-- Önce: çizgi iki noktaydı (lat,lng) – (lat2,lng2), yalnız düz bir doğru çizilebiliyordu.
-- Sonra: noktalar = [{"lat":..,"lng":..}, ...] (en az 2). Haritada her köşede tutamak, her segmentin
-- ortasında "+" işareti var; "+" sürüklenince oraya yeni köşe eklenir, köşeye çift tıklayınca silinir.
--
-- lat/lng ve lat2/lng2 kolonları KALDIRILMADI: ilk ve son noktayla senkron tutulur, böylece eski
-- kayıtlar ve bu kolonları okuyan kod yolları çalışmaya devam eder.
-- (Uygulandı: 18.08.2026 — 19 eski kayıt iki noktalı diziye çevrildi.)

alter table public.arvento_giris add column if not exists noktalar jsonb;

-- Eski kayıtları A–B'den noktalar dizisine çevir (yalnızca boş olanlar).
update public.arvento_giris
set noktalar = jsonb_build_array(
      jsonb_build_object('lat', lat,  'lng', lng),
      jsonb_build_object('lat', lat2, 'lng', lng2)
    )
where noktalar is null
  and lat is not null and lng is not null
  and lat2 is not null and lng2 is not null;
