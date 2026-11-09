-- YER İMİ ANAHTARI ARTIK KİŞİYE DEĞİL KURUMA AİT (09.11.2026)
--
-- NİYE DEĞİŞTİ: ilk kurulumda anahtar kullanıcı başınaydı; her kullanıcının kendi yer
-- imini üretmesi gerekiyordu. İstenen bu değil — kurulum BİR KEZ yapılsın, panele giren
-- herkes aynı yer imini kullansın.
--
-- NİYE ÖZET DEĞİL DÜZ METİN: paylaşımlı olacaksa anahtarın geri okunabilmesi ŞART,
-- yoksa ikinci kullanıcı yer imini kuramaz. sha256 özeti bunu imkânsız kılıyordu.
-- Riski sınırlı, çünkü bu anahtarın yapabildiği TEK ŞEY var: tebligat listesini deftere
-- yazmak. Veri okuyamaz, silemez, başka hiçbir kapıyı açmaz. Yine de tabloya RLS açık
-- ve POLİTİKA YOK: tarayıcı doğrudan okuyamaz, yalnız sunucu rotası yetkiyi görüp verir.
--
-- KİM AKTARDI: paylaşımlı anahtarla "kim tıkladı" bilinemez. Uydurulmuyor da — kontrol
-- kaydına kişi adı yerine "yer imi" yazılıyor. Yanlış isim yazmaktansa isimsiz kalsın.

drop table if exists public.ketsis_portal_anahtar;

create table public.ketsis_portal_anahtar (
  id            int primary key default 1 check (id = 1),   -- tek satır, kuruma ait
  anahtar       text not null,
  olusturan_id  uuid references public.kullanicilar(id),
  olusturan_ad  text,
  created_at    timestamptz not null default now(),
  son_kullanim  timestamptz,
  son_sonuc     text
);

comment on table public.ketsis_portal_anahtar is
  'Dijital Vergi Dairesi yer iminin panele yazma anahtarı. KURUMA ait, tek satır: bir kez
   üretilir, tüm kullanıcılar aynı yer imini kullanır. Vergi dairesi şifresiyle İLGİSİ YOKTUR
   ve o şifre panelde SAKLANMAZ — portalda CAPTCHA olduğu için saklamanın faydası da yok.';

alter table public.ketsis_portal_anahtar enable row level security;
-- Politika yok: yalnız service role. Yetki kontrolü sunucu rotasında.
