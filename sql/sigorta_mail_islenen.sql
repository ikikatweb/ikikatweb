-- İŞLENMİŞ MAİL KAYDI — aynı maili ikinci kez yapay zekâya OKUTMAMAK için.
--
-- SORUN: script her çalıştığında en son okunan mailin tarihinden 1 GÜN GERİYE bakıyor
-- (sınırda kalan mailler kaçmasın diye). Resim eki olan bir mail bu pencerede kaldığı
-- sürece HER ÇALIŞMADA yeniden okunuyordu. Script 15 dakikada bir çalıştığı için tek bir
-- teklif resmi 24 saat boyunca ~96 kez okunuyor, her okuma ücretli.
--
-- Teklif satırları mail_kimlik ile korunuyordu ama kontrol OKUMADAN SONRA yapılıyordu:
-- para harcanıyor, sonra "zaten var" deyip atılıyordu. Poliçe PDF'lerinde de aynısı.
--
-- ÇÖZÜM: işlenen her mail buraya yazılır; sonraki çalışmalar bu maile hiç dokunmaz.
create table if not exists sigorta_mail_islenen (
  kimlik      text primary key,          -- hesap/INBOX/uid
  islendi_at  timestamptz not null default now(),
  sonuc       text                       -- ne bulundu (teklif sayısı / poliçe / boş)
);

comment on table sigorta_mail_islenen is
  'Okunmuş teklif/poliçe mailleri — aynı mailin tekrar yapay zekâya okutulmasını önler';
