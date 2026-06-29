-- Stabilize harita özeti — günlük, ÖNBELLEK tablosu.
-- Ham 7,8 MB kamyon GPS'i tarayıcıya çekip sınıflama yapmak yerine, SINIFLANMIŞ + OTURTULMUŞ
-- damperleri (gün-bazlı) burada saklarız. Tarayıcı bu küçük özeti çeker (~yüz KB/ay).
--
-- payload yapısı (jsonb):
--   { "dampers": [ { "plaka","saat","tarih","adres","surucu",
--                    "rawLat","rawLng","durakLat","durakLng",
--                    "mukerrer":bool,"ariza":bool,"dogrulanmamis":bool } ... ] }
-- imza = o günün ocak + ayar (tekrar/grid/mükerrer dk/yarıçap/ocak yarıçap) parmak izi.
--   İmza değişirse (ocak sürüklendi / ayar değişti) o gün YENİDEN hesaplanır; aynıysa hazır gelir.
--
-- ERİŞİM: Tarayıcı bu tabloya DOĞRUDAN erişmez; /api/arvento/stabilize-ozet (service-role) üzerinden okur.
--   RLS açık + politika YOK → yalnız service-role (RLS'i baypas eder) erişir. Güvenli.

create table if not exists public.arvento_harita_ozet (
  rapor_tarihi date        not null,
  sekme        text        not null default 'stabilize',
  imza         text        not null,
  payload      jsonb       not null,
  olusturma    timestamptz not null default now(),
  primary key (rapor_tarihi, sekme)
);

alter table public.arvento_harita_ozet enable row level security;
-- Bilerek politika eklenmedi: client API route üzerinden (service-role) erişir.
