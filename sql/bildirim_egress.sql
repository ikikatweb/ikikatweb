-- Bildirim rozetinin çıkış trafiğini (egress) düşürmek için.
--
-- SORUN: Sağ üstteki zil rozeti 30 saniyede bir okunmamış bildirimlerin TÜM SATIRLARINI
-- indirip JavaScript'te .length alıyordu. 2.000+ okunmamışı olan kullanıcıda bu her
-- yoklamada ~65 KB demek → kullanıcı başına günde ~60 MB, aylık 5 GB'lık kotayı tek
-- başına bitiriyordu.
--
-- ÇÖZÜM: sayım veritabanında yapılsın. İzin süzgeci (tag + şantiye) için satırlar değil,
-- GRUPLANMIŞ sayılar yeter — 2.141 satır yerine ~43 satır iner.
--
-- Supabase SQL Editor'de bir kez çalıştır.

-- 1) İndeks: "bu kullanıcının okunmamışları" sorgusu tablo taraması yapmasın.
--    56 bin satırlık tabloda her 30 saniyede bir çalışan sorgu bu.
create index if not exists bildirim_gecmisi_kullanici_okundu_idx
  on public.bildirim_gecmisi (kullanici_id, okundu);

-- Geçmiş listesi sorgusu (kullanıcı + tarih) için de:
create index if not exists bildirim_gecmisi_kullanici_tarih_idx
  on public.bildirim_gecmisi (kullanici_id, tarih);

-- 2) Okunmamışların (tag, santiye_id) kırılımlı sayısı.
--    API bu sonucu kendi izin süzgecinden geçirip toplar → sonuç birebir aynı, veri 30 kat küçük.
create or replace function public.bildirim_okunmamis_ozet(p_kullanici_id uuid)
returns table (tag text, santiye_id uuid, adet bigint)
language sql
stable
security definer
set search_path = public
as $$
  select b.tag, b.santiye_id, count(*)::bigint
  from public.bildirim_gecmisi b
  where b.kullanici_id = p_kullanici_id
    and b.okundu = false
  group by b.tag, b.santiye_id
$$;

-- Yalnız sunucu tarafı (service_role) çağırabilsin: API zaten servis anahtarıyla çalışıyor
-- ve p_kullanici_id'yi oturumdan kendisi belirliyor. Tarayıcıya açık bırakılırsa bir kullanıcı
-- başkasının id'siyle çağırabilirdi.
revoke all on function public.bildirim_okunmamis_ozet(uuid) from public;
revoke all on function public.bildirim_okunmamis_ozet(uuid) from anon;
revoke all on function public.bildirim_okunmamis_ozet(uuid) from authenticated;
grant execute on function public.bildirim_okunmamis_ozet(uuid) to service_role;

-- 3) Eski bildirimleri buda.
--    Bildirimler hiç silinmiyordu; en eskisi Nisan 2026'dan kalma. Tablo 56.632 satır,
--    bunun 33.698'i 60 günden eski. Rozet her geçen gün daha pahalı hâle geliyordu.
--    NOT: bu satır veri SİLER — önce kaç satır olduğunu görmek istersen:
--      select count(*) from public.bildirim_gecmisi where tarih < current_date - interval '60 days';
delete from public.bildirim_gecmisi
where tarih < current_date - interval '60 days';

-- Silmeden sonra tabloyu topla (yer iade edilsin).
vacuum analyze public.bildirim_gecmisi;
