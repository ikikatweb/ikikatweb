-- Bildirge IMAP taramasında ARTIMLI okuma durumu.
--
-- Önceden her tur, en eski bekleyen talebin gönderim gününden bugüne kadarki TÜM
-- mailleri tam gövdesiyle indiriyordu. 30 dakikada bir dönerken günde ~9.600 mail
-- indirimi demek; 5 dakikaya çekilince ~57.600 olurdu ve paylaşımlı posta sunucusunu
-- zorlardı. Bu tablo her kutu için en son işlenen mail UID'ini saklar; sonraki turlar
-- yalnız ondan SONRAKİ mailleri indirir.
--
-- Güvenlik ağı: saatte bir tam pencere taraması yapılır (son_tam_tarama). Böylece
-- talep, bildirge geldikten SONRA oluşturulmuş olsa bile mail yine yakalanır.
-- uid_validity değişirse (sunucu kutuyu yeniden numaralandırmış) durum sıfırlanır.
--
-- Supabase SQL editöründe bir kez çalıştırın.

create table if not exists bildirge_imap_durum (
  kutu            text primary key,       -- posta kutusu kullanıcı adı (muhasebe@...)
  uid_validity    bigint,                 -- IMAP UIDVALIDITY — değişirse UID'ler geçersizdir
  son_uid         bigint,                 -- işlenen en büyük UID
  son_tam_tarama  timestamptz,            -- en son ne zaman tam pencere tarandı
  guncellendi     timestamptz not null default now()
);

comment on table bildirge_imap_durum is
  'Bildirge IMAP taramasının artımlı okuma durumu — scripts/personel-bildirge-sync.ts kullanır.';

-- Yalnız senkron script'i (service role) yazar; tarayıcıya açılmasına gerek yok.
alter table bildirge_imap_durum enable row level security;
