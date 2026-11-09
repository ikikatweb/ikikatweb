-- GÖNDEREN KURUM — mailin metninden okunur, ekranda robot adresi yerine o yazar.
--
-- NİYE: listede "Gönderen" sütunu iki kez ketsis-noreply@gelirler.gov.tr gösteriyordu.
-- O adres GİB'in dağıtım robotu; tebligatı GÖNDEREN kurum değil. Asıl kurum metinde:
--   "Tarafınıza Emniyet Genel Müdürlüğü adına Gelir İdaresi Başkanlığı tarafından …"
-- Trafik cezası mı, vergi dairesi yazısı mı — listeye bakınca görülmeli.
alter table public.ketsis_bildirim add column if not exists gonderen_kurum text;

comment on column public.ketsis_bildirim.gonderen_kurum is
  'Tebligatı gönderen kurum, mail metninden ("Tarafınıza X adına"). GİB yalnız taşıyıcı.';

-- Eldeki kayıtlar için geriye dönük doldurma: özet metni zaten saklanıyor.
-- Eşleşmeyen satır DOKUNULMADAN kalır (null) — uydurma kurum yazılmaz.
update public.ketsis_bildirim
set gonderen_kurum = btrim(substring(ozet from 'Taraf[ıi]n[ıi]za\s+(.+?)\s+ad[ıi]na'))
where gonderen_kurum is null
  and ozet ~ 'Taraf[ıi]n[ıi]za\s+.+?\s+ad[ıi]na';
