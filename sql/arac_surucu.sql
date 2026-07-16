-- Araç ŞOFÖR override — Tanımlamalar → Araç Sekme Atamaları'ndaki "Şoför" kolonu buraya yazar.
-- Dolu ise sitede Arvento'dan gelen sürücü adının YERİNE bu gösterilir (işten çıkan şoförün adı
-- kalmasın / Arvento'ya bağımlı olmadan isim yönetimi). Boş (NULL) = Arvento'dan gelen ad kullanılır.
-- "-" (tire) yazılırsa isim hiç gösterilmez.
alter table public.araclar add column if not exists surucu text;
