-- Bordro gönderim takibi — dashboard "bordro gönder" hatırlatması için PAYLAŞIMLI durum.
-- Her ayın 1'inde (bir önceki/tamamlanan ayın bordrosu için) dashboard'da uyarı çıkar; o dönemin
-- bordrosu "Bordro Gönder" ile gönderilince buraya işaretlenir → uyarı HERKESTE kalkar (herhangi bir
-- yetkili kullanıcının göndermesi yeterli). Uyarı yalnız bordro-takibi ekle/düzenle yetkisi olanlara gösterilir.
create table if not exists bordro_gonderim (
  donem         text primary key,          -- gönderilen bordronun dönemi, 'YYYY-MM'
  gonderen_id   uuid,
  gonderen_ad   text,
  gonderildi_at timestamptz not null default now()
);
-- Tarayıcı (authenticated) hem okur (uyarı kontrolü) hem yazar (Bordro Gönder işaretlemesi).
alter table bordro_gonderim enable row level security;
create policy "bordro_gonderim_authenticated_all"
  on public.bordro_gonderim
  for all
  to authenticated
  using (true)
  with check (true);
