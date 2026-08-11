-- Personel bildirge SİCİL doğrulaması — bildirgedeki SGK işyeri sicil no ile
-- kişinin şantiyesinin iscilik_takibi.sicil_no'su karşılaştırılır (bkz. lib/personel/bildirge-fetch).
-- Tutuyorsa otomatik kapanır; boş/farklı/okunamaz ise ana sayfada "devam edeyim mi?" sorulur.
alter table personel_islem_takip add column if not exists cevap_sicil      text;   -- bildirgeden okunan işyeri sicil no (ör. "4 4100 01 1070846 060 01 64 000")
alter table personel_islem_takip add column if not exists uyusmazlik_tip   text;   -- uyuşmazlık nedeni: 'tarih' | 'sicil_yok' | 'sicil_farkli'
alter table personel_islem_takip add column if not exists sicil_santiye_id uuid references santiyeler(id) on delete set null; -- "sicili gir ve kapat" için hedef şantiye (boş sicil doldurulacak iscilik_takibi)
