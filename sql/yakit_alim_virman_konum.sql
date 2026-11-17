-- YAKIT ALIMI VE VİRMANDA DA KONUM — KAYDI GİREN NEREDEYDİ
--
-- NİYE: araca yakıt verilirken konum zaten alınıyor (bkz. yakit_konum.sql). Depoya
-- yakıt alımı ve şantiyeler arası virman da telefondan giriliyor ama nerede girildiği
-- bilinmiyordu (kullanıcı isteği, 16.11.2026). Tanker depoya boşaltırken ya da yakıt
-- başka şantiyeye aktarılırken kaydı giren kişi gerçekten orada mıydı — aynı soru.
--
-- YALNIZ KAYDI GİRENİN KONUMU: alımda ve virmanda karşılaştırılacak bir araç yok,
-- o yüzden arac_* sütunları ve mesafe burada yok. Haritada tek nokta gösterilir.
--
-- DOĞRULUK DA SAKLANIR: telefon bina içinde 100 m - 1 km sapabiliyor; sapma payı
-- olmadan noktaya bakıp "orada değilmiş" demek insana haksızlık olur.
--
-- ESKİ KAYITLAR BOŞ KALIR: geçmişe konum uydurulmaz; ekranda rozet hiç çıkmaz.
-- Yöneticinin "Düzeltme" kaydı da (yakit_alim'e yazılıyor) konumsuzdur — masa başı
-- stok düzeltmesi, sahada yapılan bir işlem değil.

alter table public.yakit_alim add column if not exists konum_lat double precision;
alter table public.yakit_alim add column if not exists konum_lng double precision;
alter table public.yakit_alim add column if not exists konum_dogruluk_m integer;
alter table public.yakit_alim add column if not exists konum_at timestamptz;

alter table public.yakit_virman add column if not exists konum_lat double precision;
alter table public.yakit_virman add column if not exists konum_lng double precision;
alter table public.yakit_virman add column if not exists konum_dogruluk_m integer;
alter table public.yakit_virman add column if not exists konum_at timestamptz;

comment on column public.yakit_alim.konum_dogruluk_m is
  'Telefon konumunun sapma payı (metre).';
comment on column public.yakit_alim.konum_at is
  'Konumun ÖLÇÜLDÜĞÜ an — kaydın kaydedildiği an değil.';
comment on column public.yakit_virman.konum_dogruluk_m is
  'Telefon konumunun sapma payı (metre).';
comment on column public.yakit_virman.konum_at is
  'Konumun ÖLÇÜLDÜĞÜ an — kaydın kaydedildiği an değil.';

-- ══ DÜZELTME KONUMU — KAYIT SONRADAN NEREDEN DEĞİŞTİRİLDİ ══
--
-- NİYE (kullanıcı isteği, 16.11.2026): kaydın ilk girildiği yer saklanıyor ama kayıt
-- sonradan düzenlenince bu düzenlemenin nereden yapıldığı bilinmiyordu. İlk konum
-- DEĞİŞMEZ (pompada girildiğinin kanıtı o); düzenleme ayrı sütunlara yazılır. Böylece
-- "kayıt sahada girildi, miktarı akşam ofisten değiştirildi" ekranda okunur.
--
-- YALNIZ SON DÜZELTME tutulur: her düzenleme öncekinin üstüne yazar. Tam geçmiş
-- kayit_gecmisi tablosunda zaten duruyor; buradaki "en son kim, nereden dokundu".
--
-- Üç tabloda da var: araca verilen yakıt, depo alımı, virman.

alter table public.arac_yakit add column if not exists duzeltme_konum_lat double precision;
alter table public.arac_yakit add column if not exists duzeltme_konum_lng double precision;
alter table public.arac_yakit add column if not exists duzeltme_konum_dogruluk_m integer;
alter table public.arac_yakit add column if not exists duzeltme_konum_at timestamptz;
alter table public.arac_yakit add column if not exists duzeltme_by uuid;

alter table public.yakit_alim add column if not exists duzeltme_konum_lat double precision;
alter table public.yakit_alim add column if not exists duzeltme_konum_lng double precision;
alter table public.yakit_alim add column if not exists duzeltme_konum_dogruluk_m integer;
alter table public.yakit_alim add column if not exists duzeltme_konum_at timestamptz;
alter table public.yakit_alim add column if not exists duzeltme_by uuid;

alter table public.yakit_virman add column if not exists duzeltme_konum_lat double precision;
alter table public.yakit_virman add column if not exists duzeltme_konum_lng double precision;
alter table public.yakit_virman add column if not exists duzeltme_konum_dogruluk_m integer;
alter table public.yakit_virman add column if not exists duzeltme_konum_at timestamptz;
alter table public.yakit_virman add column if not exists duzeltme_by uuid;

comment on column public.arac_yakit.duzeltme_konum_at is
  'Kaydı SON düzenleyenin konumunun ölçüldüğü an. İlk giriş konumu konum_* sütunlarında, değişmez.';
comment on column public.arac_yakit.duzeltme_by is
  'Kaydı son düzenleyen kullanıcı (kullanicilar.id).';
