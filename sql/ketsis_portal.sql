-- KETSİS PORTAL AKTARIMI — yer imi (bookmarklet) ile Dijital Vergi Dairesi'nden liste çekme
--
-- NİYE BÖYLE: 09.11.2026'da portal üzerinde keşif yapıldı, üç şey kesinleşti.
--   1) Girişte CAPTCHA var → sunucudan kendi kendine giriş yapılamaz. (Atlatma denenmedi,
--      denenmeyecek: portal açıkça robot istemiyor.)
--   2) Oturum sessionStorage.token'da duruyor ve ~6-8 dakikada düşüyor → "şifreyi sakla,
--      gece çek" diye bir şey kurulamaz. Şifre HİÇBİR YERDE saklanmıyor.
--   3) Tarayıcı, panelin portal servislerini okumasına izin vermiyor (CORS). Ama portalın
--      KENDİ sayfasında çalışan kod aynı origin'de olduğu için okuyabiliyor.
-- Çözüm: kullanıcı girişi kendi yapar (CAPTCHA'yı kendi geçer), e-Tebligat ekranında yer
-- imine tıklar; yer imi listeyi okuyup buraya gönderir. BELGE AÇILMAZ, yalnız liste okunur.
--
-- GÜVENLİK: yer iminin panele yazabilmesi için kullanıcıya özel bir anahtar gerekiyor.
-- Anahtar portalda değil, yer iminin içinde duruyor ve BURADA ÖZETİ (sha256) saklanıyor —
-- veritabanını okuyan anahtarı geri üretemez. Kullanıcı şifresi DEĞİLDİR, yalnız bu işe
-- yarar, tek tıkla iptal edilir.

create table if not exists public.ketsis_portal_anahtar (
  kullanici_id  uuid primary key references public.kullanicilar(id) on delete cascade,
  anahtar_ozet  text not null,               -- sha256(anahtar), ham anahtar saklanmaz
  anahtar_son4  text,                        -- "doğru yer imi mi" diye bakabilmek için
  created_at    timestamptz not null default now(),
  son_kullanim  timestamptz,
  son_sonuc     text                         -- son aktarımın özeti ya da hatası
);

comment on table public.ketsis_portal_anahtar is
  'Yer iminin panele yazma anahtarı. Ham anahtar saklanmaz (sha256 özeti). Kullanıcı şifresiyle ilgisi yoktur.';

alter table public.ketsis_portal_anahtar enable row level security;
-- Politika YOK: bu tabloya yalnız sunucu (service role) erişir. Anahtar özetinin
-- tarayıcıya hiç gitmemesi gerekiyor.

-- ───────── defter: portaldan gelen alanlar ─────────
-- Portal kaydı ile elle girilen kayıt AYNI deftere giriyor; ekran değişmiyor.
alter table public.ketsis_tebligat add column if not exists kaynak text not null default 'elle';
alter table public.ketsis_tebligat add column if not exists portal_teblig_id text;
alter table public.ketsis_tebligat add column if not exists kurum text;
alter table public.ketsis_tebligat add column if not exists belge_turu text;
alter table public.ketsis_tebligat add column if not exists portal_teblig_tarihi date;
alter table public.ketsis_tebligat add column if not exists portal_okuma_at timestamptz;

comment on column public.ketsis_tebligat.kaynak is
  '"elle" ya da "portal". Portal kaydı kullanıcı girişiyle çekilmiştir.';
comment on column public.ketsis_tebligat.portal_teblig_tarihi is
  'GİB''in KENDİ bildirdiği tebliğ tarihi (tebligZamani). Bizim hesapladığımız teblig_tarihi
   (ulaşma + 5) ile karşılaştırılır; FARKLIYSA EKRANDA GİB''İN DEĞERİ GÖSTERİLİR ve fark
   belirtilir. Sessizce birini seçmek, yanlış güne göre iş yapılmasına yol açardı.';

-- Aynı tebligat iki kez girmesin: portal kaydının kimliği GİB'in tebligId'si.
--
-- KISMİ DİZİN KULLANILMIYOR (09.11.2026 denendi, patladı): "where portal_teblig_id is
-- not null" eklenince PostgREST "no unique or exclusion constraint matching the ON
-- CONFLICT specification" diyor — upsert, kısmi dizine nişan alamıyor. Gerek de yok:
-- Postgres tekil dizinde birden çok NULL'a zaten izin veriyor, yani elle girilen
-- (portal_teblig_id boş) kayıtlar birbirini engellemiyor.
drop index if exists public.ketsis_tebligat_portal_uq;
create unique index if not exists ketsis_tebligat_portal_uq
  on public.ketsis_tebligat (portal_teblig_id);
