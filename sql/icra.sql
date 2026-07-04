-- İcra takibi (Kasa ile Şantiye Defteri arasındaki "İcra" sekmesi) — PAYLAŞIMLI, elle girilen icra dosyaları.
-- Aynı borçlu (TC/Vergi No) birden fazla satırda geçiyorsa UI otomatik kırmızı vurgular (tekrarlayan borçlu).
create table if not exists public.icra (
  id                 uuid primary key default gen_random_uuid(),
  sira               integer not null default 0,   -- manuel/stabil sıralama
  ucuncu_sahis       text,                          -- Üçüncü Şahıs
  dosya_esas_no      text,                          -- Dosya Esas No
  gelen_yazi_tarihi  date,                          -- Gelen İcra Yazısı Tarihi
  teblig_tarihi      date,                          -- Gelen İcra Yazısı Tebliğ Tarihi
  cevap_tarihi       date,                          -- İcraya Cevap Tarihi
  cevap_sekli        text,                          -- Cevap Şekli (ör. İADELİ TAAHÜTLÜ)
  evrak_no           text,                          -- Gönderilen evrağın evrak numarası (cevap tarihi girilince zorunlu)
  alacakli_adi       text,                          -- Alacaklı Adı Soyadı / Ünvanı
  alacakli_vergi_no  text,                          -- Alacaklı Vergi No
  borclu_adi         text,                          -- Borçlu Adı Soyadı / Ünvanı
  borclu_tc_no       text,                          -- Borçlu Vergi / TC No
  borc_miktari       numeric not null default 0,    -- Borç Miktarı
  odenen_tutar       numeric not null default 0,    -- Ödenen Tutar
  aciklama           text,                          -- Açıklama
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Tarayıcı (authenticated) okur+yazar; erişim uygulama içi izin matrisiyle (icra modülü) yönetilir.
alter table public.icra enable row level security;
create policy "icra_authenticated_all"
  on public.icra for all to authenticated using (true) with check (true);
