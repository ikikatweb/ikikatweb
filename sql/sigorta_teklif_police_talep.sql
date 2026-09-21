-- POLİÇELEŞTİRME TALEBİ İZİ
--
-- Teklifler ekranında bir teklife sağ tıklayıp "Poliçeleştir" denince, teklifi gönderen
-- acenteye "bu teklif uygun görülmüştür, poliçeleştirin" maili gidiyor (onay penceresinde
-- mailin tamamı okutulduktan sonra).
--
-- Hangi teklif için ne zaman talep gönderildiği burada durur: teklif satırında
-- "poliçeleştirme istendi · 21.09.26" olarak görünür ve aynı teklif için ikinci kez
-- mail gönderildiği fark edilir.
alter table sigorta_teklif add column if not exists police_talep_tarihi timestamptz;

comment on column sigorta_teklif.police_talep_tarihi is
  'Acenteye "bu teklifi poliçeleştirin" maili gönderildiği an';
