-- "ANLADIM" KAYDI KULLANICININ KENDİSİNE AİT OLSUN, TARAYICIYA DEĞİL
--
-- NİYE: SGK prim dengesi uyarısının "görüldü" kaydı yalnız o tarayıcının
-- localStorage'ındaydı. Sonuç: kullanıcı bilgisayarda hepsine "Anladım" diyor,
-- telefondan girince altı uyarı birden yeniden çıkıyordu. Aynı şey ana ekrana
-- eklenmiş uygulamada da oluyor — iOS'ta uygulamanın deposu Safari'den AYRIDIR,
-- yani aynı telefonda bile iki ayrı hafıza vardı (10.11.2026).
--
-- Panelin geri kalanında kural zaten buydu: "Anlaşıldı" düğmeleri kullanıcı
-- kaydına yazılıyor (lib/supabase/queries/uyari-gizle). Prim uyarısı istisnaydı.
--
-- NİYE AYRI TABLO: burada saklanan şey yalnız "kapattı" değil; işin o anki DURUM
-- İMZASI da duruyor. Gidişat değişirse (yön döner, iş biter, toplu giriş/çıkış
-- olur) uyarı yeniden çıkmalı — imza bunun ölçüsü. Düz bir "gizlendi" listesi
-- bunu taşıyamaz.
--
-- KALICI SUSTURMA DEĞİL: satır silinirse ya da imza değişirse uyarı geri gelir.
create table if not exists public.prim_dengesi_gorulen (
  kullanici_id            uuid not null references public.kullanicilar(id) on delete cascade,
  santiye_id              uuid not null,
  -- Son tespit/değişim damgası — listede en son tespit edilen iş en üstte durur.
  son_tespit              timestamptz not null default now(),
  -- Ana ekranda gösterildi mi? (Bordro Takibi sayfasında her zaman tamamı görünür.)
  ana_ekranda_gosterildi  boolean not null default false,
  -- Durum imzası: "durum|isBitti|aktifKisi|bitimTarihi" (lib/bordro/prim-dengesi-gorulen)
  imza                    text,
  guncelleme              timestamptz not null default now(),
  primary key (kullanici_id, santiye_id)
);

alter table public.prim_dengesi_gorulen enable row level security;

-- Kullanıcı KENDİ kayıtlarını okur. Yazma yalnız sunucudan (service role) —
-- böylece kimse başkasının uyarısını kapatamaz.
drop policy if exists prim_dengesi_gorulen_oku on public.prim_dengesi_gorulen;
create policy prim_dengesi_gorulen_oku on public.prim_dengesi_gorulen
  for select to authenticated
  using (kullanici_id in (select id from public.kullanicilar where auth_id = auth.uid()));

comment on table public.prim_dengesi_gorulen is
  'SGK prim dengesi uyarısının kişi bazlı "görüldü" kaydı. Cihazdan bağımsız: '
  'bilgisayarda kapatılan uyarı telefonda da kapalı gelir.';
