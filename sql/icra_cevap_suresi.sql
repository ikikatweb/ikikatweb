-- CEVAP SÜRESİ BELGEDEN OKUNUR, HESAPLANMAZ
--
-- Panel bugüne kadar sabit 7 gün kullanıyordu (CEVAP_SURESI_GUN). Elimizdeki 25
-- belgenin 18'inde süre açıkça yazıyor ve hepsinde 7 — yani sabit doğruydu. Ama
-- "kanun böyle" diye sabitlemek yanlış: görmediğimiz bir türde farklı süre çıkarsa
-- panel yanlış tarih gösterir ve insan ona güvenir. Artık belgeden okunuyor;
-- yazmıyorsa alan BOŞ kalır ve ekran süre göstermez (uydurma gün yok).
alter table public.icra add column if not exists cevap_suresi_gun integer;

comment on column public.icra.cevap_suresi_gun is
  'Tebligat belgesinde yazan cevap süresi (gün). Belgeden okunur, hesaplanmaz.
   Boşsa belgede süre yazmıyor ya da belge okunmamış demektir.';
