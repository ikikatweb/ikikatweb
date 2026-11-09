-- AVUKATA GÖNDERİM GÜNLÜĞÜ — kim, ne zaman, hangi avukata, hangi ekle gönderdi.
--
-- NİYE GÜNLÜK: "Tekrar gönder" düğmesi geldi. Tek satırda tutulsaydı her yeniden
-- gönderim öncekini ezerdi ve "bu dosya avukata kaç kere, kim tarafından
-- gönderilmiş" sorusu cevapsız kalırdı. Panelde aynı desen uyari_onaylari'nda da
-- var: her basış ayrı satır.
--
-- GÖNDEREN ADI ANLIK KOPYA: kullanıcı sonradan silinse de kimin gönderdiği kalsın.
create table if not exists public.icra_avukat_mail_log (
  id             bigserial primary key,
  icra_id        uuid not null references public.icra(id) on delete cascade,
  avukat_id      uuid,
  avukat_adi     text,          -- anlık kopya
  avukat_email   text,          -- o anda hangi adrese gittiği
  gonderen_id    uuid,
  gonderen_ad    text,          -- anlık kopya
  ek_ad          text,          -- maile eklenen tebligat belgesinin adı
  gonderildi_at  timestamptz not null default now()
);

comment on table public.icra_avukat_mail_log is
  'İcra dosyasının avukata maille gönderildiği her sefer — kim, ne zaman, hangi ekle';

create index if not exists icra_avukat_mail_log_icra_idx
  on public.icra_avukat_mail_log (icra_id, gonderildi_at desc);

-- Okumak serbest, YAZMAK DEĞİL: günlüğe yalnız /api/icra/avukata-gonder servis
-- anahtarıyla yazar. Kullanıcı kendi izini silemez ya da başkası adına satır atamaz.
alter table public.icra_avukat_mail_log enable row level security;
drop policy if exists "icra_avukat_mail_log_read" on public.icra_avukat_mail_log;
create policy "icra_avukat_mail_log_read"
  on public.icra_avukat_mail_log for select to authenticated using (true);

-- İcra satırında SON gönderimin özeti — ekran her satır için günlüğe gitmesin.
alter table public.icra add column if not exists avukat_mail_gonderen text;
alter table public.icra add column if not exists avukat_mail_gonderen_id uuid;
alter table public.icra add column if not exists avukat_mail_sayisi integer not null default 0;

comment on column public.icra.avukat_mail_gonderen is
  'Avukata maili SON gönderen kullanıcının adı (anlık kopya). Geçmişin tamamı icra_avukat_mail_log''da.';
comment on column public.icra.avukat_mail_sayisi is
  'Kaç kez gönderildi. 1''den büyükse tekrar gönderilmiş demektir.';
