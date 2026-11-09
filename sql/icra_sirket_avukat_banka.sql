-- ŞİRKETE AÇILAN TAKİPLERDE CEVAP ŞEKLİ ALANLARI
--
-- Üçüncü şahıs defterinde (public.icra) olan iki şey buraya da geliyor:
--
-- 1) AVUKATTA: dosya avukata veriliyor ve panelden mail gidiyor. Üçüncü şahıs
--    defteriyle BİREBİR aynı akış — avukat listeden seçiliyor, not mailin içine
--    giriyor, tebligat belgesi eklenerek gönderiliyor. Alanlar da aynı adlarla
--    duruyor ki iki defter tek koddan beslenebilsin.
--
--    MAİL GİTMEDİYSE İZ DE YOK: avukat_mail_at boşsa gönderilmemiştir.
--    AGENTS.md "Sessiz hata yok" — ek inmeden mail gönderilmiyor.
--
-- 2) ÖDENDİ: hangi bankadan ödendiği soruluyor. İcra defterinde banka havalesi
--    kipinde zaten soruluyordu; dekontun hangi bankaya ait olduğu sonradan
--    sorulan bir şey ve kayıtta yoksa cevapsız kalıyor.
--
-- avukat_adi ANLIK KOPYA: avukat listeden silinse ya da adı değişse de "bu dosya
-- kime gitmişti" sorusu cevaplanabilsin.

alter table public.icra_sirket_takip add column if not exists banka_adi text;
alter table public.icra_sirket_takip add column if not exists avukat_id uuid;
alter table public.icra_sirket_takip add column if not exists avukat_adi text;
alter table public.icra_sirket_takip add column if not exists avukat_notu text;
alter table public.icra_sirket_takip add column if not exists avukat_mail_at timestamptz;
alter table public.icra_sirket_takip add column if not exists avukat_mail_ek text;
alter table public.icra_sirket_takip add column if not exists avukat_mail_gonderen text;
alter table public.icra_sirket_takip add column if not exists avukat_mail_gonderen_id uuid;
alter table public.icra_sirket_takip add column if not exists avukat_mail_sayisi integer not null default 0;

comment on column public.icra_sirket_takip.banka_adi is
  'Ödeme banka havalesiyle yapıldıysa hangi banka';
comment on column public.icra_sirket_takip.avukat_adi is
  'Avukatın o andaki adı — ANLIK KOPYA: avukat silinse/adı değişse de kalır';
comment on column public.icra_sirket_takip.avukat_mail_at is
  'Avukata mail BAŞARIYLA gönderildiği an. Boşsa gönderilmemiştir.';

-- GÜNLÜK İKİ DEFTERE BİRDEN HİZMET EDER: icra_id zorunluydu, artık şirket
-- takibi de yazabilsin diye gevşetiliyor ve ayrı bir bağ ekleniyor. Satırın
-- hangi deftere ait olduğu dolu olan sütundan anlaşılır.
alter table public.icra_avukat_mail_log alter column icra_id drop not null;
alter table public.icra_avukat_mail_log add column if not exists sirket_takip_id uuid
  references public.icra_sirket_takip(id) on delete cascade;

create index if not exists icra_avukat_mail_log_sirket_idx
  on public.icra_avukat_mail_log (sirket_takip_id, gonderildi_at desc);

-- İKİSİNDEN BİRİ DOLU OLMALI: hangi dosyaya ait olduğu belirsiz bir gönderim
-- kaydı, hiç kayıt tutmamakla aynı kapıya çıkar.
alter table public.icra_avukat_mail_log drop constraint if exists icra_avukat_mail_log_kaynak_chk;
alter table public.icra_avukat_mail_log add constraint icra_avukat_mail_log_kaynak_chk
  check (icra_id is not null or sirket_takip_id is not null);
