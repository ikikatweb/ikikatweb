-- YAKIT KAYDINDA KONUM — KAYDI GİREN NEREDEYDİ, ARAÇ NEREDEYDİ
--
-- NİYE: yakıt kaydı telefondan giriliyor ama nerede girildiği bilinmiyordu.
-- Kaydın girildiği yer ile ARACIN O ANDAKİ konumu karşılaştırılınca "kayıt
-- pompada mı girildi, araç gerçekten orada mıydı" sorusu kendiliğinden
-- cevaplanıyor. Kimseye "neredesin" diye sormadan çalışan dolaylı bir kontrol.
--
-- KONUM ZORUNLU (kullanıcı kararı, 10.11.2026): tarayıcı konum izni verilmeden
-- yakıt kaydı kaydedilmiyor. İzin penceresi kullanıcıya görünür — gizli bir
-- toplama yok, olamaz da (tarayıcı izinsiz konum vermiyor).
--
-- ══ DOĞRULUK DA SAKLANIR ══
-- Telefon konumu açık alanda 5-20 m, bina içinde 100 m-1 km sapabiliyor.
-- Sapma payı kaydedilmezse 800 m hatalı bir ölçüme bakıp "pompada değilmiş"
-- denir ve insana haksızlık edilir. Mesafe her zaman doğrulukla birlikte okunur.
--
-- ══ ARAÇ KONUMU ANLIK KOPYA ══
-- arvento_anlik tablosu her dakika ÜSTÜNE YAZILIYOR; bugünkü konum yarın yok.
-- Karşılaştırmanın dayanağı kaybolmasın diye aracın o andaki enlem/boylamı ve
-- ÖLÇÜM ANI kaydın içine kopyalanıyor.
--
-- ══ UYDURMA YOK ══
-- Araçta takip cihazı yoksa (124 araçtan 31'inde var) ya da cihazın son ölçümü
-- eskiyse mesafe BOŞ kalır ve sebebi konum_notu'na yazılır. "Bilinmiyor"u sıfır
-- mesafe gibi göstermek, olmayan bir kanıt üretmek olur.

-- ── KAYDI GİRENİN KONUMU ──
alter table public.arac_yakit add column if not exists konum_lat double precision;
alter table public.arac_yakit add column if not exists konum_lng double precision;
alter table public.arac_yakit add column if not exists konum_dogruluk_m integer;
alter table public.arac_yakit add column if not exists konum_at timestamptz;

-- ── ARACIN O ANDAKİ KONUMU (Arvento anlık kopyası) ──
alter table public.arac_yakit add column if not exists arac_lat double precision;
alter table public.arac_yakit add column if not exists arac_lng double precision;
alter table public.arac_yakit add column if not exists arac_konum_at timestamptz;
alter table public.arac_yakit add column if not exists arac_mesafe_m integer;
alter table public.arac_yakit add column if not exists konum_notu text;

comment on column public.arac_yakit.konum_dogruluk_m is
  'Telefon konumunun sapma payı (metre). Mesafe bu değerle birlikte okunur.';
comment on column public.arac_yakit.konum_at is
  'Konumun ÖLÇÜLDÜĞÜ an — kaydın kaydedildiği an değil.';
comment on column public.arac_yakit.arac_konum_at is
  'Aracın konum ölçümünün anı (Arvento). Eskiyse mesafe güvenilmez; arvento_anlik üstüne yazıldığı için kopyalanır.';
comment on column public.arac_yakit.arac_mesafe_m is
  'Kaydı girenin konumu ile aracın konumu arasındaki kuşbakışı mesafe (metre). Hesaplanamadıysa BOŞ — bkz. konum_notu.';
comment on column public.arac_yakit.konum_notu is
  'Mesafe neden hesaplanamadı: araçta cihaz yok / cihazın son ölçümü eski / konum okunamadı';
