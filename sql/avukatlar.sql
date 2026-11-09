-- AVUKATLAR — icra cevabı "Avukat Aracılığı" ile verildiğinde seçilen kişi.
--
-- NİYE TANIMLAMALAR TABLOSUNDA DEĞİL: public.tanimlamalar tek bir "deger" metni
-- tutuyor (Cevap Şekli seçenekleri gibi). Avukatta üç alan var — ad soyad, e-posta
-- ve cep telefonu — ve ikisi iletişim bilgisi. Üçünü tek metne sıkıştırmak (ya da
-- JSON yazmak) sonradan "avukatın maili neydi" sorusunu cevaplanamaz hale getirirdi.
--
-- Yönetimi yine İcra Dosyaları > Tanımlamalar sekmesinden yapılıyor; kullanıcı
-- açısından Cevap Şekli listesiyle aynı yerde.
create table if not exists public.avukatlar (
  id         uuid primary key default gen_random_uuid(),
  ad_soyad   text        not null,
  email      text,
  telefon    text,
  aktif      boolean     not null default true,   -- ayrılan avukat silinmez, pasife alınır
  sira       integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.avukatlar is
  'İcra cevabı avukat aracılığıyla verildiğinde seçilen avukatlar (İcra > Tanımlamalar''dan yönetilir)';

-- Aynı avukat iki kere girilmesin. Büyük/küçük harf duyarsız: "Av. Ali Veli" ile
-- "AV. ALİ VELİ" aynı kişidir. Türkçe harflerde upper() tam doğru çalışmadığı için
-- normalize indeks yerine basit lower() kullanılıyor; amaç kazara tekrarı önlemek.
create unique index if not exists avukatlar_ad_uq on public.avukatlar (lower(ad_soyad));

alter table public.avukatlar enable row level security;
drop policy if exists "avukatlar_authenticated_all" on public.avukatlar;
create policy "avukatlar_authenticated_all"
  on public.avukatlar for all to authenticated using (true) with check (true);

-- İcra kaydında hangi avukatla cevap verildiği.
--
-- İKİ SÜTUN, BİLEREK: avukat_id bağlantıdır (iletişim bilgisi oradan okunur),
-- avukat_adi ise ANLIK KOPYADIR. Avukat listeden silinirse ya da adı değişirse
-- "o tarihte kiminle cevap verdik" sorusunun cevabı kaybolmasın. Panelde aynı
-- desen uyari_onaylari.kullanici_ad'da da kullanılıyor.
alter table public.icra add column if not exists avukat_id uuid references public.avukatlar(id) on delete set null;
alter table public.icra add column if not exists avukat_adi text;

comment on column public.icra.avukat_adi is
  'Cevap avukat aracılığıyla verildiyse avukatın o andaki adı (anlık kopya; avukat silinse de kalır)';
