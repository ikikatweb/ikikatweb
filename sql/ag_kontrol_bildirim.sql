-- AĞ KONTROL PANELİ BİLDİRİMLERİ — AYNI OLAY İKİ KEZ YAZILMASIN
--
-- Ofisteki ağ kontrol paneli (192.168.3.66:8088) POST /api/bildirim ile bildirim
-- yolluyor; her olayın benzersiz bir "id"si var. Panel cevabı alamayınca aynı olayı
-- tekrar gönderebilir. Olay kimliği bildirim_gecmisi.kaynak_id'ye yazılır
-- (kaynak_tip = 'ag-kontrol'); bu dizin aynı kişiye aynı olayın ikinci kez
-- eklenmesini VERİTABANINDA engeller — iki istek aynı anda gelse bile.

create unique index if not exists bildirim_gecmisi_ag_kontrol_tekil
  on public.bildirim_gecmisi (kullanici_id, kaynak_id)
  where kaynak_tip = 'ag-kontrol';
