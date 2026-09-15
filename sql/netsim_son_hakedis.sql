-- Netsim: SON HAKEDİŞİN tutarları — "tahmini fiyat farkı" hesabı için.
--
-- Neden gerekiyor: fiyat farkı oranı iş boyunca sabit değil, Yi-ÜFE ile hakediş
-- hakediş yükseliyor (Kampüs Altyapı: %0 → %10,53 → %13,01 → %15,13 → %17,11 → %18,82).
-- Kalan keşfin alacağı fiyat farkını tahmin ederken İŞİN ORTALAMASI değil, EN SON
-- hakedişin oranı kullanılmalı — güncel endeks seviyesini o yansıtıyor:
--
--   tahmini FF = kalan keşif × (son hakediş fiyat farkı ÷ son hakediş bedeli)
--   kalan keşif = (sözleşme bedeli + ek sözleşme bedeli) − tamamlanan keşif
--
-- Senkron (scripts/netsim-sync.ts) bu üç alanı her turda tazeler. Kullanıcı bunları
-- elle düzenlemez — sadece Netsim'in aynasıdır.
--
-- Supabase SQL editöründe bir kez çalıştırın.

alter table santiyeler
  add column if not exists netsim_son_hakedis_kesif numeric,
  add column if not exists netsim_son_hakedis_fark  numeric,
  add column if not exists netsim_son_hakedis_tarih date;

comment on column santiyeler.netsim_son_hakedis_kesif is
  'Netsim: en son hakediş belgesindeki hakediş bedeli (STOK_NO 39). Tahmini fiyat farkı oranının paydası.';
comment on column santiyeler.netsim_son_hakedis_fark is
  'Netsim: en son hakediş belgesindeki fiyat farkı (STOK_NO 356). Tahmini fiyat farkı oranının payı.';
comment on column santiyeler.netsim_son_hakedis_tarih is
  'Netsim: o hakediş belgesinin tarihi — oranın ne kadar güncel olduğu buradan görülür.';
