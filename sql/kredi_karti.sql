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
  kullanilabilir_tarihi timestamptz,          -- kullanılabilir limit/güncel borç en son ne zaman güncellendi
  kullanilabilir_guncelleyen text,            -- en son güncelleyen kullanıcının adı
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Mevcut tabloya kolon ekleme (ilk sürümü zaten çalıştırdıysan) + geçmiş kartlara updated_at'i yaz:
alter table public.kredi_karti add column if not exists kullanilabilir_tarihi timestamptz;
alter table public.kredi_karti add column if not exists kullanilabilir_guncelleyen text;
update public.kredi_karti set kullanilabilir_tarihi = updated_at where kullanilabilir_tarihi is null;

-- Tarayıcı (authenticated) okur+yazar; erişim uygulama içi izin matrisiyle (kredi-kartlari modülü) yönetilir.
alter table public.kredi_karti enable row level security;
create policy "kredi_karti_authenticated_all"
  on public.kredi_karti for all to authenticated using (true) with check (true);
