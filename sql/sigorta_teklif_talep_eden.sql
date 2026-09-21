-- POLİÇELEŞTİRME TALEBİNİ KİM GÖNDERDİ
--
-- Teklif satırında "poliçeleştirme istendi" yazıyordu ama kimin istediği görünmüyordu.
-- Birden çok kişi bu ekranı kullanıyor; sonradan "bunu kim istemiş" sorusu sorulduğunda
-- cevabı yalnız mail kutusunda aramak gerekiyordu.
--
-- Maili gönderen kullanıcının adı, talep tarihiyle birlikte teklif satırında görünür:
-- "Zerrin Özge DÜZEN tarafından Poliçeleştirme İstendi · 21.09.2026 13:36"
alter table sigorta_teklif add column if not exists police_talep_eden text;

comment on column sigorta_teklif.police_talep_eden is
  'Poliçeleştirme talebi mailini gönderen kullanıcının adı soyadı';
