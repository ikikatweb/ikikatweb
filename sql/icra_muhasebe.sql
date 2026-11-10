-- MUHASEBE AŞAMASI — İCRA YAZISI GELİR GELMEZ MUHASEBEYE GİDER
--
-- NİYE: cevabın altlığını muhasebe hazırlıyor. Üçüncü şahıs haczinde "borçluya
-- borcumuz var mı, ne kadar", şirkete açılan takipte "bu borç ödendi mi, ödenecek
-- mi" sorusunun cevabı muhasebeden geliyor ve CEVAP ŞEKLİNİ (yazışma / havale /
-- avukat) belirleyen de o cevap. Panelde bu aşama hiç yoktu: dosya açılıyor,
-- doğrudan cevap şekli seçiliyordu. Araya giren adım kayıt dışı kalıyordu —
-- "muhasebeye gönderdik mi, cevap geldi mi" sorusu mail kutusunda aranıyordu.
--
-- AKIŞ:  kayıt açılır → mail (ek: tebligat yazısı) → muhasebe cevabı girilir
--        → cevap şekli muhasebenin belirlediğiyle açılır
--
-- MAİL GİTMEDİYSE İZ DE YOK: muhasebe_mail_at boşsa gönderilmemiştir.
-- AGENTS.md "Sessiz hata yok" — ek inmeden mail gönderilmiyor, dosya da
-- "muhasebeye gönderilmedi" durumunda kalıyor.
--
-- İKİ DEFTERDE AYNI SÜTUN ADLARI: tek pencere ve tek servis iki deftere de
-- hizmet edebilsin. Ayrı adlar konsa biri düzelir öbürü geride kalırdı
-- (avukat alanlarında da aynı yol tutulmuştu).

-- ── ÜÇÜNCÜ ŞAHIS HACİZLERİ (public.icra) ──
alter table public.icra add column if not exists muhasebe_mail_at timestamptz;
alter table public.icra add column if not exists muhasebe_mail_ek text;
alter table public.icra add column if not exists muhasebe_mail_alici text;
alter table public.icra add column if not exists muhasebe_mail_gonderen text;
alter table public.icra add column if not exists muhasebe_mail_gonderen_id uuid;
alter table public.icra add column if not exists muhasebe_mail_sayisi integer not null default 0;
alter table public.icra add column if not exists muhasebe_cevap_at timestamptz;
alter table public.icra add column if not exists muhasebe_borc_durumu text;
alter table public.icra add column if not exists muhasebe_borc_tutari numeric;
alter table public.icra add column if not exists muhasebe_cevap_sekli text;
alter table public.icra add column if not exists muhasebe_notu text;
alter table public.icra add column if not exists muhasebe_cevap_yazan text;
alter table public.icra add column if not exists muhasebe_cevap_yazan_id uuid;

comment on column public.icra.muhasebe_mail_at is
  'Muhasebeye mail BAŞARIYLA gittiği an. Boşsa gönderilmemiştir.';
comment on column public.icra.muhasebe_mail_alici is
  'Mailin gittiği adresler (anlık kopya) — tanımlar sonradan değişse de kime gittiği kalır';
comment on column public.icra.muhasebe_borc_durumu is
  'Muhasebenin bildirdiği: var | yok  (borçluya borcumuz var mı)';
comment on column public.icra.muhasebe_borc_tutari is
  'Borcumuz varsa muhasebenin bildirdiği tutar';
comment on column public.icra.muhasebe_cevap_sekli is
  'Muhasebenin belirlediği cevap şekli. Kullanıcı başkasını seçerse kayıtta ikisi birden durur';
comment on column public.icra.muhasebe_cevap_at is
  'Muhasebe cevabının PANELE girildiği an — mailin geldiği an değil';

-- ── ŞİRKETE AÇILAN TAKİPLER (public.icra_sirket_takip) ──
-- Soru burada ters yönde: borçlu biziz. "Bu borç ödenmiş mi, ödenecek mi,
-- itiraz edilecek mi" — cevap şeklini (Ödendi / Avukatta / Kapandı) yine
-- muhasebe belirliyor.
alter table public.icra_sirket_takip add column if not exists muhasebe_mail_at timestamptz;
alter table public.icra_sirket_takip add column if not exists muhasebe_mail_ek text;
alter table public.icra_sirket_takip add column if not exists muhasebe_mail_alici text;
alter table public.icra_sirket_takip add column if not exists muhasebe_mail_gonderen text;
alter table public.icra_sirket_takip add column if not exists muhasebe_mail_gonderen_id uuid;
alter table public.icra_sirket_takip add column if not exists muhasebe_mail_sayisi integer not null default 0;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_at timestamptz;
alter table public.icra_sirket_takip add column if not exists muhasebe_borc_durumu text;
alter table public.icra_sirket_takip add column if not exists muhasebe_borc_tutari numeric;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_sekli text;
alter table public.icra_sirket_takip add column if not exists muhasebe_notu text;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_yazan text;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_yazan_id uuid;

comment on column public.icra_sirket_takip.muhasebe_borc_durumu is
  'Muhasebenin bildirdiği: odendi | odenmedi  (takip konusu borç ödenmiş mi)';
comment on column public.icra_sirket_takip.muhasebe_mail_at is
  'Muhasebeye mail BAŞARIYLA gittiği an. Boşsa gönderilmemiştir.';

-- ── GÖNDERİM GÜNLÜĞÜ ──
-- Satırdaki özet SON gönderimi gösteriyor; "kaç kere, kim, hangi adrese
-- gönderdi" sorusunun tam cevabı burada. Avukat günlüğüyle aynı biçim.
create table if not exists public.icra_muhasebe_mail_log (
  id              uuid primary key default gen_random_uuid(),
  icra_id         uuid references public.icra(id) on delete cascade,
  sirket_takip_id uuid references public.icra_sirket_takip(id) on delete cascade,
  alici           text not null,
  gonderen_id     uuid,
  gonderen_ad     text,
  ek_ad           text,
  gonderildi_at   timestamptz not null default now(),
  -- İKİSİNDEN BİRİ DOLU OLMALI: hangi dosyaya ait olduğu belirsiz bir gönderim
  -- kaydı, hiç kayıt tutmamakla aynı kapıya çıkar.
  constraint icra_muhasebe_mail_log_kaynak_chk
    check (icra_id is not null or sirket_takip_id is not null)
);

create index if not exists icra_muhasebe_mail_log_icra_idx
  on public.icra_muhasebe_mail_log (icra_id, gonderildi_at desc);
create index if not exists icra_muhasebe_mail_log_sirket_idx
  on public.icra_muhasebe_mail_log (sirket_takip_id, gonderildi_at desc);

alter table public.icra_muhasebe_mail_log enable row level security;
drop policy if exists "icra_muhasebe_mail_log_authenticated_all" on public.icra_muhasebe_mail_log;
create policy "icra_muhasebe_mail_log_authenticated_all"
  on public.icra_muhasebe_mail_log for all to authenticated using (true) with check (true);
