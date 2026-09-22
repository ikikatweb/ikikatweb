-- TEKLİFİ KİM İSTEDİ
--
-- Teklif cevabı mailden geldiğinde bildirim, isteği gönderen kullanıcıya + yöneticilere
-- gidiyor. Ama teklif_gonderim tablosunda kimin istediği hiç tutulmuyordu; bilgi yalnız
-- gönderilen mailin kendisinde kalıyordu.
alter table teklif_gonderim add column if not exists isteyen_id uuid references kullanicilar(id);

comment on column teklif_gonderim.isteyen_id is
  'Teklifi isteyen kullanıcı — cevap geldiğinde bildirim ona gider';
