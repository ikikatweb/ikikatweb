-- TANI SORGUSU — UETS anahtarının BİÇİMİ doğru mu? (anahtarın kendisi DÖNMEZ)
--
-- NEDEN: PTT 401 · "API anahtarı bulunamadı (kod 602)" diyor. İki ihtimal var:
--   (a) anahtar PTT'de henüz aktif değil  → bizde yapacak bir şey yok,
--   (b) anahtar kayda yanlış/eksik girildi → bizim hatamız, hemen düzelir.
-- (b)'yi elemek için anahtarı GÖRMEK gerekmiyor; uzunluğu, boşluk/satırsonu içerip
-- içermediği, karakter kümesi ve iki firmanın aynı anahtarı paylaşıp paylaşmadığı yeter.
-- Anahtar taahhütname md. 2 gereği paylaşılamaz; bu yüzden değeri değil, PARMAK İZİ döner.
select
  f.kisa_adi                                        as firma,
  u.aktif,
  length(u.api_key)                                 as anahtar_uzunluk,
  (u.api_key ~ '\s')                                as bosluk_var,
  (u.api_key <> btrim(u.api_key))                   as bas_son_bosluk,
  (u.api_key ~ '[\r\n]')                            as satirsonu_var,
  (u.api_key ~ '^[A-Za-z0-9._~+/=-]+$')             as jeton_karakterleri,
  (u.api_key ~ '["'']')                             as tirnak_var,
  left(md5(u.api_key), 8)                           as parmak_izi,
  u.uets_adres,
  u.sunucu_ip,
  u.son_cekim,
  u.son_hata,
  u.updated_at
from public.firma_uets u
join public.firmalar f on f.id = u.firma_id
order by f.kisa_adi;
