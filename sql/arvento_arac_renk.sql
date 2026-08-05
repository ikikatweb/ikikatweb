-- Araç rengi override — Tanımlamalar → Araç Sekme Atamaları "Renk" sütunu.
-- Dolu ise haritalarda/chip'lerde otomatik atanan renk YERİNE bu kullanılır (tüm bilgisayarlarda aynı).
-- null = otomatik. Hex "#rrggbb". Kolon eklenmeden de uygulama çalışır (graceful fallback), eklenince kalıcı olur.
alter table araclar add column if not exists arvento_renk text;
