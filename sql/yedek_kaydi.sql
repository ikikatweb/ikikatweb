-- Veri yedeği alındı takibi — PAYLAŞIMLI durum. Herhangi bir kullanıcı yedek alınca dashboard'daki
-- Cumartesi "yedek al" hatırlatması HERKESTE kalkar (eskiden kişiye özel localStorage idi → başkalarında kalmıyordu).
create table if not exists public.yedek_kaydi (
  tarih      date primary key,            -- yedek alınan gün (YYYY-MM-DD)
  alan_id    uuid,
  alan_ad    text,
  alindi_at  timestamptz not null default now()
);
-- Tarayıcı (authenticated) okur (hatırlatma kontrolü) + yazar (yedek alınca işaretleme).
alter table public.yedek_kaydi enable row level security;
create policy "yedek_kaydi_authenticated_all"
  on public.yedek_kaydi for all to authenticated using (true) with check (true);
