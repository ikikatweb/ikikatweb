-- TANI: çekimden sonra deftere ne girdi, rozet kaç gösterir?
select
  (select count(*) from public.tebligat)                                   as toplam,
  (select count(*) from public.tebligat where durum = 'delivered')         as acilmamis,
  (select count(*) from public.tebligat where durum = 'readtimeout')       as suresi_dolmus,
  (select count(*) from public.tebligat where durum = 'read')              as acilmis,
  (select string_agg(distinct durum, ', ') from public.tebligat)           as gorulen_durumlar;
