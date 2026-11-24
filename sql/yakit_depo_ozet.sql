-- DEPO YAKIT STOĞU — ŞANTİYE BAŞINA TOPLAMLAR (ana ekran widget'ı)
--
-- NEDEN: Ana ekran depo stoğunu hesaplamak için yakıt hareketlerinin TAMAMINI indiriyordu:
-- arac_yakit, yakit_alim ve yakit_virman tabloları 1000'er satırlık SIRALI turlarla, tüm
-- zaman aralığı için. Ölçümde tek başına yedi istek ve birkaç bin satır ediyordu; telefonda
-- ana ekranın geç açılmasının en büyük sebeplerinden biriydi. Oysa ekranda görünen şey
-- şantiye başına dört sayı.
--
-- NE YAPAR: Şantiye başına alım, dağıtım, gelen ve giden virman toplamlarını döner.
-- Stok hesabı arayüzde aynı kalır: stok = alım + gelen virman − giden virman − dağıtım.
--
-- GÜVENLİK: security invoker (varsayılan) — satır güvenliği ÇAĞIRAN kullanıcıya göre
-- işler, yani bu fonksiyon kimseye göremeyeceği veriyi açmaz. Yetki süzgeci (kısıtlı
-- kullanıcının yalnız kendi şantiyeleri) arayüzde eskisi gibi uygulanır.

create or replace function public.yakit_depo_ozet()
returns table (
  santiye_id uuid,
  alim numeric,
  dagitim numeric,
  gelen_virman numeric,
  giden_virman numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with alimlar as (
    select ya.santiye_id as sid, sum(ya.miktar_lt) as toplam
    from yakit_alim ya
    where ya.santiye_id is not null
    group by ya.santiye_id
  ),
  dagitimlar as (
    select ay.santiye_id as sid, sum(ay.miktar_lt) as toplam
    from arac_yakit ay
    where ay.santiye_id is not null
    group by ay.santiye_id
  ),
  gelenler as (
    select yv.alan_santiye_id as sid, sum(yv.miktar_lt) as toplam
    from yakit_virman yv
    where yv.alan_santiye_id is not null
    group by yv.alan_santiye_id
  ),
  gidenler as (
    select yv.gonderen_santiye_id as sid, sum(yv.miktar_lt) as toplam
    from yakit_virman yv
    where yv.gonderen_santiye_id is not null
    group by yv.gonderen_santiye_id
  ),
  kimlikler as (
    select sid from alimlar
    union select sid from dagitimlar
    union select sid from gelenler
    union select sid from gidenler
  )
  select
    k.sid,
    coalesce(a.toplam, 0),
    coalesce(d.toplam, 0),
    coalesce(g.toplam, 0),
    coalesce(c.toplam, 0)
  from kimlikler k
  left join alimlar   a on a.sid = k.sid
  left join dagitimlar d on d.sid = k.sid
  left join gelenler  g on g.sid = k.sid
  left join gidenler  c on c.sid = k.sid;
$$;

grant execute on function public.yakit_depo_ozet() to authenticated;
