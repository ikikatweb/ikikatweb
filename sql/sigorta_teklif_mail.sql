-- GELEN TEKLİF MAİLLERİNİN OTOMATİK OKUNMASI
--
-- Teklif istenen acenteler cevabı maille gönderiyor ve üç biçimde geliyor:
--   • PDF ek        (sigorta şirketinin poliçe teklifi — rakam metinden birebir okunuyor)
--   • mail gövdesi  ("en uygun Doğa sigortadan 11.895 tl" gibi)
--   • resim ek      (acentenin karşılaştırma tablosunun ekran görüntüsü)
--
-- İlk ikisi makine tarafından okunabiliyor; resimden rakam çıkarmak ayrı bir servis
-- gerektirdiği için o mailler "elle bakılmalı" diye işaretlenip eki saklanıyor.
--
-- Bu kolonlar tekliflerin NEREDEN geldiğini ve aynı mailin iki kez işlenmemesini sağlar.

-- Kaynak: elle | pdf | mail | resim   (boş/eski kayıtlar "elle" sayılır)
alter table sigorta_teklif add column if not exists kaynak text;

-- Aynı mailden ikinci kez teklif üretilmesin. Biçim: "hesap/kutu/uid[#sira]"
alter table sigorta_teklif add column if not exists mail_kimlik text;
create unique index if not exists sigorta_teklif_mail_kimlik_key
  on sigorta_teklif (mail_kimlik) where mail_kimlik is not null;

-- Mailin kendisine dair iz: kimden geldiği, konusu, eki (Storage yolu)
alter table sigorta_teklif add column if not exists mail_konu text;
alter table sigorta_teklif add column if not exists mail_tarih timestamptz;
alter table sigorta_teklif add column if not exists ek_url text;

-- Resimli mailler için: rakam okunamadı, kullanıcı eke bakıp elle girecek.
-- Böyle satırlarda teklif_tutari 0 kalır ve ekranda "elle girilmeli" diye görünür.
alter table sigorta_teklif add column if not exists elle_bekliyor boolean not null default false;

-- Mail okuyucunun en son nereye kadar baktığı (her hesap için ayrı) — tekrar taramasın.
create table if not exists sigorta_mail_durum (
  hesap text primary key,
  son_tarih timestamptz,
  son_calisma timestamptz,
  son_sonuc text
);
