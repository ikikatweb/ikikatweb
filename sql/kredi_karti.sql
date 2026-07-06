-- Kredi Kartları — PAYLAŞIMLI, elle girilen kart durum listesi (Ödeme Planı ile İcra Takibi arasındaki sayfa).
-- Kullanılabilir limit = limit_tutar - guncel_borc (uygulamada hesaplanır, burada tutulmaz).

create table if not exists public.kredi_karti (
  id             uuid primary key default gen_random_uuid(),
  banka_adi      text,
  son4           text,                          -- son 4 hane
  kart_ozelligi  text,                          -- Bonus / Maximum / Platinum MC vb.
  kart_sahibi    text,
  karti_kullanan text,
  hesap_kesim    integer,                       -- her ayın günü (1-31)
  son_odeme      integer,                       -- her ayın günü (1-31)
  limit_tutar    numeric not null default 0,
  guncel_borc    numeric not null default 0,
  aciklama       text,
  sira           integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Tarayıcı (authenticated) okur+yazar; erişim uygulama içi izin matrisiyle (kredi-kartlari modülü) yönetilir.
alter table public.kredi_karti enable row level security;
create policy "kredi_karti_authenticated_all"
  on public.kredi_karti for all to authenticated using (true) with check (true);
