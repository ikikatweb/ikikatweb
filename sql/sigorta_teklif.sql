-- Gelen sigorta teklifleri (kasko/trafik) — hangi acente/firma ne kadar teklif verdi.
-- Dashboard "Yaklaşan Sigorta/Muayene" widget'ında "Teklifler" butonuyla girilir/karşılaştırılır.
-- En düşük tutar otomatik "en uygun" olarak vurgulanır; kullanıcı ayrıca birini "seçildi" işaretleyebilir.
create table if not exists sigorta_teklif (
  id              uuid primary key default gen_random_uuid(),
  arac_id         uuid not null references araclar(id) on delete cascade,
  police_tipi     text not null check (police_tipi in ('kasko','trafik')),
  acente_adi      text not null,            -- teklif isteği gönderilen acentelerden seçilir
  sigorta_firmasi text,                     -- teklifin ait olduğu sigorta firması (ör. AXA Sigorta)
  police_id       uuid references arac_police(id) on delete set null, -- poliçe girilince bağlanır (null=güncel dönem)
  teklif_tutari   numeric not null,
  teklif_tarihi   date,
  secildi         boolean not null default false,
  notlar          text,
  created_at      timestamptz not null default now()
);
-- Tabloyu önceki sürümde kurduysanız kolonları ekleyin:
alter table sigorta_teklif add column if not exists sigorta_firmasi text;
alter table sigorta_teklif add column if not exists police_id uuid references arac_police(id) on delete set null;
create index if not exists sigorta_teklif_police_idx on sigorta_teklif (police_id);

create index if not exists sigorta_teklif_arac_tip_idx on sigorta_teklif (arac_id, police_tipi);

-- RLS: teklif_gonderim / arac_police ile aynı desen — giriş yapmış kullanıcı okuyup yazabilir.
alter table sigorta_teklif enable row level security;
drop policy if exists sigorta_teklif_all on sigorta_teklif;
create policy sigorta_teklif_all on sigorta_teklif
  for all to authenticated using (true) with check (true);
