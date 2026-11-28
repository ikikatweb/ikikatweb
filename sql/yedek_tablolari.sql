-- Yedek kapsami ELLE TUTULMUYOR: veritabaninda ne varsa yedege girer.
-- Donen her satir bir GERCEK TABLO (view/materialized view HARIC; onlar baska
-- tablolardan uretildigi icin yedekte tekrar olurdu).
-- id_var: tabloda "id" kolonu var mi — yedek sayfalamasini siralamak icin
-- (sirasiz offset sayfalamasi satir atlayip tekrarlayabiliyor).
-- Yalniz service_role cagirabilir: sema yapisi disari sizmasin.
drop function if exists public.yedek_tablolari();

create or replace function public.yedek_tablolari()
returns table (ad text, id_var boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.relname::text,
         exists (
           select 1 from pg_attribute a
           where a.attrelid = c.oid and a.attname = 'id'
             and a.attnum > 0 and not a.attisdropped
         )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')      -- r: tablo, p: bolumlenmis tablo
    and not c.relispartition         -- bolum parcalari ana tabloyla zaten iniyor
  order by c.relname;
$$;

revoke all on function public.yedek_tablolari() from public;
revoke all on function public.yedek_tablolari() from anon;
revoke all on function public.yedek_tablolari() from authenticated;
grant execute on function public.yedek_tablolari() to service_role;

notify pgrst, 'reload schema';
