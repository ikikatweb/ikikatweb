-- ŞİRKETE AÇILAN İCRA TAKİPLERİ — PAYLAŞIMLI. "İcra Dosyaları" sayfasının ikinci sekmesi.
--
-- NİYE AYRI TABLO: public.icra tablosu "üçüncü şahıs" modeline göre kurulu
-- (ucuncu_sahis = bizim firmamız, borclu_adi = bir başkası). Burada rol TERS:
-- BORÇLU ŞİRKETİN KENDİSİ. Aynı deftere yazmak, şirkete açılmış bir takibi rutin
-- bir maaş haczi gibi gösterirdi; takip edilecek alanlar da başka (itiraz süresi,
-- ödeme, dosyanın akıbeti — "icraya cevap/evrak no" değil).
--
-- 09.11.2026'da kutuda dört tane çıktı ve DÖRDÜ DE HİÇ AÇILMAMIŞTI; biri 252.199,22 TL.
-- Hiçbir ekranda görünmedikleri için kimse fark etmemişti. Bu tablo o boşluğu kapatıyor.
create table if not exists public.icra_sirket_takip (
  id                 uuid primary key default gen_random_uuid(),
  sira               integer not null default 0,
  borclu_firma       text,                        -- BİZİM hangi firmamız borçlu (firmalar.firma_adi)
  dosya_esas_no      text,
  icra_dairesi       text,                        -- ör. "Ankara 7. Genel İcra Dairesi"
  alacakli_adi       text,
  alacakli_vergi_no  text,
  takip_tutari       numeric not null default 0,  -- belgede yazan takip/borç tutarı
  belge_tarihi       date,                        -- belgenin kendi tarihi
  teblig_tarihi      date,                        -- tebligatın ULAŞTIĞI gün (süre buradan işler)
  -- Belgede YAZAN itiraz süresi (gün). Hesaplanmaz: belgede yoksa NULL kalır ve
  -- ekran uydurma bir son gün göstermez.
  itiraz_suresi_gun  integer,
  itiraz_tarihi      date,                        -- itiraz/şikâyet edildiyse tarihi
  itiraz_sekli       text,                        -- ör. "İcra dairesine dilekçe", "UYAP"
  evrak_no           text,
  odenen_tutar       numeric not null default 0,
  odeme_tarihi       date,
  -- yeni | avukatta | itiraz_edildi | taksit | odendi | kapandi
  durum              text not null default 'yeni',
  belge_yolu         text,                        -- tebligat ekindeki PDF (panelde "Belgeyi aç")
  tebligat_barkod    text,                        -- UETS barkodu — belgeye geri dönüş izi
  aciklama           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Aynı dosya iki kere açılmasın. Dosya esas no tek başına yeterli DEĞİL: aynı numara
-- ayrı icra dairelerinde olabiliyor (2026/27774 Ankara'da da, başka ilde de olabilir).
-- Kısmi (partial) index KULLANILMADI: PostgREST on_conflict ile hedefleyemiyor.
create unique index if not exists icra_sirket_takip_dosya_uq
  on public.icra_sirket_takip (icra_dairesi, dosya_esas_no);

alter table public.icra_sirket_takip enable row level security;
create policy "icra_sirket_takip_authenticated_all"
  on public.icra_sirket_takip for all to authenticated using (true) with check (true);
