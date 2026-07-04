-- Ödeme Planı (Kasa Defteri içindeki "Ödeme Planı" sekmesi) — PAYLAŞIMLI, elle girilen ileriye dönük nakit planı.
-- İki tablo: (1) ödeme/tahsilat satırları, (2) yandaki "Kullanılabilir Krediler ve Kasa" listesi.
-- Kümülatif OTOMATİK hesaplanır (DB'de tutulmaz): başlangıç = kasa listesi TOPLAM'ı, her satırda -gider +gelir.

-- Ana satırlar: Tarih | Ödeme ve Tahsilatlar | Gider | Gelir
create table if not exists public.odeme_plani_satir (
  id         uuid primary key default gen_random_uuid(),
  tarih      date not null,
  aciklama   text,
  gider      numeric not null default 0,
  gelir      numeric not null default 0,
  sira       integer not null default 0,   -- aynı tarihte stabil sıralama / manuel sıra
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Yan liste: Kullanılabilir Krediler ve Kasa (etiket + tutar + grup) → TOPLAM = kümülatif başlangıç bakiyesi
-- grup: 'kredi' (Kredi/BCH) | 'banka' | 'kasa' — 3 sütun halinde gösterilir, TOPLAM tektir.
create table if not exists public.odeme_plani_kasa (
  id         uuid primary key default gen_random_uuid(),
  etiket     text,
  tutar      numeric not null default 0,
  grup       text not null default 'banka',
  sira       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Mevcut tabloya kolon ekleme (ilk sürümü zaten çalıştırdıysan) + eski satırları otomatik grupla:
alter table public.odeme_plani_kasa add column if not exists grup text not null default 'banka';
update public.odeme_plani_kasa set grup = 'kredi' where etiket ilike '%BCH%';
update public.odeme_plani_kasa set grup = 'kasa'  where etiket ilike '%kasa%';

-- Tarayıcı (authenticated) okur+yazar; erişim uygulama içi izin matrisiyle (odeme-plani modülü) yönetilir.
alter table public.odeme_plani_satir enable row level security;
create policy "odeme_plani_satir_authenticated_all"
  on public.odeme_plani_satir for all to authenticated using (true) with check (true);

alter table public.odeme_plani_kasa enable row level security;
create policy "odeme_plani_kasa_authenticated_all"
  on public.odeme_plani_kasa for all to authenticated using (true) with check (true);
