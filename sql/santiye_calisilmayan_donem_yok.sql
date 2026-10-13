-- "Çalışılmayan dönem yok" tiki
--
-- Çalışılmayan dönem artık zorunlu. Ama gerçekten dönemi olmayan işler var; onlar için
-- tik konuyor. Tik kalıcı alanda tutulmalı: iki alan da boşken "dönem yok" ile "henüz
-- girilmedi" ayırt edilemiyor — aynı sorunu onay_tarihi_yok'ta yaşamıştık.
alter table public.santiyeler
  add column if not exists calisilmayan_donem_yok boolean not null default false;

comment on column public.santiyeler.calisilmayan_donem_yok is
  'Bu işte çalışılmayan dönem yok — kullanıcı bilerek boş bıraktı (çıkarım değil, kayıt)';

-- Bugüne kadarki kayıtlar yeni zorunluluğa takılmasın: dönemi girilmemiş olanlar
-- "dönem yok" sayılır. Dönemi olanlara dokunulmaz.
update public.santiyeler
set calisilmayan_donem_yok = true
where calisilmayan_bas is null and calisilmayan_bit is null;
