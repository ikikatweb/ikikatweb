-- Sigorta takibinden VAZGEÇME — kasko/trafik yaptırmaktan vazgeçilen araçlar dashboard "Yaklaşan Sigorta"
-- widget'ında görünmez. Araç+tip bazlı. Poliçe Ekle diyaloğundaki kırmızı "Vazgeç" butonu buraya yazar;
-- o araç+tip için poliçe girilince kayıt silinir (tekrar takibe alınır).
create table if not exists sigorta_vazgec (
  arac_id     uuid not null references araclar(id) on delete cascade,
  police_tipi text not null check (police_tipi in ('kasko','trafik')),
  created_at  timestamptz not null default now(),
  primary key (arac_id, police_tipi)
);

alter table sigorta_vazgec enable row level security;
drop policy if exists sigorta_vazgec_all on sigorta_vazgec;
create policy sigorta_vazgec_all on sigorta_vazgec
  for all to authenticated using (true) with check (true);
