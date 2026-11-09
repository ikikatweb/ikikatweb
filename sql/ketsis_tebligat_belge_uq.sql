-- TEKRAR KAYDI NASIL ÖNLENİR: PORTAL EXCEL'İNDE TEBLİGAT KİMLİĞİ YOK
--
-- Yer imi yolunda GİB'in tebligId'si geliyordu ve tekilliği o sağlıyordu. Portalın
-- "Excel'e Aktar" çıktısında (09.11.2026'da incelendi) böyle bir kimlik YOK; sütunlar:
--   Gönderen Kurum · Alt Birim · Belge Türü · Belge No · Gönderme Tarihi ·
--   Tebliğ Tarihi · Mükellef Okuma Tarihi
-- Bu yüzden tekillik FİRMA + BELGE NO üzerinden kuruluyor. Belge no (ör. MC09462508)
-- kurumun verdiği numara; aynı firmaya aynı numarayla ikinci bir tebligat gelmiyor.
--
-- portal_teblig_id'nin tekil dizini KALDIRILIYOR: iki ayrı çakışma hedefi olursa upsert
-- hangisine nişan alacağını bilemez. Sütun bilgi olarak duruyor (yer imi yolu dolduruyor).
--
-- KISMİ DİZİN KULLANILMIYOR (bu hata bir kez yapıldı): "where ... is not null" eklenince
-- PostgREST "no unique or exclusion constraint matching the ON CONFLICT specification"
-- diyor. Gerek de yok — Postgres tekil dizinde NULL'ları birbirinden ayrı sayıyor, yani
-- belge no'su boş elle kayıtlar birbirini engellemiyor.

drop index if exists public.ketsis_tebligat_portal_uq;

create unique index if not exists ketsis_tebligat_firma_belge_uq
  on public.ketsis_tebligat (firma_id, belge_no);

comment on index public.ketsis_tebligat_firma_belge_uq is
  'Aynı firmaya aynı belge no ile ikinci kayıt girmesin. Portal aktarımı (Excel ya da yer imi)
   tekrar çalıştırıldığında kopya üretmemesini bu sağlıyor.';
