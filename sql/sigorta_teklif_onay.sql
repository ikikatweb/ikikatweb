-- SİGORTA TEKLİFİ ONAY DURUMU
--
-- Acentenin gönderdiği karşılaştırma tablosunun en sağında bir onay sütunu var:
--   yeşil tik      → o şirkete poliçe kestirilebilir
--   kırmızı ünlem  → kestirilemez / engel var
--   mavi i         → şartlı, önce bilgiye bakılmalı
--
-- Rakam ne kadar ucuz olursa olsun kırmızı ünlemli firmaya poliçe yaptırılamıyor;
-- bu yüzden teklif ekranında tutarın yanında görünmesi gerekiyor.
--
-- Değerler: 'onayli' | 'uyari' | 'bilgi' | NULL (tabloda işaret yok / elle girilmiş)
alter table sigorta_teklif add column if not exists onay_durumu text;

comment on column sigorta_teklif.onay_durumu is
  'Acente tablosundaki onay işareti: onayli (yeşil tik) | uyari (kırmızı ünlem) | bilgi (mavi i)';

-- Daha önce okunan teklifler: onay bilgisi notlar alanında metin olarak duruyor, sütuna taşı.
update sigorta_teklif
   set onay_durumu = case
         when notlar ilike '%(onayli)%' then 'onayli'
         when notlar ilike '%(uyari)%'  then 'uyari'
         when notlar ilike '%(bilgi)%'  then 'bilgi'
       end
 where onay_durumu is null
   and kaynak = 'resim'
   and notlar is not null;

-- MAİL GÖVDESİ
--
-- Acente rakamın yanına çoğu zaman şart yazıyor: "2 taksit olarak vade farksız tanzim
-- edilebilir" gibi. Bu bilgi teklifi seçerken rakam kadar önemli ama şimdiye kadar
-- yalnız konu başlığı saklanıyordu. Mailin metni de saklanır ki teklif ekranından
-- açılıp okunabilsin.
alter table sigorta_teklif add column if not exists mail_govde text;

comment on column sigorta_teklif.mail_govde is
  'Teklif mailinin düz metni — teklif ekranında "maili oku" ile gösterilir';
