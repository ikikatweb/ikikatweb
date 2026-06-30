-- Sezon Maliyeti'nde "Silinenler"e taşınan (gizlenen) şantiyeler — PAYLAŞIMLI (tüm yöneticiler aynı listeyi görür).
-- Önceden tarayıcı localStorage'ındaydı (kişi bazlı); artık DB'de → bir yöneticinin gizlediği herkeste gizli.
-- ERİŞİM: yalnız /api/maliyet/gizli (service-role) üzerinden. RLS açık + politika yok → client doğrudan erişemez.

create table if not exists public.maliyet_gizli_santiye (
  santiye_id text        primary key,
  gizleyen   text,                              -- gizleyen kullanıcı id (bilgi amaçlı)
  olusturma  timestamptz not null default now()
);

alter table public.maliyet_gizli_santiye enable row level security;
-- Bilerek politika eklenmedi: API route (service-role) erişir.
