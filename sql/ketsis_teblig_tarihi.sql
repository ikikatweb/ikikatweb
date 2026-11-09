-- TEBLİĞ TARİHİ — mailin metninden okunur.
--
-- GİB'in bildirim maili her iki tarihi de yazıyor:
--   "… 02/11/2026 tarihinde gönderilen MC09608584 sayılı belge
--      07/11/2026 tarihinde tebliğ edilmiş(tir / sayılacaktır)."
-- Aynı belge için İKİ mail geliyor (gönderildiği gün "sayılacaktır", tebliğ günü
-- "edilmiştir") ve İKİSİ DE aynı iki tarihi taşıyor — hangisi gelirse gelsin doğru.
--
-- NİYE SAKLANIYOR: tebliğ tarihi sürenin başladığı gün (VUK 107/A). Metnin içinde
-- gömülü dururken listede görünmüyordu; ayrı sütun olunca sıralanabilir, okunabilir.
-- HESAPLANMIYOR, OKUNUYOR: "ulaşma + 5" kendi hesabımız olurdu; burada GİB'in kendi
-- beyanı yazıyor. İkisi tutuyor ama tutacağı VARSAYILMIYOR.
alter table public.ketsis_bildirim add column if not exists gonderme_tarihi date;
alter table public.ketsis_bildirim add column if not exists teblig_tarihi   date;

comment on column public.ketsis_bildirim.gonderme_tarihi is
  'Belgenin gönderildiği gün — mail metninden ("… tarihinde gönderilen").';
comment on column public.ketsis_bildirim.teblig_tarihi is
  'GİB''in bildirdiği tebliğ günü — mail metninden ("… tarihinde tebliğ edilmiş…").
   Hesaplanmaz; GİB ne diyorsa o.';

-- Geriye dönük doldurma. Eşleşmeyen satır null kalır — uydurma tarih yazılmaz.
update public.ketsis_bildirim set
  gonderme_tarihi = to_date(substring(ozet from '(\d{2}/\d{2}/\d{4})\s+tarihinde\s+g[öo]nderilen'), 'DD/MM/YYYY')
where gonderme_tarihi is null
  and ozet ~ '\d{2}/\d{2}/\d{4}\s+tarihinde\s+g[öo]nderilen';

update public.ketsis_bildirim set
  teblig_tarihi = to_date(substring(ozet from '(\d{2}/\d{2}/\d{4})\s+tarihinde\s+tebli[ğg]\s+edilmi'), 'DD/MM/YYYY')
where teblig_tarihi is null
  and ozet ~ '\d{2}/\d{2}/\d{4}\s+tarihinde\s+tebli[ğg]\s+edilmi';
