-- FİRMA BAŞINA UETS (E-TEBLİGAT) ENTEGRASYONU
--
-- Her tüzel kişinin kendi UETS adresi ve kendi API anahtarı var. Anahtarlar önce
-- .env.local'de tutuluyordu; bu, yeni firma eklendiğinde sunucuya elle dosya düzenlemek
-- demekti. Artık firma kaydının bir parçası: Firma Düzenle > UETS E-Tebligat sekmesi.
--
-- ANAHTAR NEDEN AYRI TABLODA?
-- ---------------------------------------------------------------------------
-- "firmalar" tablosunu oturum açan HERKES okuyabiliyor (ekranlar firma listesini
-- çekiyor). API anahtarı oraya konsaydı, panele girebilen herkesin tarayıcısına
-- düşerdi. PTT taahhütnamesi md. 2 ise anahtarın "özel izin alınmadıkça hiçbir kişi
-- veya kurum ile paylaşılmamasını" şart koşuyor. Anahtar o anahtarla tebligat
-- okunabilir, silinebilir — SMTP şifresinden daha ağır bir yetki.
--
-- Bu yüzden anahtar bu tabloda duruyor ve tabloda AUTHENTICATED İÇİN HİÇBİR POLİTİKA
-- YOK: RLS açık, politika yok demek "tarayıcıdan okunamaz" demek. Yalnız servis
-- anahtarıyla çalışan sunucu tarafı (API rotaları, çekme işi) erişir. Ekran, anahtarın
-- kendisini değil "tanımlı mı / son 4 hanesi ne" bilgisini /api/firma-uets üzerinden alır.
create table if not exists public.firma_uets (
  firma_id       uuid primary key references public.firmalar(id) on delete cascade,

  api_key        text,                               -- PTT UETS API anahtarı (gizli)
  aktif          boolean     not null default true,  -- kapalıysa çekme işi bu firmayı atlar

  uets_adres     text,                               -- 12345-67890-12345 (bilgi amaçlı)
  sunucu_ip      text,                               -- portalda tanımlı statik IP (hatırlatma)

  -- çekme işinin son durumu: ekranda "en son ne zaman, sorun var mı" diye görünsün
  son_cekim      timestamptz,
  son_hata       text,

  guncelleyen_id uuid references public.kullanicilar(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table  public.firma_uets is
  'Firma başına UETS e-tebligat entegrasyonu. api_key GİZLİDİR: RLS politikası yoktur, yalnız servis anahtarı erişir.';
comment on column public.firma_uets.api_key is
  'PTT UETS API anahtarı. Taahhütname md. 2: paylaşılamaz. Tarayıcıya ASLA gönderilmez.';
comment on column public.firma_uets.aktif is
  'Kapalıysa çekme işi bu firmayı atlar. Anahtar silinmeden geçici olarak durdurmak için.';
comment on column public.firma_uets.son_hata is
  'Son çekimde oluşan hata. Doluysa o firmanın tebligatları GELMİYOR demektir — ekranda uyarı çıkar.';

create or replace function public.firma_uets_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists firma_uets_updated_at on public.firma_uets;
create trigger firma_uets_updated_at before update on public.firma_uets
  for each row execute function public.firma_uets_updated_at();

-- RLS AÇIK, POLİTİKA YOK: tarayıcıdaki hiçbir kullanıcı (yönetici dâhil) bu tabloyu
-- okuyamaz/yazamaz. Erişim yalnız servis anahtarıyla, /api/firma-uets rotası üzerinden.
alter table public.firma_uets enable row level security;
drop policy if exists firma_uets_oku on public.firma_uets;
