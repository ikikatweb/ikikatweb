-- YAKIT KAYDINDA YOL MESAFESİ — LİSTEDE KUŞBAKIŞI DEĞİL, YOLDAN KAÇ KM
--
-- NİYE: listede kuşbakışı mesafe yazıyordu (19 km) ama insanın aklındaki soru
-- "oraya gitmek kaç km" (aynı yer için 24 km). Kuşbakışı dağ, nehir, yol
-- dinlemiyor; rakam gerçeği olduğundan yakın gösteriyordu.
--
-- İKİSİ DE SAKLANIYOR, İKİSİ AYRI SORU:
--   arac_mesafe_m → kuşbakışı: "aynı yerde miydiler" (ŞÜPHE EŞİĞİ buna bakar,
--                   çünkü aynı yerde olup olmadıklarını yol değil düz çizgi söyler)
--   arac_yol_m    → yoldan: "gitmek ne kadar" (ekranda görünen sayı)
--
-- KAYIT ANINDA BİR KEZ: rota servisine her ekran açılışında değil, kayıt
-- düşerken bir kez sorulur ve sonuç saklanır. Hem servis boşuna yorulmaz hem de
-- yollar sonradan değişse bile o günkü ölçü kayıtta kalır.
--
-- HESAPLANAMAZSA BOŞ KALIR: servis cevap vermezse uydurulmaz; ekran kuşbakışı
-- mesafeyi "~" ile gösterir (AGENTS.md "sessiz hata yok").
alter table public.arac_yakit add column if not exists arac_yol_m integer;
alter table public.arac_yakit add column if not exists arac_yol_dk integer;
alter table public.arac_yakit add column if not exists arac_yol_kaynak text;

comment on column public.arac_yakit.arac_yol_m is
  'Araçtan kaydın girildiği yere YOLDAN mesafe (metre). Kuşbakışı değil; boşsa hesaplanamadı.';
comment on column public.arac_yakit.arac_yol_dk is
  'Aynı rotanın tahmini süresi (dakika). Trafik hesaba katılmaz.';
comment on column public.arac_yakit.arac_yol_kaynak is
  'Rotayı hesaplayan servis — "bu sayı nereden geldi" sorusu cevaplanabilsin';
